// Session helpers: cookie issuance, inactivity enforcement, login recording.
import crypto from "crypto";
import * as db from "./db.js";

export const COOKIE_NAME = "orizin_auth";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function inactivityMs() {
  const n = parseInt(process.env.SESSION_INACTIVITY_MS ?? "", 10);
  // Default 30 days — matches the cookie max-age. Combined with rolling re-issue
  // on activity (see the auth middleware), this is a "stay signed in" session:
  // you're only signed out after 30 days of TRUE inactivity, or an explicit
  // revoke (sign out / sign out all devices / password change). The old 1-hour
  // window logged active-but-quiet users out constantly (a backgrounded tab's
  // keep-alive poll is throttled by the browser, so last-seen went stale).
  return Number.isFinite(n) && n > 0 ? n : 30 * 24 * 60 * 60 * 1000;
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

export function buildCookie(name, value, { maxAgeMs, secure }) {
  const parts = [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function authSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production");
  }
  return s || "dev-insecure-auth-secret";
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", authSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", authSecret()).update(data).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Validate a signed token payload against DB session state (epoch + inactivity).
 * @returns {{ ok: true, user: object } | { ok: false, status: number, body: object }}
 */
export function validateSessionPayload(payload, rawToken = null) {
  if (!payload?.user) {
    return { ok: false, status: 401, body: { error: "Unauthorized", code: "unauthorized" } };
  }
  const user = db.getUserByUsername(payload.user);
  if (!user) {
    return { ok: false, status: 401, body: { error: "Unauthorized", code: "unauthorized" } };
  }
  const tokenEpoch = payload.epoch ?? 0;
  const dbEpoch = user.session_epoch ?? 0;
  if (tokenEpoch !== dbEpoch) {
    return {
      ok: false,
      status: 401,
      body: { error: "Your session was ended — please sign in again.", code: "session_revoked" },
    };
  }
  if (payload.sid && !db.isAuthSessionActive(payload.user, payload.sid)) {
    return {
      ok: false,
      status: 401,
      body: { error: "This session was signed out. Please sign in again.", code: "session_revoked" },
    };
  }
  if (!payload.sid && rawToken && db.isLegacyAuthTokenRevoked(payload.user, rawToken)) {
    return {
      ok: false,
      status: 401,
      body: { error: "This session was signed out. Please sign in again.", code: "session_revoked" },
    };
  }
  const lastActive = user.last_active_at || payload.iat || 0;
  const idle = Date.now() - lastActive;
  if (idle > inactivityMs()) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Signed out due to inactivity. Please sign in again.",
        code: "session_inactive",
        inactiveMs: idle,
      },
    };
  }
  return { ok: true, user, needsSessionUpgrade: !payload.sid };
}

function newSessionId() {
  return crypto.randomBytes(32).toString("base64url");
}

/** Record login + issue a fresh session cookie. */
export function establishSession(res, req, { user, isAdmin, plan }, kind = "login") {
  const dbUser = db.getUserByUsername(user);
  const epoch = dbUser?.session_epoch ?? 0;
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;
  const sid = newSessionId();
  db.recordUserLogin(user, {
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    kind,
  });
  if (!db.createAuthSession(user, sid, expiresAt, now)) {
    throw new Error("Could not establish server-side session");
  }

  const tokenPayload = {
    user,
    isAdmin: !!isAdmin,
    exp: expiresAt,
    iat: now,
    epoch,
    sid,
  };
  const token = signToken(tokenPayload);
  res.set("Set-Cookie", buildCookie(COOKIE_NAME, token, {
    maxAgeMs: SESSION_MAX_AGE_MS,
    secure: req.secure,
  }));
  return { tokenPayload, plan: plan || db.normalizePlan(dbUser?.plan) };
}

/** Throttled last-seen update on authenticated API traffic. */
export function touchUserActivity(userId) {
  return db.touchUserActivity(userId);
}

/** Re-issue cookie after password change so the current device keeps its session. */
export function refreshSessionCookie(
  res,
  req,
  user,
  currentSessionId = null,
  legacyToken = null,
  legacyExpiresAt = null,
) {
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;
  const sid = currentSessionId || newSessionId();
  const persisted = currentSessionId
    ? db.extendAuthSession(user.username, sid, expiresAt, now)
    : db.createAuthSession(user.username, sid, expiresAt, now);
  // Never re-create a session id that was concurrently revoked by logout.
  if (!persisted) return false;
  if (legacyToken) {
    try {
      const legacyRevoked = db.revokeLegacyAuthToken(
        user.username,
        legacyToken,
        Number.isFinite(legacyExpiresAt) ? legacyExpiresAt : expiresAt,
      );
      if (!legacyRevoked) {
        db.revokeAuthSession(user.username, sid);
        return false;
      }
    } catch (error) {
      db.revokeAuthSession(user.username, sid);
      throw error;
    }
  }
  const tokenPayload = {
    user: user.username,
    isAdmin: !!user.is_admin,
    exp: expiresAt,
    iat: now,
    epoch: user.session_epoch ?? 0,
    sid,
  };
  const token = signToken(tokenPayload);
  res.set("Set-Cookie", buildCookie(COOKIE_NAME, token, {
    maxAgeMs: SESSION_MAX_AGE_MS,
    secure: req.secure,
  }));
  return true;
}
