import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCachedGamePlan,
  readFreshFrontierGamePlan,
  GAME_PLAN_TTL_MS,
} from '../gamePlanCache.js';
import sqliteDb, { kvSet } from '../db.js';

const sym = 'ZZGPCACHE';
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
  sqliteDb.prepare('DELETE FROM kv_cache WHERE key LIKE ?').run(`gameplan%:${sym}`);
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
  const read = readFreshFrontierGamePlan(sym, cache, GAME_PLAN_TTL_MS);
  assert.equal(read.bottomLine, 'Pro take');
  assert.ok(cache.detailCache.has(`gameplan:${sym}`));
});