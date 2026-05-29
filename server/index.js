import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import stocksRouter from './routes/stocks.js';
import chatRouter from './routes/chat.js';
import usersRouter from './routes/users.js';
import settingsRouter from './routes/settings.js';
import * as db from './db.js';

// Simple in-memory error logger for debugging
const errorLog = [];
const MAX_ERRORS = 200;

export function logError(message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    ...details,
  };
  errorLog.unshift(entry);
  if (errorLog.length > MAX_ERRORS) {
    errorLog.pop();
  }
  console.error(`[DEBUG ERROR] ${message}`, details);
}

export function getErrors(limit = 100) {
  return errorLog.slice(0, limit);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();

app.set('trust proxy', true); // honor X-Forwarded-Proto from Railway's edge

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow for Vite dev + inline scripts if needed
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Rate limit login attempts (protect against brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 login requests per window
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false, // We intentionally set trust proxy for Railway
  },
});

// Admin-only middleware
export function requireAdmin(req, res, next) {
  try {
    // Prefer DB users
    const user = db.getUserByUsername(req.userId);
    if (user && user.is_admin) {
      return next();
    }

    // Legacy fallback: when using AUTH_PASSWORD and no DB users yet,
    // treat the authenticated user as admin.
    const hasUsersNow = (db.userCount?.() ?? 0) > 0;
    if (!hasUsersNow && req.userId && AUTH_PASSWORD) {
      return next();
    }
  } catch (e) {
    console.error('[auth] requireAdmin error:', e);
  }
  return res.status(403).json({ error: 'Admin access required' });
}

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

// Bootstrap users from AUTH_USERS_JSON into DB (one-time on first run)
function bootstrapUsersFromEnv() {
  if (!process.env.AUTH_USERS_JSON) return;

  try {
    const count = db.userCount();
    if (count === 0) {
      console.log('[auth] Bootstrapping users from AUTH_USERS_JSON into database...');
      const arr = JSON.parse(process.env.AUTH_USERS_JSON);
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry?.user && entry?.password) {
            const isAdmin = ['dylan', 'admin'].includes(String(entry.user).toLowerCase());
            const result = db.createUser(entry.user, entry.password, isAdmin);
            if (result.success) {
              console.log(`[auth]   Created user: ${entry.user}${isAdmin ? ' (admin)' : ''}`);
            } else {
              console.log(`[auth]   Failed to create ${entry.user}: ${result.error}`);
            }
          }
        }
      }
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
        console.log(`[auth] Promoted ${name} to admin`);
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
const hasDbUsersAtStartup = db.userCount() > 0;

// Derive a stable signing key. 
// Strongly recommended: Set AUTH_SECRET in your environment (especially on Railway)
// so sessions survive server restarts.
const AUTH_SECRET = process.env.AUTH_SECRET
  || crypto.createHash('sha256')
       .update(`orizen-session-v1:stable-dev-secret`)   // stable default for local dev
       .digest('hex');

// Legacy single-user mode still supported via AUTH_PASSWORD
const legacyAuthEnabled = !!AUTH_PASSWORD;

// Dynamic helper: is auth required right now?
function isAuthEnabled() {
  // If we have DB users, auth is always on.
  // Otherwise fall back to legacy AUTH_PASSWORD mode.
  try {
    return db.userCount() > 0 || legacyAuthEnabled;
  } catch {
    return legacyAuthEnabled;
  }
}
const COOKIE_NAME = 'orizen_auth';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
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

function buildCookie(name, value, { maxAgeMs, secure }) {
  const parts = [
    `${name}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Auth endpoints — accessible without a session.
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const currentlyAuthEnabled = isAuthEnabled();
  if (!currentlyAuthEnabled) return res.json({ ok: true, user: 'default', authEnabled: false });

  const username = String(req.body?.user || '');
  const password = String(req.body?.password || '');

  let match = null;

  // Prefer database users (hashed passwords) when available
  try {
    const dbUser = db.verifyUserPassword(username, password);
    if (dbUser) {
      match = { user: dbUser.username, isAdmin: !!dbUser.isAdmin };
    }
  } catch (e) {
    console.error('[auth] Error verifying user from DB:', e.message);
  }

  // Legacy fallback (plaintext from env) if no DB users exist yet
  const hasUsersNow = (db.userCount?.() ?? 0) > 0;
  if (!match && !hasUsersNow && AUTH_PASSWORD) {
    if (safeEqual(username, AUTH_USER) && safeEqual(password, AUTH_PASSWORD)) {
      match = { user: AUTH_USER, isAdmin: true };
    }
  }

  if (!match) return res.status(401).json({ error: 'Invalid username or password' });

  const tokenPayload = {
    user: match.user,
    isAdmin: !!match.isAdmin,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  };
  const token = signToken(tokenPayload);

  res.set('Set-Cookie', buildCookie(COOKIE_NAME, token, {
    maxAgeMs: SESSION_MAX_AGE_MS,
    secure: req.secure,
  }));
  res.json({ ok: true, user: match.user, isAdmin: !!match.isAdmin });
});

app.post('/api/auth/logout', (req, res) => {
  res.set('Set-Cookie', buildCookie(COOKIE_NAME, '', {
    maxAgeMs: 0,
    secure: req.secure,
  }));
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const currentlyAuthEnabled = isAuthEnabled();
  if (!currentlyAuthEnabled) return res.json({ user: 'default', authenticated: true, authEnabled: false });
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ authenticated: false, authEnabled: true });

  // Prefer the isAdmin flag that was embedded in the token at login time.
  // Fall back to a DB lookup only if it's missing (old tokens).
  let isAdmin = typeof payload.isAdmin === 'boolean' 
    ? payload.isAdmin 
    : false;

  if (typeof payload.isAdmin !== 'boolean') {
    try {
      const dbUser = db.getUserByUsername(payload.user);
      isAdmin = !!(dbUser && dbUser.is_admin);
    } catch (e) {
      console.error('[auth] Error looking up user in /me:', e.message);
    }
  }

  res.json({ user: payload.user, isAdmin, authenticated: true, authEnabled: true });
});

// Public status endpoint — used by the login page to decide whether to show
// "Create First Admin" setup flow or normal login.
app.get('/api/auth/status', (req, res) => {
  const userCount = db.userCount ? db.userCount() : 0;
  res.json({
    needsSetup: userCount === 0,
    authEnabled: isAuthEnabled(),
    hasUsers: userCount > 0,
  });
});

// One-time setup endpoint: create the very first admin user when the database is empty.
// This is unauthenticated and only works if there are currently zero users.
app.post('/api/auth/setup-first-admin', loginLimiter, (req, res) => {
  const userCount = db.userCount ? db.userCount() : 0;
  if (userCount > 0) {
    return res.status(400).json({ error: 'Setup is only allowed when there are no users yet' });
  }

  const username = String(req.body?.user || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const result = db.createUser(username, password, true); // first user is always admin

  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Failed to create user' });
  }

  // Automatically log the new admin in
  const tokenPayload = {
    user: username,
    isAdmin: true,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  };
  const token = signToken(tokenPayload);

  res.set('Set-Cookie', buildCookie(COOKIE_NAME, token, {
    maxAgeMs: SESSION_MAX_AGE_MS,
    secure: req.secure,
  }));

  res.json({ ok: true, user: username, isAdmin: true, message: 'First admin account created successfully' });
});

// Gate the rest of /api/* on a valid session cookie, and attach the
// current user's id to req so downstream routes can scope per-user data.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (!isAuthEnabled()) {
    req.userId = 'default';
    return next();
  }
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
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

// API routes
app.use('/api', stocksRouter);
app.use('/api', chatRouter);
app.use('/api', usersRouter);
app.use('/api', settingsRouter);

// Global error handler for all /api routes — ensures we never return HTML
app.use('/api', (err, req, res, next) => {
  console.error('[API Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Debug error logging endpoints (admin only)
app.post('/api/debug/errors', requireAdmin, (req, res) => {
  const { message, ...rest } = req.body || {};
  if (message) {
    logError(message, rest);
  }
  res.json({ ok: true });
});

app.get('/api/debug/errors', requireAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({ errors: getErrors(limit) });
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

// Serve built React app in production
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const fmpSet = process.env.FMP_API_KEY && process.env.FMP_API_KEY !== 'your_fmp_api_key_here';
  const chatSet = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here';
  console.log(`Server running on http://0.0.0.0:${PORT} (accessible on all interfaces)`);
  console.log(`FMP API key: ${fmpSet ? 'set ✓' : 'NOT SET — add FMP_API_KEY to .env'}`);
  console.log(`Gemini API key: ${chatSet ? 'set ✓' : 'NOT SET — add GEMINI_API_KEY to .env for AI chat'}`);
  console.log(`DB path: ${process.env.DB_PATH || './data/screener.db'}`);
  let userList = 'none';
  try {
    if (hasDbUsersAtStartup) {
      const users = db.listUsers ? db.listUsers() : [];
      userList = users.map(u => u.username).join(', ') || 'none';
    } else if (AUTH_PASSWORD) {
      userList = AUTH_USER;
    }
  } catch {}

  console.log(
    `Auth: ${
      isAuthEnabled()
        ? `enabled (cookie sessions, users: ${userList})`
        : 'DISABLED — set AUTH_PASSWORD or AUTH_USERS_JSON to enable'
    }`,
  );
});

// Graceful shutdown (important for clean Ctrl+C and stopping long-running enrich)
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close(() => {
    console.log('HTTP server closed.');

    // best-sqlite3 connections are usually fine to just let GC, but we can be explicit
    try {
      db.close?.();
      console.log('Database connection closed.');
    } catch (e) {
      // ignore
    }

    process.exit(0);
  });

  // Force exit after 5 seconds if something is stuck (e.g. long FMP calls)
  setTimeout(() => {
    console.log('Forcing shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
