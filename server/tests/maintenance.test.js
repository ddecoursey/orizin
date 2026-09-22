import './isolatedDb.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import sqlite, * as db from '../db.js';
import { pruneDarkListings, referencedSymbols, runMaintenance, retentionConfig } from '../maintenance.js';

const DAY = 24 * 60 * 60 * 1000;

function listing(symbol, fields = {}) {
  db.saveScreenerBatch([{
    symbol, name: symbol, sector: 'Tech', industry: 'Software', exchange: 'NASDAQ', country: 'US',
    price: 10, mcap: 1e9, volume: 1, beta: 1, div_yield: null, is_etf: 0, updated_at: Date.now(), ...fields,
  }]);
}
const setSeen = (symbol, at) => sqlite.prepare('UPDATE stocks SET price_seen_at = ? WHERE symbol = ?').run(at, symbol);
const healthy = { lastAt: Date.now() - 60_000, lastCount: 5000 };
// Past the observation window and a long-running process.
const settled = { trackingSince: Date.now() - 400 * DAY, uptimeMs: 10 * DAY };

test('a universe/profile refresh updates in place and never resets the fundamentals clock', () => {
  listing('KEEPCLK', { updated_at: 1_000 });
  const before = db.getStock('KEEPCLK');
  listing('KEEPCLK', { price: 11, updated_at: Date.now() });
  const after = db.getStock('KEEPCLK');
  assert.equal(after.price, 11);
  assert.equal(after.updated_at, before.updated_at, 'updated_at is the fundamentals clock');
  assert.ok(after.price_seen_at > before.price_seen_at, 'a returned price counts as seen');
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM stocks WHERE symbol='KEEPCLK'").get().c, 1);
});

test('a failed quote does not count as seeing a price', () => {
  listing('TOUCHQ');
  setSeen('TOUCHQ', 5);
  db.touchQuote('TOUCHQ');
  assert.equal(db.getStock('TOUCHQ').price_seen_at, 5);
  db.saveQuote('TOUCHQ', { price: 12 });
  assert.ok(db.getStock('TOUCHQ').price_seen_at > 5);
});

test('dark listings are removed with their market data; referenced and recent ones are kept', () => {
  const now = Date.now();
  for (const s of ['DARKA', 'DARKB', 'WATCHED', 'FRESHA']) listing(s);
  setSeen('DARKA', now - 60 * DAY);
  setSeen('DARKB', now - 90 * DAY);
  setSeen('WATCHED', now - 90 * DAY);
  db.saveSparkline('DARKA', 45, [{ date: '2026-01-01', price: 1 }]);
  const aiCols = ['dcf', 'stock_price', 'dcf_date', 'target_high', 'target_low', 'target_consensus', 'target_median',
    'revenue_growth', 'net_income_growth', 'eps_growth', 'fcf_growth', 'op_income_growth', 'owner_earnings',
    'owner_eps', 'growth_capex', 'estimates_json'];
  db.saveAiEnrichment('DARKA', Object.fromEntries(aiCols.map((c) => [c, null])));

  const result = pruneDarkListings({ now, stockDays: 45, keep: new Set(['WATCHED']), sweep: healthy, stockCount: 4, ...settled });
  assert.equal(result.removed, 2);
  assert.equal(db.getStock('DARKA'), undefined);
  assert.equal(db.getStock('DARKB'), undefined);
  assert.ok(db.getStock('WATCHED'), 'a watched symbol is never pruned');
  assert.ok(db.getStock('FRESHA'));
  assert.equal(db.getSparkline('DARKA', 45), undefined);
  assert.equal(db.getAiEnrichment('DARKA'), undefined);
});

test('nothing is pruned while the price sweep is unhealthy (e.g. an FMP outage)', () => {
  const now = Date.now();
  listing('OUTAGE');
  setSeen('OUTAGE', now - 400 * DAY);
  for (const sweep of [{}, { lastAt: now - 3 * DAY, lastCount: 9000 }, { lastAt: now, lastCount: 3 }]) {
    const r = pruneDarkListings({ now, stockDays: 45, sweep, stockCount: 1, ...settled });
    assert.equal(r.removed, 0);
    assert.match(r.skipped, /not healthy/);
  }
  assert.ok(db.getStock('OUTAGE'));
  sqlite.prepare("DELETE FROM stocks WHERE symbol='OUTAGE'").run();
});

test('no listing is pruned before a full retention window of tracking, or right after a restart', () => {
  const now = Date.now();
  listing('EARLY');
  setSeen('EARLY', now - 400 * DAY);
  const fresh = pruneDarkListings({ now, stockDays: 45, sweep: healthy, stockCount: 1, trackingSince: now - 10 * DAY, uptimeMs: 10 * DAY });
  assert.equal(fresh.removed, 0);
  assert.match(fresh.skipped, /first retention window/);
  const restarted = pruneDarkListings({ now, stockDays: 45, sweep: healthy, stockCount: 1, trackingSince: now - 400 * DAY, uptimeMs: DAY });
  assert.equal(restarted.removed, 0);
  assert.match(restarted.skipped, /less than 3 days/);
  assert.ok(db.getStock('EARLY'));
  sqlite.prepare("DELETE FROM stocks WHERE symbol='EARLY'").run();
});

test('dark-listing removal is capped per run', () => {
  const now = Date.now();
  for (let i = 0; i < 70; i++) { listing(`CAP${i}`); setSeen(`CAP${i}`, now - 100 * DAY); }
  const r = pruneDarkListings({ now, stockDays: 45, sweep: healthy, stockCount: 1000, ...settled });
  assert.equal(r.removed, 50, 'min(300, max(50, 2% of universe))');
  pruneDarkListings({ now, stockDays: 45, sweep: healthy, stockCount: 1000, ...settled });
});

test('stale universe blobs and old email counters are pruned; live keys are untouched', () => {
  const now = Date.now();
  db.setMeta('universe_rows_cache:us:500000000:1', 'x'.repeat(100));
  db.setMeta('universe_rows_cache_at:us:500000000:1', now - 5 * DAY);
  db.setMeta('universe_rows_cache:global:500000000:1', 'fresh');
  db.setMeta('universe_rows_cache_at:global:500000000:1', now - 60_000);
  db.setMeta('screener_rows_cache', 'legacy'); // no companion timestamp
  db.setMeta('email_sent:2020-01-01', '3');
  const today = new Date(now).toISOString().slice(0, 10);
  db.setMeta(`email_sent:${today}`, '1');
  db.setMeta('last_screener_fetch', now);

  const removed = db.pruneStaleMetaCaches(now - 2 * DAY, {
    emailBeforeDay: new Date(now - 30 * DAY).toISOString().slice(0, 10),
  });
  assert.ok(removed >= 3);
  assert.equal(db.getMeta('universe_rows_cache:us:500000000:1'), null);
  assert.equal(db.getMeta('universe_rows_cache_at:us:500000000:1'), null);
  assert.equal(db.getMeta('screener_rows_cache'), null);
  assert.equal(db.getMeta('email_sent:2020-01-01'), null);
  assert.equal(db.getMeta('universe_rows_cache:global:500000000:1'), 'fresh');
  assert.equal(db.getMeta(`email_sent:${today}`), '1');
  assert.ok(db.getMeta('last_screener_fetch'));
});

test('orphan market data outlives its listing only for the grace period', () => {
  db.saveSparkline('GHOST', 45, [{ date: '2026-01-01', price: 1 }]);
  assert.equal(db.pruneOrphanMarketData(Date.now() - 30 * DAY).sparklines, 0, 'recent orphan kept');
  assert.equal(db.pruneOrphanMarketData(Date.now() + 1000).sparklines >= 1, true);
  assert.equal(db.getSparkline('GHOST', 45), undefined);
});

test('chat sessions are capped per user, newest kept', () => {
  for (let i = 0; i < 25; i++) {
    db.saveChatSession({ id: `cs-${i}`, user_id: 'capper', created_at: i, updated_at: i, title: `t${i}`, messages: '[]' });
  }
  db.saveChatSession({ id: 'other-1', user_id: 'someone', created_at: 1, updated_at: 1, title: 'x', messages: '[]' });
  assert.equal(db.capChatSessionsPerUser(20), 5);
  const kept = db.listChatSessions('capper').map((s) => s.id);
  assert.equal(kept.length, 20);
  assert.ok(kept.includes('cs-24') && !kept.includes('cs-0'));
  assert.equal(db.listChatSessions('someone').length, 1);
});

test('alert state is dropped for symbols a user no longer watches', () => {
  db.patchUserSettings('alerter', { watchlists: [{ id: 'default', name: 'W', symbols: ['KEEP'], updatedAt: 1 }] });
  db.saveWatchlistAlertState('alerter', 'KEEP', { last_price: 1 });
  db.saveWatchlistAlertState('alerter', 'GONE', { last_price: 1 });
  const { watchedByUser, all } = referencedSymbols();
  assert.ok(all.has('KEEP'));
  db.pruneWatchlistAlertStates(watchedByUser);
  assert.ok(db.getWatchlistAlertState('alerter', 'KEEP'));
  assert.equal(db.getWatchlistAlertState('alerter', 'GONE'), null);
});

test('referenced symbols cover watchlists, portfolio holdings and strategies', () => {
  const { all } = referencedSymbols([{
    user_id: 'u',
    data: JSON.stringify({
      watchlists: [{ symbols: ['w1'] }],
      portfolios: [{ holdings: [{ ticker: 'h1' }] }],
      strategies: [{ universe: { symbols: ['s1'] }, paper: { holdings: [{ symbol: 'p1' }] } }],
    }),
  }, { user_id: 'bad', data: '{not json' }]);
  assert.deepEqual([...all].sort(), ['H1', 'P1', 'S1', 'W1']);
});

test('a full maintenance run completes every step and records a report', () => {
  const report = runMaintenance({ config: { ...retentionConfig(), vacuum: false } });
  for (const key of ['darkListings', 'orphanMarketData', 'kvCache', 'metaCaches', 'chatSessions', 'brokerageOrders', 'watchlistAlertState', 'sqlite']) {
    assert.ok(report[key], key);
    assert.equal(report[key].error, undefined, `${key}: ${report[key].error}`);
  }
  assert.ok(JSON.parse(db.getMeta('maintenance_last')).at);
});
