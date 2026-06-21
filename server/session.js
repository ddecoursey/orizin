// Session helpers: cookie issuance, inactivity enforcement, login recording.
import crypto from "crypto";
import * as db from "./db.js";

export const COOKIE_NAME = "orizin_auth";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function inactivityMs() {
  const n = parseInt(process.env.SESSION_INACTIVITY_MS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60 * 1000; // 1 hour
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
export function validateSessionPayload(payload) {
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
  return { ok: true, user };
}

/** Record login + issue a fresh session cookie. */
export function establishSession(res, req, { user, isAdmin, plan }, kind = "login") {
  const dbUser = db.getUserByUsername(user);
  const epoch = dbUser?.session_epoch ?? 0;
  const now = Date.now();
  db.recordUserLogin(user, {
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    kind,
  });

  const tokenPayload = {
    user,
    isAdmin: !!isAdmin,
    exp: now + SESSION_MAX_AGE_MS,
    iat: now,
    epoch,
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
  db.touchUserActivity(userId);
}

/** Re-issue cookie after password change so the current device keeps its session. */
export function refreshSessionCookie(res, req, user) {
  const now = Date.now();
  const tokenPayload = {
    user: user.username,
    isAdmin: !!user.is_admin,
    exp: now + SESSION_MAX_AGE_MS,
    iat: now,
    epoch: user.session_epoch ?? 0,
  };
  const token = signToken(tokenPayload);
  res.set("Set-Cookie", buildCookie(COOKIE_NAME, token, {
    maxAgeMs: SESSION_MAX_AGE_MS,
    secure: req.secure,
  }));
}