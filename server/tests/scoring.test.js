// Unit tests for the screener scoring layer (src/lib/scoring.js) after the
// Orizin Score → single absolute Conviction migration. The percentile-rank
// engine is gone; the Fundamentals pillar is now an absolute profit+growth+
// safety blend (src/lib/verdict.js fundamentalsScore).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreRows, ruleOf40, computeDurabilityProxy } from '../../src/lib/scoring.js';
import { fundamentalsScore, quickConviction, computeVerdict } from '../../src/lib/verdict.js';

// A complete, high-quality, growing, reasonably-priced large cap.
const STRONG = {
  symbol: 'STRONG', price: 100, mcap: 5e10, beta: 1.0,
  roic: 0.25, roa: 0.15, roe: 0.30, net_margin: 0.25, op_margin: 0.30, fcf_margin: 0.22,
  debt_equity: 0.3, net_debt_ebitda: 0.5, current_ratio: 2.5,
  revenue_growth: 0.20, eps_growth: 0.25, fcf_growth: 0.22,
  pe: 18, fcf_yield: 0.05, ev_ebitda: 12, dcf: 130, target_consensus: 125,
};
// A loss-making, shrinking, leveraged microcap.
const WEAK = {
  symbol: 'WEAK', price: 5, mcap: 2e8, beta: 2.4,
  roic: -0.10, roa: -0.08, roe: -0.20, net_margin: -0.15, op_margin: -0.10, fcf_margin: -0.12,
  debt_equity: 3.5, net_debt_ebitda: 8, current_ratio: 0.8,
  revenue_growth: -0.10, eps_growth: -0.30, fcf_growth: -0.20,
  pe: -5, fcf_yield: -0.03, ev_ebitda: -2,
};

test('fundamentalsScore is absolute: strong company high, loss-maker low', () => {
  assert.ok(fundamentalsScore(STRONG) > 0.7, `strong should score high, got ${fundamentalsScore(STRONG)}`);
  assert.ok(fundamentalsScore(WEAK) < 0.3, `weak should score low, got ${fundamentalsScore(WEAK)}`);
});

test('fundamentalsScore: missing inputs drop out (not imputed); null when none', () => {
  assert.equal(fundamentalsScore({ symbol: 'BARE' }), null);
  // Only profitability present → still scores high on profit alone (no penalty
  // for the absent growth/safety pillars — they simply fall out).
  assert.ok(fundamentalsScore({ roic: 0.25, op_margin: 0.30, net_margin: 0.25 }) > 0.6);
});

test('scoreRows attaches Conviction; strong clearly outranks weak', () => {
  const [s, w] = scoreRows([STRONG, WEAK]);
  assert.ok(Number.isFinite(s.conviction), 'strong gets a numeric conviction');
  assert.ok(Number.isFinite(w.conviction), 'weak gets a numeric conviction');
  assert.ok(s.conviction > w.conviction + 20, `strong must beat weak (${s.conviction} vs ${w.conviction})`);
});

test('scoreRows leaves sparse rows unscored (conviction null)', () => {
  const [row] = scoreRows([{ symbol: 'THIN', price: 10, pe: 12 }]); // <3 fundamentals inputs
  assert.equal(row.conviction, null);
  assert.equal(row.durabilityProxy, null);
});

test('scoreRows dataCoverage reflects how many key fundamentals are present', () => {
  const [s] = scoreRows([STRONG]);
  assert.ok(s.dataCoverage > 0.8, `near-complete row should be high coverage, got ${s.dataCoverage}`);
  const [thin] = scoreRows([{ symbol: 'T', roic: 0.2, op_margin: 0.2, pe: 15 }]);
  assert.ok(thin.dataCoverage < 0.4);
});

test('screener quickConviction equals Deep Research computeVerdict for a no-detail row', () => {
  // The consistency guarantee: the lean screener number must not jump when the
  // user opens Deep Research on a symbol with no extra detail loaded yet.
  const qc = quickConviction(STRONG);
  const dr = computeVerdict(STRONG, {}, null, {}).conviction;
  assert.equal(qc, dr);
});

test('ruleOf40 passes high growth+margin, fails low', () => {
  assert.equal(ruleOf40({ revenue_growth: 0.25, ebitda_margin: 0.25 }).passes, true);
  assert.equal(ruleOf40({ revenue_growth: 0.05, ebitda_margin: 0.10 }).passes, false);
  assert.deepEqual(ruleOf40({}), { score: null, passes: false });
});

test('computeDurabilityProxy is 0..100 and rewards quality', () => {
  const s = computeDurabilityProxy(STRONG);
  const w = computeDurabilityProxy(WEAK);
  assert.ok(s >= 0 && s <= 100);
  assert.ok(s > w, `durable business should beat the junky one (${s} vs ${w})`);
});
