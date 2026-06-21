import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeWatchlistAlerts } from '../../src/lib/watchlistAlertsConfig.js';
import { invalidateWatchlistUnionCache, getUnionWatchlistSymbols } from '../watchlistSymbols.js';
import { devAlertsTestEnabled, injectTestAlert } from '../watchlistAlerts.js';
import { quoteFieldsFromRow, refreshQuotesForSymbols } from '../watchlistQuotes.js';
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

test('injectTestAlert queues multiple sample alerts by default', () => {
  const userId = '__wl_inject_test__';
  db.patchUserSettings(userId, {
    watchlists: [{ id: 'default', name: 'Watchlist', symbols: ['WLINJ'], updatedAt: 1 }],
  });
  const { alerts, symbol } = injectTestAlert(userId, { symbol: 'WLINJ' });
  assert.equal(symbol, 'WLINJ');
  assert.equal(alerts.length, 3);
  assert.deepEqual(alerts.map((a) => a.type), ['price', 'news', 'conviction']);
  const st = db.getWatchlistAlertState(userId, 'WLINJ');
  for (const alert of alerts) {
    assert.ok(st.pending_digest?.some((a) => a.id === alert.id));
  }
});

test('injectTestAlert can queue a single alert', () => {
  const userId = '__wl_inject_single__';
  db.patchUserSettings(userId, {
    watchlists: [{ id: 'default', name: 'Watchlist', symbols: ['WLINJ'], updatedAt: 1 }],
  });
  const { alert, symbol } = injectTestAlert(userId, { symbol: 'WLINJ', type: 'price', multiple: false });
  assert.equal(symbol, 'WLINJ');
  assert.equal(alert.type, 'price');
});

test('sanitizeWatchlistAlerts clamps thresholds and preserves booleans', () => {
  const s = sanitizeWatchlistAlerts({
    enabled: false,
    emailInstant: false,
    priceThresholdPct: 99,
    instantThresholdPct: 1,
  });
  assert.equal(s.enabled, false);
  assert.equal(s.emailInstant, false);
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

test('markWatchlistQuoteDue nulls only price_updated_at', () => {
  const sym = 'ZZWLQ';
  const now = Date.now();
  sqliteDb.prepare(`
    INSERT INTO stocks (symbol, name, sector, industry, price, mcap, has_km, has_rat, updated_at, price_updated_at)
    VALUES (?, 'Test', 'Tech', 'Software', 10, 1e9, 1, 1, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      updated_at = excluded.updated_at,
      price_updated_at = excluded.price_updated_at
  `).run(sym, now, now);

  db.markWatchlistQuoteDue([sym]);
  const row = db.getStock(sym);
  assert.equal(row.price_updated_at, null);
  assert.equal(row.updated_at, now);

  sqliteDb.prepare('DELETE FROM stocks WHERE symbol = ?').run(sym);
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

test('quoteFieldsFromRow and refreshQuotesForSymbols return minimal quote payload', async () => {
  const sym = 'ZZWLQUOTE';
  const now = Date.now();
  sqliteDb.prepare(`
    INSERT INTO stocks (symbol, name, sector, industry, price, volume, mcap, has_km, has_rat, updated_at, price_updated_at)
    VALUES (?, 'Test', 'Tech', 'Software', 42.5, 1000, 1e9, 1, 1, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      price = excluded.price,
      volume = excluded.volume,
      mcap = excluded.mcap,
      updated_at = excluded.updated_at,
      price_updated_at = excluded.price_updated_at
  `).run(sym, now, now);

  const fields = quoteFieldsFromRow(db.getStock(sym));
  assert.deepEqual(Object.keys(fields).sort(), ['mcap', 'price', 'price_updated_at', 'symbol', 'volume']);
  assert.equal(fields.symbol, sym);
  assert.equal(fields.price, 42.5);

  const quotes = await refreshQuotesForSymbols([sym], { staleMs: 0, maxLive: 0 });
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].symbol, sym);
  assert.equal(quotes[0].price, 42.5);
  assert.equal(quotes[0].has_km, undefined);

  sqliteDb.prepare('DELETE FROM stocks WHERE symbol = ?').run(sym);
});