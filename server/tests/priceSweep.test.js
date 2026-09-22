import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Point the DB module at a throwaway file BEFORE it is imported, so these tests
// never touch a developer's local screener database.
const tmpDir = mkdtempSync(path.join(tmpdir(), 'orizin-sweep-'));
process.env.DB_PATH = path.join(tmpDir, 'screener.db');

let db;
let sweep;

before(async () => {
  db = await import('../db.js');
  sweep = await import('../priceSweep.js');
});

after(() => {
  try { db.default?.close?.(); } catch { /* ignore */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

function seed(symbol, fields = {}) {
  db.saveScreenerBatch([{
    symbol,
    name: symbol,
    sector: 'Tech',
    industry: 'Software',
    exchange: 'NASDAQ',
    country: 'US',
    price: 10,
    mcap: 1e9,
    volume: 100,
    beta: 1,
    div_yield: null,
    is_etf: 0,
    updated_at: 1_000,
    ...fields,
  }]);
}

test('applyQuoteBatch re-prices existing rows without touching the fundamentals clock', () => {
  seed('SWPA');
  const before = db.getStock('SWPA');
  const at = Date.now();
  const n = db.applyQuoteBatch([{ symbol: 'SWPA', price: 12.5, volume: 900, mcap: 2e9 }], { at });
  assert.equal(n, 1);
  const row = db.getStock('SWPA');
  assert.equal(row.price, 12.5);
  assert.equal(row.volume, 900);
  assert.equal(row.mcap, 2e9);
  assert.equal(row.price_updated_at, at);
  assert.equal(row.updated_at, before.updated_at, 'updated_at drives the fundamentals rotation and must not move');
});

test('applyQuoteBatch ignores unknown symbols and unusable prices', () => {
  const n = db.applyQuoteBatch([
    { symbol: 'NOPE_NOT_HERE', price: 5 },
    { symbol: 'SWPA', price: null },
    { symbol: 'SWPA', price: 'abc' },
    { price: 3 },
  ]);
  assert.equal(n, 0);
  assert.equal(db.getStock('NOPE_NOT_HERE'), undefined, 'the sweep must never insert rows');
});

test('applyQuoteBatch keeps a fresher live quote that landed during the sweep', () => {
  seed('SWPB');
  const liveAt = Date.now();
  db.saveQuote('SWPB', { price: 50 });
  // Sweep started before the live quote → it must not roll it back.
  const n = db.applyQuoteBatch([{ symbol: 'SWPB', price: 49 }], { at: liveAt + 5, skipNewerThan: liveAt - 1000 });
  assert.equal(n, 0);
  assert.equal(db.getStock('SWPB').price, 50);
});

test('getPricesUpdatedSince returns only rows re-priced after the cursor', () => {
  seed('SWPC');
  const t0 = Date.now() + 10_000;
  db.applyQuoteBatch([{ symbol: 'SWPC', price: 7 }], { at: t0 });
  const rows = db.getPricesUpdatedSince(t0 - 1);
  assert.deepEqual(rows.map((r) => r.symbol), ['SWPC']);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['mcap', 'price', 'price_updated_at', 'symbol', 'volume']);
  assert.equal(db.getPricesUpdatedSince(t0).length, 0);
});

test('priceSweepDue follows the session cadence and sweeps on every session change', () => {
  const now = 10_000_000;
  const min = 60 * 1000;
  assert.equal(sweep.priceSweepDue({ session: 'open', lastAt: null, now }), true);
  assert.equal(sweep.priceSweepDue({ session: 'open', lastSession: 'open', lastAt: now - 5 * min, now }), false);
  assert.equal(sweep.priceSweepDue({ session: 'open', lastSession: 'open', lastAt: now - 10 * min, now }), true);
  assert.equal(sweep.priceSweepDue({ session: 'after', lastSession: 'after', lastAt: now - 20 * min, now }), false);
  assert.equal(sweep.priceSweepDue({ session: 'closed', lastSession: 'closed', lastAt: now - 5 * 60 * min, now }), false);
  assert.equal(sweep.priceSweepDue({ session: 'closed', lastSession: 'closed', lastAt: now - 6 * 60 * min, now }), true);
  // open → after: capture the close straight away.
  assert.equal(sweep.priceSweepDue({ session: 'after', lastSession: 'open', lastAt: now - min, now }), true);
});

test('priceSweepEnabled needs an FMP key and respects the kill switches', () => {
  assert.equal(sweep.priceSweepEnabled({ FMP_API_KEY: '' }), false);
  assert.equal(sweep.priceSweepEnabled({ FMP_API_KEY: 'your_fmp_api_key_here' }), false);
  assert.equal(sweep.priceSweepEnabled({ FMP_API_KEY: 'k' }), true);
  assert.equal(sweep.priceSweepEnabled({ FMP_API_KEY: 'k', PRICE_SWEEP_ENABLED: 'false' }), false);
  assert.equal(sweep.priceSweepEnabled({ FMP_API_KEY: 'k', ENABLE_BACKGROUND_ENRICH: 'false' }), false);
  assert.equal(
    sweep.priceSweepEnabled({ FMP_API_KEY: 'k', ENABLE_BACKGROUND_ENRICH: 'false', PRICE_SWEEP_ENABLED: 'true' }),
    true,
  );
});

test('runPriceSweep applies fetched quotes and records status; a failure leaves prices alone', async () => {
  sweep._resetPriceSweepForTests();
  seed('SWPD', { price: 1 });
  const n = await sweep.runPriceSweep({ fetchQuotes: async () => [{ symbol: 'SWPD', price: 2, volume: 5, mcap: 3 }] });
  assert.equal(n, 1);
  assert.equal(db.getStock('SWPD').price, 2);
  const ok = sweep.getPriceSweepStatus();
  assert.equal(ok.lastCount, 1);
  assert.equal(ok.lastReturned, 1);
  assert.equal(ok.lastError, null);
  assert.ok(ok.lastAt > 0);

  const failed = await sweep.runPriceSweep({ fetchQuotes: async () => { throw new Error('FMP 500'); } });
  assert.equal(failed, 0);
  assert.equal(db.getStock('SWPD').price, 2);
  assert.match(sweep.getPriceSweepStatus().lastError, /FMP 500/);
  assert.equal(sweep.getPriceSweepStatus().lastAt, ok.lastAt, 'a failed sweep must not look like a fresh one');
});
