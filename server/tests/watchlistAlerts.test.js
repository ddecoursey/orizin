import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeWatchlistAlerts } from '../../src/lib/watchlistAlertsConfig.js';
import { invalidateWatchlistUnionCache, getUnionWatchlistSymbols } from '../watchlistSymbols.js';
import { devAlertsTestEnabled, injectTestAlert } from '../watchlistAlerts.js';
import sqliteDb, * as db from '../db.js';

const TEST_USER_A = '__wl_test_a__';
const TEST_USER_B = '__wl_test_b__';

test('devAlertsTestEnabled is false under NODE_ENV=test', () => {
  const prevNode = process.env.NODE_ENV;
  const prevApp = process.env.APP_ENV;
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'development';
  try {
    assert.equal(devAlertsTestEnabled(), false);
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevApp;
  }
});

test('injectTestAlert queues a sample price alert', () => {
  const userId = '__wl_inject_test__';
  db.patchUserSettings(userId, {
    watchlists: [{ id: 'default', name: 'Watchlist', symbols: ['WLINJ'], updatedAt: 1 }],
  });
  const { alert, symbol } = injectTestAlert(userId, { symbol: 'WLINJ', type: 'price' });
  assert.equal(symbol, 'WLINJ');
  assert.equal(alert.type, 'price');
  assert.ok(alert.title.includes('WLINJ'));
  const st = db.getWatchlistAlertState(userId, 'WLINJ');
  assert.ok(st.pending_digest?.some((a) => a.id === alert.id));
});

test('sanitizeWatchlistAlerts clamps thresholds and preserves booleans', () => {
  const s = sanitizeWatchlistAlerts({
    enabled: false,
    emailDigest: true,
    priceThresholdPct: 99,
    instantThresholdPct: 1,
  });
  assert.equal(s.enabled, false);
  assert.equal(s.emailDigest, true);
  assert.equal(s.priceThresholdPct, 15);
  assert.equal(s.instantThresholdPct, 5);
});

test('getUnionWatchlistSymbols includes symbols from patched user watchlists', () => {
  db.patchUserSettings(TEST_USER_A, {
    watchlists: [{ id: 'default', name: 'Watchlist', symbols: ['WLTEST1', 'WLTEST2'], updatedAt: 1 }],
  });
  db.patchUserSettings(TEST_USER_B, {
    watchlists: [{ id: 'default', name: 'Watchlist', symbols: ['WLTEST2', 'WLTEST3'], updatedAt: 1 }],
  });

  invalidateWatchlistUnionCache();
  const union = getUnionWatchlistSymbols({ force: true });
  for (const sym of ['WLTEST1', 'WLTEST2', 'WLTEST3']) {
    assert.ok(union.includes(sym), `expected ${sym} in union`);
  }
});

test('markWatchlistGatherDue nulls timestamps for priority rotation', () => {
  const sym = 'ZZWLTEST';
  const now = Date.now();
  sqliteDb.prepare(`
    INSERT INTO stocks (symbol, name, sector, industry, price, mcap, has_km, has_rat, updated_at, price_updated_at)
    VALUES (?, 'Test', 'Tech', 'Software', 10, 1e9, 1, 1, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      updated_at = excluded.updated_at,
      price_updated_at = excluded.price_updated_at
  `).run(sym, now, now);

  db.markWatchlistGatherDue([sym]);
  const row = db.getStock(sym);
  assert.equal(row.price_updated_at, null);
  assert.equal(row.updated_at, null);

  sqliteDb.prepare('DELETE FROM stocks WHERE symbol = ?').run(sym);
});