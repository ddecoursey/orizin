import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCachedGamePlan,
  readFreshFrontierGamePlan,
  gamePlanFrontierTtlMs,
  gamePlanLiteTtlMs,
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

test('nextIntangiblesBacklog skips leaders with fresh frontier even when lite is stale', () => {
  const now = Date.now();
  kvSet(`gameplan:${sym2}`, frontier);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(now, `gameplan:${sym2}`);
  kvSet(`gameplan-lite:${sym2}`, lite);
  sqliteDb.prepare('UPDATE kv_cache SET updated_at = ? WHERE key = ?').run(
    now - 48 * 60 * 60 * 1000,
    `gameplan-lite:${sym2}`,
  );

  sqliteDb.prepare(
    `INSERT OR REPLACE INTO stocks (symbol, mcap, has_km, is_etf, updated_at)
     VALUES (?, 9e12, 1, 0, ?)`,
  ).run(sym2, now);

  const backlog = nextIntangiblesBacklog(now, 500, 20);
  assert.equal(backlog.includes(sym2), false);
});