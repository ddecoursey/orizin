// Regression suite for the Orizen API surface. Spawns the real server against
// a throwaway SQLite database with no FMP/Gemini keys, so every test exercises
// the actual express stack (auth, gating, caching headers, gzip, JSON guards)
// without spending API quota.
//
// Run: npm test   (node --test server/tests/)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { marketSession } from '../marketHours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'index.js');

const PORT = 4870 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

let serverProc;
let tmpDir;
let adminCookie = '';
let userCookie = '';

function api(p) {
  return `${BASE}${p}`;
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON, got: ${text.slice(0, 200)}`);
  }
}

function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

before(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'orizen-test-'));
  serverProc = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(tmpDir, 'screener.db'),
      // Explicit empties beat .env (dotenv never overrides existing vars) —
      // guarantees no live FMP/Gemini calls and a clean auth slate.
      FMP_API_KEY: '',
      GEMINI_API_KEY: '',
      AUTH_PASSWORD: '',
      AUTH_USERS_JSON: '',
      ENABLE_BACKGROUND_ENRICH: 'false',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  // Wait for readiness
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(api('/api/auth/status'));
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not become ready in 15s');
});

after(() => {
  serverProc?.kill('SIGTERM');
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup
  }
});

// ── Auth & first-run setup ──────────────────────────────────────────────────

test('auth status reports needsSetup on a fresh database', async () => {
  const res = await fetch(api('/api/auth/status'));
  const body = await json(res);
  assert.equal(body.needsSetup, true);
  assert.equal(body.hasUsers, false);
});

test('setup-first-admin creates an admin and logs them in', async () => {
  const res = await fetch(api('/api/auth/setup-first-admin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin1', password: 'secret123' }),
  });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.isAdmin, true);
  adminCookie = cookieFrom(res);
  assert.ok(adminCookie.startsWith('orizen_auth='));
});

test('setup-first-admin refuses once a user exists', async () => {
  const res = await fetch(api('/api/auth/setup-first-admin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'evil', password: 'evilpass' }),
  });
  assert.equal(res.status, 400);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await fetch(api('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin1', password: 'wrong' }),
  });
  assert.equal(bad.status, 401);

  const good = await fetch(api('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin1', password: 'secret123' }),
  });
  const body = await json(good);
  assert.equal(good.status, 200);
  assert.equal(body.isAdmin, true);
});

test('/api/auth/me reflects the session', async () => {
  const res = await fetch(api('/api/auth/me'), { headers: { cookie: adminCookie } });
  const body = await json(res);
  assert.equal(body.authenticated, true);
  assert.equal(body.user, 'admin1');
  assert.equal(body.isAdmin, true);
});

test('API requests without a session are rejected once auth is enabled', async () => {
  const res = await fetch(api('/api/stocks'));
  assert.equal(res.status, 401);
});

// ── User management ─────────────────────────────────────────────────────────

test('admin can create a non-admin user; non-admin cannot manage users', async () => {
  const create = await fetch(api('/api/users'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ username: 'viewer', password: 'viewer123' }),
  });
  assert.equal((await json(create)).ok, true);

  const login = await fetch(api('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'viewer', password: 'viewer123' }),
  });
  assert.equal(login.status, 200);
  userCookie = cookieFrom(login);

  const list = await fetch(api('/api/users'), { headers: { cookie: userCookie } });
  assert.equal(list.status, 403);
});

test('cannot demote or delete the last admin', async () => {
  const demote = await fetch(api('/api/users/admin1'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ isAdmin: false }),
  });
  assert.equal(demote.status, 400);

  const del = await fetch(api('/api/users/admin1'), {
    method: 'DELETE',
    headers: { cookie: adminCookie },
  });
  assert.equal(del.status, 400);
});

test('change-password verifies the current password', async () => {
  const wrong = await fetch(api('/api/users/change-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ currentPassword: 'nope', newPassword: 'changed123' }),
  });
  assert.equal(wrong.status, 401);

  const right = await fetch(api('/api/users/change-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ currentPassword: 'viewer123', newPassword: 'changed123' }),
  });
  assert.equal((await json(right)).ok, true);

  const relogin = await fetch(api('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'viewer', password: 'changed123' }),
  });
  assert.equal(relogin.status, 200);
});

// ── Per-user settings ───────────────────────────────────────────────────────

test('settings are stored per user and shallow-merged', async () => {
  const empty = await json(await fetch(api('/api/settings'), { headers: { cookie: userCookie } }));
  assert.deepEqual(empty.data, {});

  await fetch(api('/api/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ theme: 'light' }),
  });
  await fetch(api('/api/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ weights: { q: 40, v: 30, g: 30 } }),
  });

  const merged = await json(await fetch(api('/api/settings'), { headers: { cookie: userCookie } }));
  assert.equal(merged.data.theme, 'light');
  assert.deepEqual(merged.data.weights, { q: 40, v: 30, g: 30 });

  // The other user's settings are untouched.
  const adminSettings = await json(await fetch(api('/api/settings'), { headers: { cookie: adminCookie } }));
  assert.equal(adminSettings.data.theme, undefined);
});

// ── Stocks API ──────────────────────────────────────────────────────────────

test('GET /api/stocks returns an empty universe with meta', async () => {
  const res = await fetch(api('/api/stocks'), { headers: { cookie: userCookie } });
  const body = await json(res);
  assert.deepEqual(body.stocks, []);
  assert.equal(body.meta.count, 0);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('GET /api/stocks/:symbol 404s for unknown symbols', async () => {
  const res = await fetch(api('/api/stocks/NOPE'), { headers: { cookie: userCookie } });
  assert.equal(res.status, 404);
});

test('GET /api/status reports counts and key flags', async () => {
  const body = await json(await fetch(api('/api/status'), { headers: { cookie: userCookie } }));
  assert.equal(body.stockCount, 0);
  assert.equal(body.apiKeySet, false);
  assert.equal(body.chatKeySet, false);
});

test('refresh and enrich are admin-only', async () => {
  for (const p of ['/api/stocks/refresh', '/api/stocks/enrich']) {
    const res = await fetch(api(p), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: userCookie },
      body: '{}',
    });
    assert.equal(res.status, 403, `${p} should be 403 for non-admin`);
    const body = await json(res);
    assert.ok(body.error);
  }
});

test('sparkline endpoint degrades cleanly without an FMP key', async () => {
  const res = await fetch(api('/api/stocks/sparkline/AAPL?days=45'), {
    headers: { cookie: userCookie },
  });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.deepEqual(body.prices, []);
});

// ── Chat & Ori memory ───────────────────────────────────────────────────────

test('chat requires a message and a configured key', async () => {
  const noMsg = await fetch(api('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ message: '   ' }),
  });
  assert.equal(noMsg.status, 400);

  const noKey = await fetch(api('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ message: 'hello' }),
  });
  assert.equal(noKey.status, 503);
});

test('chat sessions list is per user and empty initially', async () => {
  const body = await json(await fetch(api('/api/chat/sessions'), { headers: { cookie: userCookie } }));
  assert.deepEqual(body.sessions, []);
});

test('Ori memory CRUD', async () => {
  const empty = await json(await fetch(api('/api/chat/memory'), { headers: { cookie: userCookie } }));
  assert.deepEqual(empty.memory, []);

  const missing = await fetch(api('/api/chat/memory/0'), {
    method: 'DELETE',
    headers: { cookie: userCookie },
  });
  assert.equal(missing.status, 404);

  const cleared = await json(
    await fetch(api('/api/chat/memory'), { method: 'DELETE', headers: { cookie: userCookie } }),
  );
  assert.deepEqual(cleared.memory, []);
});

// ── Debug endpoints ─────────────────────────────────────────────────────────

test('debug endpoints are admin-only', async () => {
  for (const p of ['/api/debug/errors', '/api/debug/enrichment', '/api/debug/fmp-stats']) {
    const res = await fetch(api(p), { headers: { cookie: userCookie } });
    assert.equal(res.status, 403, `${p} should be 403 for non-admin`);
  }
});

test('error log accepts single and batched entries; clear works', async () => {
  await fetch(api('/api/debug/errors'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: userCookie },
    body: JSON.stringify({ message: 'single entry from non-admin' }),
  });
  await fetch(api('/api/debug/errors'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ entries: [{ message: 'batch a' }, { message: 'batch b' }] }),
  });

  const log = await json(
    await fetch(api('/api/debug/errors?limit=50'), { headers: { cookie: adminCookie } }),
  );
  const messages = log.errors.map((e) => e.message);
  assert.ok(messages.includes('single entry from non-admin'));
  assert.ok(messages.includes('batch a'));
  assert.ok(messages.includes('batch b'));

  const cleared = await json(
    await fetch(api('/api/debug/errors/clear'), { method: 'POST', headers: { cookie: adminCookie } }),
  );
  assert.equal(cleared.ok, true);
  const after = await json(
    await fetch(api('/api/debug/errors'), { headers: { cookie: adminCookie } }),
  );
  assert.equal(after.errors.length, 0);
});

test('fmp-stats exposes usage, cache, freshness, and market session', async () => {
  const body = await json(
    await fetch(api('/api/debug/fmp-stats'), { headers: { cookie: adminCookie } }),
  );
  assert.ok(body.fmp);
  assert.equal(typeof body.fmp.total.calls, 'number');
  assert.ok(Array.isArray(body.fmp.byEndpoint));
  assert.ok(body.detailCache);
  assert.ok(body.freshness);
  assert.equal(typeof body.freshness.kvCache, 'number');
  assert.ok(['open', 'pre', 'after', 'closed'].includes(body.market.session));
});

test('enrichment status reports market session and quote counter', async () => {
  const body = await json(
    await fetch(api('/api/debug/enrichment'), { headers: { cookie: adminCookie } }),
  );
  assert.equal(typeof body.quotesRefreshed, 'number');
  assert.ok(['open', 'pre', 'after', 'closed'].includes(body.marketSession));
});

// ── Transport-level behavior ────────────────────────────────────────────────

test('large JSON API responses are gzipped when the client accepts it', async () => {
  // Seed >1KB of log entries so the response crosses the compression floor.
  for (let i = 0; i < 3; i++) {
    await fetch(api('/api/debug/errors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        entries: Array.from({ length: 20 }, (_, k) => ({
          message: `gzip-seed entry ${i}-${k} ${'x'.repeat(64)}`,
        })),
      }),
    });
  }
  // Raw http via fetch auto-decompresses; ask undici not to by reading bytes.
  const res = await fetch(api('/api/debug/errors?limit=100'), {
    headers: { cookie: adminCookie, 'accept-encoding': 'gzip' },
  });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  const buf = Buffer.from(await res.arrayBuffer());
  // undici exposes the decoded body; verify it parses and is large.
  const parsed = JSON.parse(buf.toString());
  assert.ok(parsed.errors.length >= 50);
});

test('unknown API routes return JSON 404, never HTML', async () => {
  const res = await fetch(api('/api/definitely-not-a-route'), {
    headers: { cookie: userCookie },
  });
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal(body.error, 'API route not found');
});

// ── Market hours (pure unit tests, DST both sides) ──────────────────────────

test('marketSession handles EDT, EST, weekends, and boundaries', () => {
  // Mon 2026-06-08 (EDT = UTC-4)
  assert.equal(marketSession(new Date('2026-06-08T14:00:00Z')), 'open');   // 10:00 ET
  assert.equal(marketSession(new Date('2026-06-08T13:29:00Z')), 'pre');    // 09:29 ET
  assert.equal(marketSession(new Date('2026-06-08T13:30:00Z')), 'open');   // 09:30 ET
  assert.equal(marketSession(new Date('2026-06-08T20:00:00Z')), 'after');  // 16:00 ET
  assert.equal(marketSession(new Date('2026-06-08T19:59:00Z')), 'open');   // 15:59 ET
  // Sat 2026-06-06
  assert.equal(marketSession(new Date('2026-06-06T15:00:00Z')), 'closed');
  // Mon 2026-01-05 (EST = UTC-5)
  assert.equal(marketSession(new Date('2026-01-05T14:30:00Z')), 'open');   // 09:30 ET
  assert.equal(marketSession(new Date('2026-01-05T14:29:00Z')), 'pre');    // 09:29 ET
  // Overnight
  assert.equal(marketSession(new Date('2026-06-09T06:00:00Z')), 'closed'); // 02:00 ET
});
