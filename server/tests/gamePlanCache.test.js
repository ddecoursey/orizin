import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCachedGamePlan,
  readFreshFrontierGamePlan,
  shouldRunLiteIntangiblesGeneration,
  isFreshDetailCache,
  gamePlanFrontierTtlMs,
  gamePlanLiteTtlMs,
  screenerLiteTtlMs,
  screenerMinMcap,
  gamePlanMaxOutputTokens,
} from '../gamePlanCache.js';
import sqliteDb, { kvSet, nextIntangiblesBacklog } from '../db.js';

const sym = 'ZZGPCACHE';
const sym2 = 'ZZGPCACHE2';
const frontier = { bottomLine: 'Pro take', modelTier: 'frontier', convictionDelta: 2 };
const lite = { bottomLine: 'Lite take', modelTier: 'lite', convictionDelta: 0 };

function deps() {
  const detailCache = new Map();
  return {
    detailCache,
    kvGet: (key) => {
      const row = sqliteDb.prepare('SELECT data, updated_at FROM kv_cache WHERE key = ?').get(key);
      if (!row) return null;
      try {
        return { data: JSON.parse(row.data), updatedAt: row.updated_at };
      } catch {
        return null;
      }
    },
    promote: (key, data, at) => detailCache.set(key, { at, data }),
  };
}

test.after(() => {
  sqliteDb.prepare('DELETE FROM kv_cache WHERE key LIKE ?').run(`gameplan%:${sym}%`);
  sqliteDb.prepare('DELETE FROM kv_cache WHERE key LIKE ?').run(`gameplan%:${sym2}%`);
  // Also drop the synthetic stocks rows these tests insert, so the shared dev DB
  // (which the local prod build also serves) isn't left with phantom mega-caps.
  sqliteDb.prepare('DELETE FROM stocks WHERE symbol IN (?, ?)').run(sym, sym2);
});

test('isFreshDetailCache respects ttl boundary', () => {
  const ttl = gamePlanFrontierTtlMs();
  const now = 1_700_000_000_000;
  assert.equal(isFreshDetailCache(now - ttl + 1, ttl, now), true);
  assert.equal(isFreshDetailCache(now - ttl, ttl, now), false);
  assert.equal(isFreshDetailCache(null, ttl, now), false);
});

test('frontier TTL defaults to one week', () => {
  const prev = process.env.GAME_PLAN_FRONTIER_TTL_DAYS;
  delete process.env.GAME_PLAN_FRONTIER_TTL_DAYS;
  assert.equal(gamePlanFrontierTtlMs(), 7 * 24 * 60 * 60 * 1000);
  if (prev !== undefined) process.env.GAME_PLAN_FRONTIER_TTL_DAYS = prev;
});

test('lite TTL defaults to 24 hours', () => {
  const prev = process.env.GAME_PLAN_LITE_TTL_HOURS;
  delete process.env.GAME_PLAN_LITE_TTL_HOURS;
  assert.equal(gamePlanLiteTtlMs(), 24 * 60 * 60 * 1000);
  if (prev !== undefined) process.env.GAME_PLAN_LITE_TTL_HOURS = prev;
});

test('resolveCachedGamePlan ignores expired lite so DR can generate frontier', () => {
  const now = Date.now();
  kvSet(`gameplan-lite:${sym}`, lite);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(
    now - 48 * 60 * 60 * 1000,
    `gameplan-lite:${sym}`,
  );

  assert.equal(resolveCachedGamePlan(sym, deps()), null);
});

test('resolveCachedGamePlan prefers frontier over lite from SQLite', () => {
  const now = Date.now();
  kvSet(`gameplan:${sym}`, frontier);
  kvSet(`gameplan-lite:${sym}`, lite);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key LIKE ?').run(now, `gameplan%:${sym}`);

  const hit = resolveCachedGamePlan(sym, deps());
  assert.equal(hit.source, 'frontier');
  assert.equal(hit.ori.bottomLine, 'Pro take');
  assert.equal(hit.tier, 'frontier');
});

test('readFreshFrontierGamePlan promotes SQLite entry into memory', () => {
  const now = Date.now();
  kvSet(`gameplan:${sym}`, frontier);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(now, `gameplan:${sym}`);

  const cache = deps();
  const read = readFreshFrontierGamePlan(sym, cache, gamePlanFrontierTtlMs());
  assert.equal(read.bottomLine, 'Pro take');
  assert.ok(cache.detailCache.has(`gameplan:${sym}`));
});

test('shouldRunLiteIntangiblesGeneration is false when frontier is fresh', () => {
  const now = Date.now();
  kvSet(`gameplan:${sym2}`, frontier);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(now, `gameplan:${sym2}`);

  assert.equal(shouldRunLiteIntangiblesGeneration(sym2, deps()), false);
  assert.equal(shouldRunLiteIntangiblesGeneration(sym2, deps(), { force: true }), true);
});

test('nextIntangiblesBacklog skips leaders with fresh frontier even when lite is stale', () => {
  const now = Date.now();
  kvSet(`gameplan:${sym2}`, frontier);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(now, `gameplan:${sym2}`);
  kvSet(`gameplan-lite:${sym2}`, lite);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(
    now - 31 * 24 * 60 * 60 * 1000, // stale under the 30d screener TTL → only the fresh frontier keeps it out
    `gameplan-lite:${sym2}`,
  );

  sqliteDb.prepare(
    `INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at)
     VALUES (?, 9e12, 1, 0, ?)`,
  ).run(sym2, now);

  const backlog = nextIntangiblesBacklog(now, 20);
  assert.equal(backlog.includes(sym2), false);
});

test('screener lite TTL defaults to 30 days and honors SCREENER_INTANGIBLES_TTL_DAYS', () => {
  const prev = process.env.SCREENER_INTANGIBLES_TTL_DAYS;
  try {
    delete process.env.SCREENER_INTANGIBLES_TTL_DAYS;
    assert.equal(screenerLiteTtlMs(), 30 * 24 * 60 * 60 * 1000);
    process.env.SCREENER_INTANGIBLES_TTL_DAYS = '7';
    assert.equal(screenerLiteTtlMs(), 7 * 24 * 60 * 60 * 1000);
  } finally {
    if (prev === undefined) delete process.env.SCREENER_INTANGIBLES_TTL_DAYS;
    else process.env.SCREENER_INTANGIBLES_TTL_DAYS = prev;
  }
});

test('nextIntangiblesBacklog sweeps the whole universe, never-scored first then by mcap, skipping covered names', () => {
  const now = Date.now();
  // mcaps deliberately above any real stock so order is deterministic against the
  // shared dev DB (which is full of never-scored real names).
  const A = 'ZZSWEEPA'; // biggest, already has a FRESH lite review → covered, skip
  const B = 'ZZSWEEPB'; // never scored → should come FIRST (highest uncovered mcap)
  const C = 'ZZSWEEPC'; // never scored → after B
  sqliteDb.prepare(`INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at) VALUES (?, 9.9e12, 1, 0, ?)`).run(A, now);
  sqliteDb.prepare(`INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at) VALUES (?, 9.8e12, 1, 0, ?)`).run(B, now);
  sqliteDb.prepare(`INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at) VALUES (?, 9.7e12, 1, 0, ?)`).run(C, now);
  // A is covered by a fresh lite review (inside the long screener TTL).
  kvSet(`gameplan-lite:${A}`, lite);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(now, `gameplan-lite:${A}`);

  const backlog = nextIntangiblesBacklog(now, 50);
  assert.equal(backlog.includes(A), false, 'fresh-lite (covered) name is skipped');
  const bi = backlog.indexOf(B);
  const ci = backlog.indexOf(C);
  assert.ok(bi >= 0 && ci >= 0, 'both never-scored names are queued');
  assert.ok(bi < ci, 'never-scored names ordered by market cap (B before C)');

  sqliteDb.prepare('DELETE FROM kv_cache WHERE key LIKE ?').run('gameplan%:ZZSWEEP%');
  for (const s of [A, B, C]) sqliteDb.prepare('DELETE FROM stocks WHERE symbol = ?').run(s);
});

test('screenerMinMcap defaults to $10B and honors SCREENER_INTANGIBLES_MIN_MCAP', () => {
  const prev = process.env.SCREENER_INTANGIBLES_MIN_MCAP;
  try {
    delete process.env.SCREENER_INTANGIBLES_MIN_MCAP;
    assert.equal(screenerMinMcap(), 10e9);
    process.env.SCREENER_INTANGIBLES_MIN_MCAP = '2000000000';
    assert.equal(screenerMinMcap(), 2e9);
  } finally {
    if (prev === undefined) delete process.env.SCREENER_INTANGIBLES_MIN_MCAP;
    else process.env.SCREENER_INTANGIBLES_MIN_MCAP = prev;
  }
});

test('nextIntangiblesBacklog skips names below the $10B market-cap floor', () => {
  const now = Date.now();
  const BIG = 'ZZFLOORBIG';   // $9.95T, above floor → queued
  const SMALL = 'ZZFLOORSML'; // $1B, below floor → never trickled
  sqliteDb.prepare(`INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at) VALUES (?, 9.95e12, 1, 0, ?)`).run(BIG, now);
  sqliteDb.prepare(`INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at) VALUES (?, 1e9, 1, 0, ?)`).run(SMALL, now);

  const backlog = nextIntangiblesBacklog(now, 50);
  assert.equal(backlog.includes(SMALL), false, 'sub-$10B name is never trickled');
  assert.equal(backlog.includes(BIG), true, 'above-floor name is queued');

  for (const s of [BIG, SMALL]) sqliteDb.prepare('DELETE FROM stocks WHERE symbol = ?').run(s);
});

test('gamePlanMaxOutputTokens defaults to 4000 and honors GAME_PLAN_MAX_OUTPUT', () => {
  const prev = process.env.GAME_PLAN_MAX_OUTPUT;
  try {
    delete process.env.GAME_PLAN_MAX_OUTPUT;
    assert.equal(gamePlanMaxOutputTokens(), 4000);

    process.env.GAME_PLAN_MAX_OUTPUT = '6000';
    assert.equal(gamePlanMaxOutputTokens(), 6000);

    // Garbage / non-positive falls back to the default rather than truncating to 0.
    process.env.GAME_PLAN_MAX_OUTPUT = 'nope';
    assert.equal(gamePlanMaxOutputTokens(), 4000);
    process.env.GAME_PLAN_MAX_OUTPUT = '0';
    assert.equal(gamePlanMaxOutputTokens(), 4000);
  } finally {
    if (prev == null) delete process.env.GAME_PLAN_MAX_OUTPUT;
    else process.env.GAME_PLAN_MAX_OUTPUT = prev;
  }
});

test('a sub-frontier gameplan: entry goes stale at the lite TTL; frontier stays fresh ~7d', () => {
  const s = 'ZZGPTIER';
  const value = { bottomLine: 'Value take', modelTier: 'value', convictionDelta: 1 };
  const ageTo = (key, ms) =>
    sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(Date.now() - ms, key);
  try {
    // Value-tier take aged ~36h: past the 24h lite window, well within 7d. It only
    // landed under gameplan: because frontier was busy, so it must NOT be pinned —
    // it reads as stale so the next open re-attempts Pro (self-heal).
    kvSet(`gameplan:${s}`, value);
    ageTo(`gameplan:${s}`, 36 * 60 * 60 * 1000);
    assert.equal(readFreshFrontierGamePlan(s, deps()), null);
    assert.equal(resolveCachedGamePlan(s, deps()), null);
    assert.equal(shouldRunLiteIntangiblesGeneration(s, deps()), true);

    // Same age, but a REAL frontier take → still authoritative for the full ~7d.
    kvSet(`gameplan:${s}`, frontier);
    ageTo(`gameplan:${s}`, 36 * 60 * 60 * 1000);
    assert.equal(resolveCachedGamePlan(s, deps())?.tier, 'frontier');

    // A FRESH value take (inside the lite window) is still served instantly.
    kvSet(`gameplan:${s}`, value);
    ageTo(`gameplan:${s}`, 1 * 60 * 60 * 1000);
    assert.equal(readFreshFrontierGamePlan(s, deps())?.modelTier, 'value');
  } finally {
    sqliteDb.prepare('DELETE FROM kv_cache WHERE key LIKE ?').run(`gameplan%:${s}`);
  }
});
