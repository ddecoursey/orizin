// Unit tests for the Orizin scoring engine (src/lib/scoring.js).
// These encode the anti-inflation guarantees: junk values (negative P/E,
// negative equity, negative EBITDA) can't rank as "best", and missing data
// can't lift a stock above better-evidenced peers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeScores, scoringInputs, DEFAULT_WEIGHTS } from '../../src/lib/scoring.js';

// Complete, middle-of-the-road baseline row. Margins/growth are fractional.
const BASE = {
  roic: 0.10, roe: 0.12, gross_margin: 0.40, op_margin: 0.15, fcf_margin: 0.10,
  current_ratio: 1.5, net_debt_ebitda: 1.0, debt_equity: 0.5,
  ev_gp: 8, ev_ebitda: 12, pe: 20, fcf_yield: 0.04,
  revenue_growth: 0.08, eps_growth: 0.08, fcf_growth: 0.08,
  ebitda_margin: 0.20, dcf: null, price: 100,
};

function mk(symbol, overrides = {}) {
  return { symbol, ...BASE, ...overrides };
}

// Spread of complete-data filler stocks so percentile ranks are meaningful.
function fillers(n = 4) {
  return Array.from({ length: n }, (_, i) => {
    const f = 0.6 + i * 0.2; // 0.6, 0.8, 1.0, 1.2 multipliers
    return mk(`F${i}`, {
      roic: 0.06 * f, roe: 0.08 * f, gross_margin: 0.30 * f, op_margin: 0.10 * f,
      fcf_margin: 0.06 * f, current_ratio: 1.2 * f, net_debt_ebitda: 2.5 / f,
      debt_equity: 1.2 / f, ev_gp: 12 / f, ev_ebitda: 16 / f, pe: 28 / f,
      fcf_yield: 0.02 * f, revenue_growth: 0.04 * f, eps_growth: 0.04 * f,
      fcf_growth: 0.04 * f,
    });
  });
}

const bySym = (rows) => Object.fromEntries(rows.map((r) => [r.symbol, r]));

test('a complete solid stock outscores a sparse stock with a few stellar metrics', () => {
  const rows = [
    ...fillers(),
    mk('SOLID', {
      roic: 0.22, roe: 0.25, gross_margin: 0.60, op_margin: 0.28, fcf_margin: 0.20,
      current_ratio: 2.2, net_debt_ebitda: 0.2, debt_equity: 0.2,
      ev_gp: 5, ev_ebitda: 9, pe: 14, fcf_yield: 0.07,
      revenue_growth: 0.18, eps_growth: 0.2, fcf_growth: 0.19,
    }),
    // Only 3 real inputs, all best-in-class. Under the old scoring this stock
    // hit ~100 (perfect pillar averages + missing-pillar weight redistribution).
    {
      symbol: 'SPARSE', roe: 0.50, gross_margin: 0.90, pe: 6,
      price: 100, dcf: null,
    },
  ];
  const scored = bySym(computeScores(rows));
  assert.ok(scored.SPARSE.score != null, 'sparse stock clears the 3-input gate');
  assert.ok(
    scored.SOLID.score > scored.SPARSE.score + 0.2,
    `complete stock must clearly win (SOLID=${scored.SOLID.score?.toFixed(3)} vs SPARSE=${scored.SPARSE.score?.toFixed(3)})`,
  );
});

test('stocks below the 3-input coverage gate are not scored', () => {
  const rows = [...fillers(), { symbol: 'TWO', roe: 0.5, pe: 5, price: 100 }];
  const scored = bySym(computeScores(rows));
  assert.equal(scored.TWO.score, null);
  assert.equal(scored.TWO.qScore, null);
  assert.deepEqual(scored.TWO.effectiveWeights, { q: 0, v: 0, g: 0 });
});

test('negative P/E (loss-maker) ranks worst on value, not best', () => {
  const rows = [
    mk('NEGPE', { pe: -5 }),
    mk('CHEAP', { pe: 8 }),
    mk('DEAR', { pe: 40 }),
  ];
  const scored = bySym(computeScores(rows));
  assert.ok(scored.CHEAP.vScore > scored.DEAR.vScore, 'positive low P/E beats high P/E');
  assert.ok(scored.DEAR.vScore > scored.NEGPE.vScore, 'even an expensive P/E beats a negative one');
});

test('negative equity is treated as distress: D/E ranks worst and ROE is voided', () => {
  const s = scoringInputs({ debt_equity: -0.4, roe: 4.2 });
  assert.equal(s.roe, null, 'ROE on negative equity is meaningless');
  assert.ok(s.debt_equity > 1e9, 'negative D/E ranks as the worst leverage');

  const rows = [
    mk('NEGEQ', { debt_equity: -0.4, roe: 4.2 }), // junk "400% ROE"
    mk('CLEAN', { debt_equity: 0.2, roe: 0.20 }),
    mk('LEVERED', { debt_equity: 2.5, roe: 0.10 }),
  ];
  const scored = bySym(computeScores(rows));
  assert.ok(
    scored.CLEAN.qScore > scored.NEGEQ.qScore,
    'a clean balance sheet must beat negative equity on quality',
  );
});

test('missing growth data can no longer beat real mediocre growth', () => {
  const noGrowth = mk('NOG', { revenue_growth: null, eps_growth: null, fcf_growth: null });
  const midGrowth = mk('MIDG', {}); // BASE growth = median of the filler spread
  const rows = [...fillers(), noGrowth, midGrowth];
  const scored = bySym(computeScores(rows));
  assert.ok(
    scored.MIDG.score > scored.NOG.score,
    `real median growth must beat unknown growth (MIDG=${scored.MIDG.score?.toFixed(3)} vs NOG=${scored.NOG.score?.toFixed(3)})`,
  );
});

test('negative EV/EBITDA: cheap only when EBITDA is positive', () => {
  const netCash = scoringInputs({ ev_ebitda: -2, ebitda_margin: 0.2 });
  assert.equal(netCash.ev_ebitda, -2, 'negative EV with positive EBITDA stays (genuinely cheap)');

  const junk = scoringInputs({ ev_ebitda: -3, ebitda_margin: -0.1 });
  assert.ok(junk.ev_ebitda > 1e9, 'negative EBITDA makes the multiple junk → worst');
});

test('ND/EBITDA is ignored when EBITDA is negative; current ratio capped at 3', () => {
  assert.equal(scoringInputs({ net_debt_ebitda: -4, ebitda_margin: -0.2 }).net_debt_ebitda, null);
  assert.equal(scoringInputs({ net_debt_ebitda: 1.5, ebitda_margin: 0.2 }).net_debt_ebitda, 1.5);
  assert.equal(scoringInputs({ current_ratio: 25 }).current_ratio, 3);
});

test('identical rows tie exactly (tie-aware ranks)', () => {
  const rows = [mk('T1'), mk('T2'), mk('OTHER', { roic: 0.2, pe: 10 })];
  const scored = bySym(computeScores(rows));
  assert.equal(scored.T1.score, scored.T2.score);
  assert.equal(scored.T1.qScore, scored.T2.qScore);
});

test('dataCoverage reflects real inputs and effective weights match the sliders', () => {
  const rows = [...fillers(), mk('FULL'), mk('NOG', { revenue_growth: null, eps_growth: null, fcf_growth: null })];
  const scored = bySym(computeScores(rows, { q: 50, v: 30, g: 20 }));
  assert.equal(scored.FULL.dataCoverage, 15 / 16); // dcf is null in BASE
  assert.equal(scored.NOG.dataCoverage, 12 / 16);
  assert.deepEqual(scored.FULL.effectiveWeights, { q: 0.5, v: 0.3, g: 0.2 });
  // No redistribution for the growth-less stock either:
  assert.deepEqual(scored.NOG.effectiveWeights, { q: 0.5, v: 0.3, g: 0.2 });
});

test('zero weights produce no score; defaults are 35/35/30', () => {
  const rows = [...fillers(), mk('X')];
  const scored = bySym(computeScores(rows, { q: 0, v: 0, g: 0 }));
  assert.equal(scored.X.score, null);
  assert.deepEqual(DEFAULT_WEIGHTS, { q: 35, v: 35, g: 30 });
});

test('rule of 40 is preserved on scored rows', () => {
  const rows = [...fillers(), mk('R40', { revenue_growth: 0.30, ebitda_margin: 0.20 })];
  const scored = bySym(computeScores(rows));
  assert.equal(Math.round(scored.R40.rule_of_40), 50);
  assert.equal(scored.R40.passes_rule_of_40, true);
});
