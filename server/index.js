import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import stocksRouter, { getDetailCacheStats, generateLiteIntangibles } from './routes/stocks.js';
import { backgroundLiteIntangiblesEnabled } from './geminiJson.js';
import chatRouter from './routes/chat.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';
import settingsRouter from './routes/settings.js';
import watchlistRouter from './routes/watchlist.js';
import brokerageRouter from './routes/brokerage.js';
import billingRouter from './routes/billing.js';
import strategiesRouter from './routes/strategies.js';
import { sendEmail, welcomeEmail, resetPasswordEmail, deletedAccountEmail } from './email.js';
import * as db from './db.js';
import { cancelLinkedSubscription, cancellationErrorResponse } from './subscriptionLifecycle.js';
import { enrichmentManager, startBackgroundEnrichmentIfEnabled } from './enrichment.js';
import { startWatchlistAlertJobs } from './watchlistAlerts.js';
import { marketSession, marketStatusLine } from './marketHours.js';
import { displayNameFor, emailForNotifications } from './userProfile.js';
import { pruneOldOriUsage } from './oriUsage.js';
import { ensureChatContextCaches, startChatContextCacheRefresh } from './geminiContextCache.js';
import { isDeployedRuntime, productionConfigurationErrors } from './productionConfig.js';
import { isTrustedMutationRequest } from './requestOrigin.js';
import {
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  buildCookie,
  verifyToken,
  validateSessionPayload,
  establishSession,
  refreshSessionCookie,
  touchUserActivity,
  inactivityMs,
  clientIp,
} from './session.js';

// Import logger for local route handlers + re-export for other modules that do `import { logError } from './index.js'`
import { logError, getErrors, clearErrors } from './logger.js';
export { logError, getErrors };

// Admin require (self-contained in auth.js to prevent circular deps with routes)
import { requireAdmin } from './auth.js';
export { requireAdmin };

// For admin kill-all of fetches (aborts in-flight FMP calls)
import * as fmp from './fmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const deployedRuntime = isDeployedRuntime();

const configurationErrors = productionConfigurationErrors();
if (configurationErrors.length) {
  for (const error of configurationErrors) console.error(`[FATAL] ${error}.`);
  process.exit(1);
}

const app = express();
let server = null;
let shuttingDown = false;

// Railway is the single proxy hop directly in front of this service. Trusting
// every hop lets a caller-controlled X-Forwarded-For value influence req.ip.
app.set('trust proxy', 1);

// ── Crash safety ────────────────────────────────────────────────────────────
// An uncaught error can leave shared caches, queues, or SQLite transactions in an
// unknown state. Log it, then let Railway replace the process in deployed/live
// environments; local development remains inspectable without a restart loop.
function handleFatalError(kind, reason) {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  console.error(`[${kind}]`, msg);
  try { logError(kind, { error: msg }); } catch { /* ignore */ }
  if (deployedRuntime) shutdown(kind, 1);
}
process.on('unhandledRejection', (reason) => handleFatalError('unhandledRejection', reason));
process.on('uncaughtException', (error) => handleFatalError('uncaughtException', error));

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // PayPal: the JS SDK is loaded from www.paypal.com and pulls assets from
      // paypalobjects.com; without these the subscribe button is blocked in prod.
      scriptSrc: ["'self'", "'unsafe-inline'", "https://*.paypal.com", "https://*.paypalobjects.com"],
      // The PayPal button/checkout renders in an iframe and calls PayPal's API.
      connectSrc: [
        "'self'",
        "https://*.paypal.com",
        "https://*.paypalobjects.com",
        "https://prod.spline.design",
        "https://*.spline.design",
      ],
      frameSrc: ["'self'", "https://*.paypal.com", "https://*.paypalobjects.com"],
      // Google Fonts: the stylesheet comes from fonts.googleapis.com and the
      // font files from fonts.gstatic.com — without these the brand font
      // (Space Grotesk, linked in index.html) was silently blocked in prod.
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // PayPal Smart Buttons open a checkout POPUP and talk to it via window.opener.
  // Helmet's default COOP ('same-origin') nulls window.opener for cross-origin
  // popups, which breaks the handshake and leaves the popup stuck on about:blank.
  // 'same-origin-allow-popups' keeps COOP protection for the page itself while
  // letting popups it opens retain the opener link.
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

app.use(express.json({ limit: '2mb' }));

// The production UI and API are same-origin. Do not grant arbitrary websites
// browser access to cookie-authenticated mutations; PayPal's webhook is a
// server-to-server call and carries neither Origin nor Sec-Fetch-Site.
app.use('/api', (req, res, next) => {
  if (!deployedRuntime) return next();
  if (isTrustedMutationRequest(req)) return next();
  return res.status(403).json({
    error: 'Cross-origin request rejected',
    code: 'origin_rejected',
  });
});

// Gzip JSON API responses (no extra dependency). /api/stocks alone is several
// MB of JSON for a large universe; gzip cuts the transfer ~8-10x. Only res.json
// is wrapped, so SSE streams (refresh/enrich/chat) are untouched. Small bodies
// skip compression — not worth the CPU.
app.use('/api', (req, res, next) => {
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
  const origJson = res.json.bind(res);
  res.json = (body) => {
    try {
      const text = JSON.stringify(body);
      if (text.length < 1024) return origJson(body);
      const gz = zlib.gzipSync(Buffer.from(text), { level: zlib.constants.Z_BEST_SPEED });
      res.set('Content-Encoding', 'gzip');
      res.set('Vary', 'Accept-Encoding');
      res.type('application/json');
      return res.send(gz);
    } catch {
      return origJson(body);
    }
  };
  next();
});

// Rate limit auth attempts (protect against brute force). Strict in
// production; relaxed outside it so local development and the regression
// suite (dozens of login/signup calls from one IP) don't trip it.
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProd ? 10 : 1000,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(
    clientIp(req) || req.ip || req.socket?.remoteAddress || "unknown",
  ),
  validate: {
    trustProxy: false, // We intentionally set trust proxy for Railway
  },
});

// Cookie-session auth — production-safe version
//
// Preferred: Users are stored in the SQLite database with bcrypt hashes.
// Bootstrap: On first run, if AUTH_USERS_JSON is set and no users exist in DB,
//            the system will import them (hashing passwords).
//
// Fallback (legacy): AUTH_USER + AUTH_PASSWORD (single user, plaintext).
//
// For Railway / first deploy: You can optionally set AUTH_USERS_JSON to bootstrap
// the first users. After the first user exists, user management is fully dynamic
// via the in-app User Management modal (no more env var changes or redeploys needed).
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;

// Bootstrap users from AUTH_USERS_JSON into DB (one-time on first run)
function bootstrapUsersFromEnv() {
  if (!process.env.AUTH_USERS_JSON) return;

  try {
    const count = db.userCount();
    if (count === 0) {
      console.log('[auth] Bootstrapping users from AUTH_USERS_JSON into database...');
      const arr = JSON.parse(process.env.AUTH_USERS_JSON);
      let created = 0;
      let failed = 0;
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry?.user && entry?.password) {
            const isAdmin = ['dylan', 'admin'].includes(String(entry.user).toLowerCase());
            const result = db.createUser(entry.user, entry.password, isAdmin);
            if (result.success) created++;
            else failed++;
          }
        }
      }
      console.log(`[auth] Bootstrap complete: ${created} account(s) created, ${failed} failed`);
    }
  } catch (err) {
    console.error('[auth] Failed to bootstrap users:', err.message);
  }
}

// Promote dylan and admin to admin if they exist but are not marked as such (for existing DBs)
function promoteDesignatedAdmins() {
  try {
    const designated = ['dylan', 'admin'];
    for (const name of designated) {
      const user = db.getUserByUsername ? db.getUserByUsername(name) : null;
      if (user && !user.is_admin) {
        db.default.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(name);
        console.log('[auth] Promoted a designated account to admin');
      }
    }
  } catch (err) {
    console.error('[auth] Failed to promote designated admins:', err.message);
  }
}

// Run bootstrap and promotion synchronously at startup
bootstrapUsersFromEnv();
promoteDesignatedAdmins();

// Note: We intentionally compute "has users" dynamically in most places now
// so that the first-admin setup flow works without requiring a server restart.
// Logical deployment environment, surfaced to the UI so QA (sandbox) and
// production (live) are never confused when both run at once. Set APP_ENV
// explicitly per Railway environment ('qa' / 'production'); otherwise it's
// inferred from PAYPAL_ENV. Anything other than 'production' shows a UI badge.
const APP_ENV = process.env.APP_ENV || (process.env.PAYPAL_ENV === 'live' ? 'production' : 'development');
const authMustFailClosed =
  isProd || APP_ENV === 'production' || String(process.env.PAYPAL_ENV || '').toLowerCase() === 'live';
const FIRST_ADMIN_SETUP_TOKEN = String(process.env.FIRST_ADMIN_SETUP_TOKEN || '');
const firstAdminSetupConfigured = Buffer.byteLength(FIRST_ADMIN_SETUP_TOKEN) >= 24;
const hasDbUsersAtStartup = db.userCount() > 0;

if (authMustFailClosed && !hasDbUsersAtStartup && !firstAdminSetupConfigured) {
  console.error(
    '[auth] No users exist and FIRST_ADMIN_SETUP_TOKEN is not configured with at least 24 characters. ' +
      'Authentication is locked until the setup token is configured.',
  );
}

// Legacy single-user mode still supported via AUTH_PASSWORD
const legacyAuthEnabled = !!AUTH_PASSWORD;

// Dynamic helper: is auth required right now?
function isAuthEnabled() {
  // Never turn an empty deployed database into an anonymous admin session.
  if (authMustFailClosed) return true;
  // If we have DB users, auth is always on.
  // Otherwise fall back to legacy AUTH_PASSWORD mode.
  try {
    return db.userCount() > 0 || legacyAuthEnabled;
  } catch {
    return legacyAuthEnabled;
  }
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

// Auth endpoints — accessible without a session.
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const currentlyAuthEnabled = isAuthEnabled();
  if (!currentlyAuthEnabled) return res.json({ ok: true, user: 'default', authEnabled: false });

  const username = String(req.body?.user || '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || username.length > 320 || password.length > PASSWORD_MAX_LENGTH) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  let match = null;

  // Prefer database users (hashed passwords); the identifier may be a
  // username or an email address.
  try {
    const dbUser = db.verifyUserPassword(username, password);
    if (dbUser) {
      match = { user: dbUser.username, isAdmin: !!dbUser.isAdmin, plan: dbUser.plan || 'free' };
    }
  } catch (e) {
    console.error('[auth] Error verifying user from DB:', e.message);
  }

  // Legacy fallback (plaintext from env) if no DB users exist yet
  const hasUsersNow = (db.userCount?.() ?? 0) > 0;
  if (!match && !hasUsersNow && AUTH_PASSWORD) {
    if (safeEqual(username, AUTH_USER) && safeEqual(password, AUTH_PASSWORD)) {
      match = { user: AUTH_USER, isAdmin: true, plan: 'pro' };
    }
  }

  if (!match) return res.status(401).json({ error: 'Invalid username or password' });

  const { plan } = establishSession(res, req, match, 'login');
  res.json({ ok: true, user: match.user, isAdmin: !!match.isAdmin, plan });
});

// Self-service account creation (email + password). The very first account on
// an empty database must go through /setup-first-admin instead, so a fresh
// deployment can't be claimed by a random visitor signing up as a normal user.
// Disable entirely with SIGNUPS_ENABLED=false.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post('/api/auth/signup', loginLimiter, (req, res) => {
  if (process.env.SIGNUPS_ENABLED === 'false') {
    return res.status(403).json({ error: 'Sign-ups are disabled. Contact the administrator for an account.' });
  }
  if ((db.userCount?.() ?? 0) === 0) {
    return res.status(400).json({ error: 'No accounts exist yet — use the first-admin setup instead.' });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: 'Password must be 8-200 characters' });
  }
  if (db.getUserByEmail(email) || db.getUserByUsername(email)) {
    return res.status(400).json({ error: 'An account with that email already exists' });
  }

  // Email doubles as the username/login identifier for self-service accounts.
  const result = db.createUser(email, password, false, email, 'free');
  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Failed to create account' });
  }

  // Welcome email (fire-and-forget; no-op if no email provider is configured).
  sendEmail({ to: email, ...welcomeEmail(), priority: 'critical' }).catch(() => {});

  establishSession(res, req, { user: email, isAdmin: false, plan: 'free' }, 'signup');
  res.json({ ok: true, user: email, isAdmin: false, plan: 'free' });
});

// ── Password reset ───────────────────────────────────────────────────────────
// sha256 of a reset token — we email the raw token but only ever STORE this hash,
// so a DB leak can't be turned into account takeovers.
function hashToken(tok) {
  return crypto.createHash('sha256').update(String(tok)).digest('hex');
}
// Absolute URL for links in emails. Prefer the configured public origin
// (APP_URL) so links are correct behind proxies; fall back to the request host.
function publicUrl(req, pathAndQuery) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '') ||
    `${req.protocol}://${req.get('host')}`;
  return `${base}${pathAndQuery}`;
}

// Request a reset link. Always returns the SAME generic response whether or not
// the account exists, so this endpoint can't be used to enumerate registered
// emails. Rate-limited (loginLimiter).
app.post('/api/auth/forgot-password', loginLimiter, (req, res) => {
  const id = String(req.body?.email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  try {
    const user = id ? (db.getUserByEmail(id) || db.getUserByUsername(id)) : null;
    if (user) {
      const to = user.email && EMAIL_RE.test(user.email) ? user.email
        : EMAIL_RE.test(user.username) ? user.username : null;
      if (to) {
        const tok = crypto.randomBytes(32).toString('base64url');
        db.setResetToken(user.username, hashToken(tok), Date.now() + 60 * 60 * 1000); // 1 hour
        const url = publicUrl(req, `/reset?token=${tok}&u=${encodeURIComponent(user.username)}`);
        sendEmail({ to, ...resetPasswordEmail(url), priority: 'critical' }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[auth] forgot-password error:', e.message);
  }
  res.json(generic);
});

// Complete a reset with the emailed token. Validates the single-use, 1-hour,
// constant-time-compared token, sets the new password (which clears the token),
// then issues this device a fresh session cookie.
// setUserPassword bumps the session epoch, invalidating every older session;
// establishSession below signs this device back in with the new epoch.
app.post('/api/auth/reset-password', loginLimiter, (req, res) => {
  const username = String(req.body?.u || req.body?.user || '').trim();
  const token = String(req.body?.token || '');
  const newPassword = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || !token) return res.status(400).json({ error: 'Invalid or missing reset token' });
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: 'Password must be 8-200 characters' });
  }

  const user = db.getUserByUsername(username);
  if (!user || !user.reset_token_hash || !user.reset_expires) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }
  if (Date.now() > user.reset_expires) {
    return res.status(400).json({ error: 'This reset link has expired — request a new one' });
  }
  if (!safeEqual(hashToken(token), user.reset_token_hash)) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired' });
  }

  db.setUserPassword(username, newPassword); // hashes + clears reset token + bumps session epoch
  const updated = db.getUserByUsername(username);
  establishSession(res, req, {
    user: username,
    isAdmin: !!updated?.is_admin,
    plan: db.normalizePlan(updated?.plan),
  }, 'reset');
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  let revocationFailed = false;
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const payload = verifyToken(token);
    if (payload?.user && payload.sid) {
      // Idempotent: an already-revoked session is still successfully logged out.
      db.revokeAuthSession(payload.user, payload.sid);
    } else if (payload?.user) {
      // Transitional path for cookies issued before per-device session ids.
      // Hash this exact cookie so other legacy devices remain signed in.
      db.revokeLegacyAuthToken(
        payload.user,
        token,
        Number.isFinite(payload.exp) ? payload.exp : Date.now() + SESSION_MAX_AGE_MS,
      );
    }
  } catch (error) {
    revocationFailed = true;
    console.error('[auth] Session revocation failed during logout:', error.message);
  }
  res.set('Set-Cookie', buildCookie(COOKIE_NAME, '', {
    maxAgeMs: 0,
    secure: req.secure,
  }));
  if (revocationFailed) {
    return res.status(503).json({
      error: 'The local session was cleared, but server-side logout could not be confirmed.',
      code: 'logout_unconfirmed',
    });
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const currentlyAuthEnabled = isAuthEnabled();
  if (!currentlyAuthEnabled) {
    return res.json({ user: 'default', authenticated: true, authEnabled: false, plan: 'pro', isAdmin: true, env: APP_ENV });
  }
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ authenticated: false, authEnabled: true });

  const session = validateSessionPayload(payload, token);
  if (!session.ok) {
    return res.status(session.status).json({ authenticated: false, authEnabled: true, ...session.body });
  }
  // The client polls this endpoint + hits it on tab focus; roll the cookie here
  // too so a tab that's only polling (no other API calls) still stays signed in.
  const activityAdvanced = touchUserActivity(payload.user);
  if (
    (session.needsSessionUpgrade || activityAdvanced) &&
    !refreshSessionCookie(
      res,
      req,
      session.user,
      payload.sid || null,
      payload.sid ? null : token,
      payload.exp,
    )
  ) {
    return res.status(401).json({
      authenticated: false,
      authEnabled: true,
      error: 'This session was signed out. Please sign in again.',
      code: 'session_revoked',
    });
  }

  // Admin flag is always reconciled from the DB so demotions take effect
  // immediately. Legacy env-password mode (no DB users) is the only case where
  // we fall back to the token-embedded flag.
  let isAdmin = false;
  let plan = 'free';
  let email = null;
  let notificationEmail = null;
  let nickname = null;
  let displayName = payload.user;
  try {
    // reconcileUserPlan lazily drops Pro once a cancelled subscription's grace
    // period has ended, so access reflects reality without waiting for the sweep.
    const dbUser = db.reconcileUserPlan(payload.user);
    if (dbUser) {
      plan = db.normalizePlan(dbUser.plan);
      email = dbUser.email || null;
      notificationEmail = dbUser.notification_email || null;
      isAdmin = !!dbUser.is_admin;
      const settings = db.getUserSettings(payload.user);
      nickname = settings.nickname || null;
      displayName = displayNameFor(dbUser, settings) || payload.user;
    } else if (db.userCount() === 0 && typeof payload.isAdmin === 'boolean' && payload.isAdmin) {
      isAdmin = true;
      plan = 'pro'; // legacy env-auth admin
    }
  } catch (e) {
    console.error('[auth] Error looking up user in /me:', e.message);
  }

  res.json({
    user: payload.user,
    isAdmin,
    plan,
    email,
    notificationEmail,
    nickname,
    displayName,
    authenticated: true,
    authEnabled: true,
    env: APP_ENV,
    inactivityMinutes: Math.round(inactivityMs() / 60000),
  });
});

// Public status endpoint — used by the login page to decide whether to show
// "Create First Admin" setup flow or normal login.
app.get('/api/auth/status', (req, res) => {
  const userCount = db.userCount ? db.userCount() : 0;
  res.json({
    needsSetup: userCount === 0,
    authEnabled: isAuthEnabled(),
    hasUsers: userCount > 0,
    setupTokenRequired: authMustFailClosed && userCount === 0,
    setupAvailable: userCount > 0 || !authMustFailClosed || firstAdminSetupConfigured,
    signupsEnabled: process.env.SIGNUPS_ENABLED !== 'false' && userCount > 0,
    env: APP_ENV,
  });
});

// Lightweight health check for Railway / uptime monitors. Unauthenticated and
// cheap (no DB write) — reports basic liveness. Defined before the /api auth
// gate so it stays reachable without a session.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: APP_ENV,
    uptime: Math.round(process.uptime()),
    // Railway exposes the source commit to the running container. Returning it
    // lets post-deploy checks prove they reached the deployment that triggered
    // them instead of an older instance still answering at the same hostname.
    deploymentSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
  });
});

// One-time setup endpoint: create the very first admin user when the database is
// empty. Deployed/live environments additionally require a secret configured by
// the operator so the first internet visitor cannot claim the instance.
app.post('/api/auth/setup-first-admin', loginLimiter, (req, res) => {
  const userCount = db.userCount ? db.userCount() : 0;
  if (userCount > 0) {
    return res.status(400).json({ error: 'Setup is only allowed when there are no users yet' });
  }

  if (authMustFailClosed) {
    if (!firstAdminSetupConfigured) {
      return res.status(503).json({
        error: 'First-admin setup is locked. Configure FIRST_ADMIN_SETUP_TOKEN and restart the server.',
        code: 'setup_not_configured',
      });
    }
    const suppliedToken = String(req.body?.setupToken || req.get('x-setup-token') || '');
    if (!safeEqual(suppliedToken, FIRST_ADMIN_SETUP_TOKEN)) {
      return res.status(403).json({ error: 'Invalid setup token', code: 'invalid_setup_token' });
    }
  }

  const email = String(req.body?.user || req.body?.email || '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ error: 'Password must be 8-200 characters' });
  }

  const result = db.createUser(email, password, true, email); // first user is always admin

  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Failed to create user' });
  }

  establishSession(res, req, { user: email, isAdmin: true, plan: 'pro' }, 'setup');
  res.json({ ok: true, user: email, isAdmin: true, message: 'First admin account created successfully' });
});

// Gate the rest of /api/* on a valid session cookie, and attach the
// current user's id to req so downstream routes can scope per-user data.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  // PayPal calls the webhook server-to-server with no session cookie.
  if (req.path === '/billing/webhook') return next();
  if (!isAuthEnabled()) {
    req.userId = 'default';
    return next();
  }
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized', code: 'unauthorized' });
  const session = validateSessionPayload(payload, token);
  if (!session.ok) return res.status(session.status).json(session.body);
  // Rolling session: when activity advances (throttled to ~2 min), re-issue the
  // cookie with a fresh 30-day window so an actively-used session never expires
  // mid-use. Idle/abandoned sessions still lapse after inactivityMs, and explicit
  // revokes (epoch bump) still apply on the next request.
  const activityAdvanced = touchUserActivity(payload.user);
  if (
    (session.needsSessionUpgrade || activityAdvanced) &&
    !refreshSessionCookie(
      res,
      req,
      session.user,
      payload.sid || null,
      payload.sid ? null : token,
      payload.exp,
    )
  ) {
    return res.status(401).json({
      error: 'This session was signed out. Please sign in again.',
      code: 'session_revoked',
    });
  }
  req.userId = payload.user;
  next();
});

// Prevent browsers from caching API responses as if they were static assets —
// otherwise a stale cached HTML body (from a previous static-only deploy) can
// be reused for /api/* requests, causing res.json() to fail in the client.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Self-service account deletion (right to be forgotten). Cancels any active
// subscription first so the user isn't billed again, then cascade-deletes all of
// their data and clears this device's session. Registered as an app-level route
// BEFORE usersRouter so it wins over usersRouter's admin-only /users/:username.
app.delete('/api/users/me', async (req, res) => {
  const username = req.userId;
  const user = db.getUserByUsername(username);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  // Don't let the last admin delete themselves into an unmanageable instance.
  if (user.is_admin && db.adminCount() <= 1) {
    return res.status(400).json({ error: 'You are the only admin — promote another admin before deleting your account.' });
  }
  try {
    await cancelLinkedSubscription(user);
  } catch (error) {
    console.error(
      '[account] subscription cancellation blocked account deletion:',
      error.cause?.message || error.message,
    );
    const failure = cancellationErrorResponse(error);
    return res.status(failure.status).json(failure.body);
  }
  // Capture the address BEFORE the row is gone, then confirm the deletion by
  // email (fire-and-forget; no-op if email isn't configured).
  const to = emailForNotifications(user);
  db.deleteUserCascade(username);
  if (to) sendEmail({ to, ...deletedAccountEmail(), priority: 'critical' }).catch(() => {});
  res.set('Set-Cookie', buildCookie(COOKIE_NAME, '', { maxAgeMs: 0, secure: req.secure }));
  res.json({ ok: true });
});

// API routes
app.use('/api', stocksRouter);
app.use('/api', chatRouter);
app.use('/api', adminRouter);
app.use('/api', usersRouter);
app.use('/api', settingsRouter);
app.use('/api', watchlistRouter);
app.use('/api', brokerageRouter);
app.use('/api', billingRouter);
app.use('/api', strategiesRouter);

// Global error handler for all /api routes — ensures we never return HTML.
// (Express identifies error middleware by arity, so the 4th param stays.)
app.use('/api', (err, req, res, _next) => {
  console.error('[API Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Debug error logging endpoints. POST is open to any authenticated user so the
// frontend can report real client-side errors (it used to be admin-only, which
// turned every non-admin browser report into 403 noise); reading/clearing the
// log stays admin-only. Accepts a single entry or a batch { entries: [...] }.
const debugErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

app.post('/api/debug/errors', debugErrorLimiter, (req, res) => {
  const body = req.body || {};
  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 25) : [body];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const { message, ...rest } = entry;
    if (message) logError(String(message).slice(0, 2000), rest);
  }
  res.json({ ok: true });
});

app.get('/api/debug/errors', requireAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ errors: getErrors(limit) });
});

app.post('/api/debug/errors/clear', requireAdmin, (req, res) => {
  res.json({ ok: true, cleared: clearErrors() });
});

// FMP usage, cache effectiveness, data freshness, and market session — powers
// the /debug dashboard so quota problems are visible before they hurt.
app.get('/api/debug/fmp-stats', requireAdmin, (req, res) => {
  res.json({
    fmp: fmp.getFmpStats(),
    detailCache: getDetailCacheStats(),
    freshness: db.getFreshnessSummary(),
    market: { session: marketSession(), statusLine: marketStatusLine() },
  });
});

// Probes FMP reachability from this host without going through the
// refresh stream. Hits a tiny payload so connectivity issues surface
// in a second or two instead of hanging the whole pipeline.
app.get('/api/debug/fmp-ping', requireAdmin, async (req, res) => {
  const key = process.env.FMP_API_KEY || '';
  const base = 'https://financialmodelingprep.com/stable';
  const tests = [
    { name: 'screener-limit-1', url: `${base}/company-screener?limit=1&apikey=${key}` },
    { name: 'profile-aapl', url: `${base}/profile?symbol=AAPL&apikey=${key}` },
  ];
  const results = [];
  for (const t of tests) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(t.url, { signal: controller.signal });
      const text = await r.text();
      results.push({
        name: t.name,
        ms: Date.now() - started,
        status: r.status,
        ok: r.ok,
        body_preview: text.slice(0, 300),
        body_bytes: text.length,
      });
    } catch (e) {
      results.push({
        name: t.name,
        ms: Date.now() - started,
        error: e.name === 'AbortError' ? 'timeout after 10s' : (e.message || String(e)),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  res.json({ key_set: !!key, results });
});

// ── Admin Enrichment Job Control (background continuous updater) ──────────
app.get('/api/debug/enrichment', requireAdmin, (req, res) => {
  res.json(enrichmentManager.getStatus());
});

app.post('/api/debug/enrichment', requireAdmin, (req, res) => {
  const { action, rpm } = req.body || {};
  if (action === 'start') {
    enrichmentManager.start();
  } else if (action === 'stop') {
    enrichmentManager.stop();
  } else if (action === 'kill' || action === 'abort' || action === 'stop-all' || action === 'kill-all') {
    // Kill background + abort all in-flight FMP fetches (universe refresh, user gathers, etc.)
    enrichmentManager.stop();
    try { fmp.abortAllOngoingFetches?.(); } catch {}
  }
  if (typeof rpm === 'number' && rpm > 0) {
    enrichmentManager.setRpm(rpm);
  }
  res.json({ ok: true, status: enrichmentManager.getStatus() });
});

// Final guard for all /api/*: always return JSON, never the SPA HTML or default "Cannot POST" page.
// This prevents client-side .json() crashes ("Unexpected token '<'") when a route is missing
// (e.g. after editing server code without restart in dev) or for any unknown API path.
// In dev this turns missing-route cases into clean HTTP 404 JSON instead of confusing parse fails.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', method: req.method, path: req.path });
});

// Serve built React app in production. Vite emits content-hashed filenames
// under /assets, so those can be cached hard (a redeploy changes the hash);
// index.html must always revalidate so clients pick up new bundles.
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath, {
  index: false,
  setHeaders: (res, filePath) => {
    if (/[\\/]assets[\\/]/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(png|svg|jpg|jpeg|webp|ico|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(distPath, 'index.html'));
});

server = app.listen(PORT, '0.0.0.0', () => {
  const fmpSet = process.env.FMP_API_KEY && process.env.FMP_API_KEY !== 'your_fmp_api_key_here';
  const chatSet = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here';
  console.log(`Server running on http://0.0.0.0:${PORT} (accessible on all interfaces)`);
  console.log(`FMP API key: ${fmpSet ? 'set ✓' : 'NOT SET — add FMP_API_KEY to .env'}`);
  console.log(`FMP MCP for Ori: ${fmpSet && process.env.FMP_MCP_ENABLED !== 'false' ? 'enabled ✓' : 'disabled'}`);
  console.log(`Gemini API key: ${chatSet ? 'set ✓' : 'NOT SET — add GEMINI_API_KEY to .env for AI chat'}`);
  console.log(`DB path: ${process.env.DB_PATH || './data/screener.db'}`);
  let accountCount = 0;
  try {
    if (hasDbUsersAtStartup) {
      accountCount = db.userCount();
    } else if (AUTH_PASSWORD) {
      accountCount = 1;
    }
  } catch {}

  console.log(
    `Auth: ${
      isAuthEnabled()
        ? `enabled (cookie sessions, accounts: ${accountCount})`
        : 'DISABLED — set AUTH_PASSWORD or AUTH_USERS_JSON to enable'
    }`,
  );
  console.log(`Environment: ${APP_ENV}${process.env.PAYPAL_ENV ? ` (PayPal: ${process.env.PAYPAL_ENV})` : ''}`);

  // Bootstrap the server-wide Gemini context cache for Ori chat's static system
  // prompt. (The Game Plan system prompt is ~500 tokens — far below Gemini's
  // context-cache minimum — so it is sent inline, not cached.)
  if (chatSet) {
    ensureChatContextCaches()
      .catch((e) => console.warn('[geminiCache] chat boot failed:', e.message))
      .finally(() => startChatContextCacheRefresh());
  }

  // Start the always-on low-rate background enrichment job (if not disabled)
  startBackgroundEnrichmentIfEnabled();
  startWatchlistAlertJobs();

  // One-time: backfill the screener momentum signal from sparklines we already
  // have, so the Conviction technicals factor lights up immediately instead of
  // waiting for the slow re-enrich cycle. Deferred + guarded so it never blocks boot.
  setTimeout(() => {
    try {
      const n = db.backfillMomentum();
      if (n) console.log(`[momentum] backfilled ~45d momentum for ${n} stocks`);
    } catch (e) {
      console.error('[momentum] backfill failed:', e.message);
    }
    try {
      const t = db.backfillTrend();
      if (t) console.log(`[momentum] backfilled SMA50/200 trend for ${t} stocks`);
    } catch (e) {
      console.error('[momentum] trend backfill failed:', e.message);
    }
  }, 4000);

  // Downgrade accounts whose post-cancellation grace period has ended. Runs at
  // startup and hourly; lazy reconcile in /auth/me handles active users sooner.
  // The same sweep prunes stale Ori-usage ledger rows (kept ~3 months).
  try { db.expireLapsedPro(); } catch (e) { console.error('[billing] startup expire failed:', e.message); }
  try { pruneOldOriUsage(); } catch (e) { console.error('[oriUsage] startup prune failed:', e.message); }
  try { db.pruneExpiredAuthSessions(); } catch (e) { console.error('[auth] startup session prune failed:', e.message); }
  setInterval(() => {
    try { db.expireLapsedPro(); } catch (e) { console.error('[billing] expire sweep failed:', e.message); }
    try { pruneOldOriUsage(); } catch (e) { console.error('[oriUsage] prune sweep failed:', e.message); }
    try { db.pruneLoginEvents(Date.now() - 90 * 24 * 60 * 60 * 1000); } catch (e) { console.error('[auth] login-event prune failed:', e.message); }
    try { db.pruneExpiredAuthSessions(); } catch (e) { console.error('[auth] session prune failed:', e.message); }
  }, 60 * 60 * 1000).unref?.();

  // Optional baseline for screener intangibles: a deliberately SLOW, CHEAP,
  // lite-only trickle. It is OFF unless SCREENER_INTANGIBLES_ENABLED=true.
  // Each hourly tick generates a lite review for just the next
  // SCREENER_INTANGIBLES_BATCH (default 1) large-cap name that doesn't already
  // have one — working down from the biggest above the $10B floor
  // (SCREENER_INTANGIBLES_MIN_MCAP, stocks only, no ETFs). It is CACHE-AWARE: a name
  // is skipped while it holds a lite review inside the long screener TTL (≈30d) or a
  // fresh frontier Pro cache, so the job advances to the next uncovered name, covers
  // the bounded large-cap set, then idles — only re-spending as ≈30d reviews age
  // out. NO bursting: the calls run one at a time through the cap-1 lite lane (never
  // starves chat/DR), and geminiGenerateJson backs off rather than hammering on a
  // "too busy". Coverage ≈ BATCH × (24 / TICK_hours) names/day (default ≈24/day);
  // bump BATCH only if you want the first sweep to finish sooner.
  //
  // Production-only and explicit opt-in: dev/staging must never spend on this
  // background job, even when NODE_ENV=production.
  const trickleEnabled = backgroundLiteIntangiblesEnabled();
  if (trickleEnabled) {
    const TICK_MS = Number(process.env.SCREENER_INTANGIBLES_TICK_MS) || 60 * 60 * 1000; // hourly
    const BATCH = Number(process.env.SCREENER_INTANGIBLES_BATCH) || 1; // names generated per tick
    const geminiSet = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here';
    if (geminiSet) {
      setInterval(async () => {
        try {
          const backlog = db.nextIntangiblesBacklog(Date.now(), BATCH);
          for (const sym of backlog) {
            await generateLiteIntangibles(sym, {}); // lite-only, long-cached, one at a time
          }
        } catch (e) {
          console.error('[intangibles] baseline trickle failed:', e.message);
        }
      }, TICK_MS).unref?.();
    }
  }
});

// Graceful shutdown (important for clean Ctrl+C and stopping long-running enrich)
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received. Shutting down gracefully...`);

  const finish = () => {
    // best-sqlite3 connections are usually fine to just let GC, but we can be explicit.
    // `db` is a namespace import, so the Database instance (with .close) is db.default —
    // db.close itself is undefined and the old call silently did nothing.
    try {
      db.default?.close?.();
      console.log('Database connection closed.');
    } catch (e) {
      // ignore
    }

    process.exit(exitCode);
  };

  try { enrichmentManager.stop(); } catch { /* ignore */ }
  try { fmp.abortAllOngoingFetches?.(); } catch { /* ignore */ }

  if (server?.listening) {
    server.close(() => {
      console.log('HTTP server closed.');
      finish();
    });
  } else {
    finish();
    return;
  }

  // Force exit after 5 seconds if something is stuck (e.g. long FMP calls)
  setTimeout(() => {
    console.log('Forcing shutdown after timeout.');
    process.exit(exitCode || 1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
