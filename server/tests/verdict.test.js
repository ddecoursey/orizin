// Unit tests for the beginner Verdict / Game Plan engine (src/lib/verdict.js).
// These pin the two axes (hold HORIZON from durability, ACTION from valuation +
// timing) and the per-metric Good/OK/Bad rubric, so the plain-English guidance a
// beginner relies on can't silently drift.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeVerdict, mergeOriIntoVerdict, metricTone } from "../../src/lib/verdict.js";

const HORIZONS = ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"];

const beats = (n) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-0${i + 1}-01`, epsActual: 1.2, epsEstimated: 1.0 }));

// A wide-moat, profitable, growing, low-debt compounder at a fair price.
const COMPOUNDER = {
  symbol: "MOAT",
  price: 100,
  mcap: 2e12,
  roic: 0.25, roe: 0.3, net_margin: 0.25, op_margin: 0.3, fcf_margin: 0.22, gross_margin: 0.65,
  debt_equity: 0.3, net_debt_ebitda: 0.5, current_ratio: 2.0,
  revenue_growth: 0.18, eps_growth: 0.2, fcf_growth: 0.15,
  pe: 28, ev_ebitda: 18, fcf_yield: 0.035, vScore: 0.5,
  beta: 1.0, dataCoverage: 0.9,
};
const COMPOUNDER_DETAIL = {
  technicals: { sma50: 110, sma200: 100, rsi: 58, adx: 28 },
  aiData: { dcf: 120, target_consensus: 115 },
  earnings: beats(4),
};

test("high-quality compounder at a fair price → long horizon, buy-side action", () => {
  const v = computeVerdict(COMPOUNDER, COMPOUNDER_DETAIL);
  assert.equal(v.insufficient, undefined);
  assert.equal(v.horizon.key, "tenYr");
  assert.equal(v.action.tone, "good");
  assert.equal(v.grades.quality.tone, "good");
  assert.equal(v.grades.safety.tone, "good");
  assert.equal(v.flags.unprofitable, false);
  assert.equal(v.flags.distress, false);
});

test("same great business but very overvalued & overbought → still long, but wait", () => {
  const v = computeVerdict(
    { ...COMPOUNDER, price: 200, pe: 60, eps_growth: 0.1, ev_ebitda: 40, fcf_yield: 0.01, vScore: 0.2 },
    { technicals: { sma50: 210, sma200: 180, rsi: 78, adx: 30 }, aiData: { dcf: 100, target_consensus: 180 }, earnings: beats(4) },
  );
  // The business still deserves a long hold...
  assert.ok(["tenYr", "fiveYr"].includes(v.horizon.key));
  // ...but the action should be cautious about the entry price, not a green buy.
  assert.equal(v.action.tone, "ok");
  assert.match(v.action.label, /pullback|dips/i);
  assert.equal(v.grades.value.tone, "bad");
});

test("unprofitable, cash-burning, speculative micro-cap → trade only", () => {
  const v = computeVerdict(
    {
      symbol: "RISK", price: 5, mcap: 1.5e8,
      roic: -0.2, net_margin: -0.4, op_margin: -0.3, fcf_margin: -0.5, gross_margin: 0.3,
      debt_equity: 0.2, revenue_growth: 0.8, eps_growth: -0.1, pe: -10,
      beta: 2.6, dataCoverage: 0.6,
    },
    { technicals: { sma50: 6, sma200: 5, rsi: 75 } },
  );
  assert.equal(v.horizon.key, "trade");
  assert.equal(v.flags.unprofitable, true);
  assert.equal(v.flags.speculative, true);
  assert.equal(v.action.tone, "bad");
});

test("steady, low-growth, cheap dividend payer → long-term holding, accumulate", () => {
  const v = computeVerdict(
    {
      symbol: "ARIS", price: 50, mcap: 1e11,
      roic: 0.16, roe: 0.18, net_margin: 0.14, op_margin: 0.18, fcf_margin: 0.12, gross_margin: 0.45,
      debt_equity: 0.8, net_debt_ebitda: 2.0, current_ratio: 1.4,
      revenue_growth: 0.03, eps_growth: 0.04, fcf_growth: 0.02, div_yield: 0.03,
      pe: 16, ev_ebitda: 10, fcf_yield: 0.06, beta: 0.7, dataCoverage: 0.85,
    },
    { aiData: { dcf: 60, target_consensus: 58 } },
  );
  assert.ok(["fiveYr", "tenYr"].includes(v.horizon.key));
  assert.equal(v.action.tone, "good");
});

test("symbol-only row with no fundamentals → insufficient", () => {
  const v = computeVerdict({ symbol: "NEW" }, {});
  assert.equal(v.insufficient, true);
  assert.ok(v.headline);
});

test("verdict always carries an educational disclaimer", () => {
  const v = computeVerdict(COMPOUNDER, COMPOUNDER_DETAIL);
  assert.match(v.disclaimer, /not financial advice/i);
});

test("verdict produces a unified conviction 0-100 and all seven pillars", () => {
  const v = computeVerdict(COMPOUNDER, COMPOUNDER_DETAIL, { score: 82, reasons: ["fits your portfolio"] });
  assert.ok(Number.isInteger(v.conviction));
  assert.ok(v.conviction >= 0 && v.conviction <= 100);
  const ids = v.pillars.map((p) => p.id);
  for (const id of ["fundamentals", "valuation", "technicals", "smartMoney", "analyst", "fit", "intangibles"]) {
    assert.ok(ids.includes(id), `missing pillar ${id}`);
  }
  // Fit folds in from the passed-in fit; Intangibles stays empty until Ori.
  assert.ok(v.pillars.find((p) => p.id === "fit").score > 0.7);
  assert.equal(v.pillars.find((p) => p.id === "intangibles").score, null);
});

test("mergeOriIntoVerdict: fills intangibles, clamps delta, moves horizon ≤1 notch, flags narrative", () => {
  const det = computeVerdict(
    { symbol: "SPEC", price: 5, mcap: 5e9, roic: -0.1, net_margin: -0.2, op_margin: -0.1, revenue_growth: 0.6, eps_growth: -0.1, debt_equity: 0.3, pe: -10, beta: 1.8, dataCoverage: 0.6 },
    { technicals: { sma50: 6, sma200: 5, rsi: 60 } },
  );
  const detIdx = HORIZONS.indexOf(det.horizon.key);
  const merged = mergeOriIntoVerdict(det, {
    intangiblesScore: 90,
    convictionDelta: 50, // should clamp to +20
    horizonView: "tenYr", // should move at most one notch
    actionView: "Accumulate a small position",
    riskLevel: "speculative",
    bottomLine: "Pure story stock.",
  });
  assert.equal(merged.pillars.find((p) => p.id === "intangibles").score, 0.9);
  assert.ok(merged.conviction <= 100 && merged.conviction >= 0);
  const mergedIdx = HORIZONS.indexOf(merged.horizon.key);
  assert.ok(mergedIdx - detIdx <= 1 && mergedIdx >= detIdx, `horizon moved >1 notch (${det.horizon.key}→${merged.horizon.key})`);
  assert.equal(merged.narrativeDriven, true);
  assert.equal(merged.action.label, "Accumulate a small position");
  assert.equal(merged.action.oriAdjusted, true);
});

test("mergeOriIntoVerdict: missing Ori result is a safe passthrough", () => {
  const det = computeVerdict(COMPOUNDER, COMPOUNDER_DETAIL);
  assert.equal(mergeOriIntoVerdict(det, null), det);
});

test("metricTone rubric: higher-is-better metrics", () => {
  assert.equal(metricTone("roic", 0.2), "good");
  assert.equal(metricTone("roic", 0.1), "ok");
  assert.equal(metricTone("roic", -0.1), "bad");
  assert.equal(metricTone("net_margin", 0.2), "good");
  assert.equal(metricTone("revenue_growth", -0.05), "bad");
});

test("metricTone rubric: lower-is-better & leverage metrics", () => {
  assert.equal(metricTone("pe", 15), "good");
  assert.equal(metricTone("pe", 30), "ok");
  assert.equal(metricTone("pe", 50), "bad");
  assert.equal(metricTone("pe", -5), "bad");
  assert.equal(metricTone("debt_equity", 0.4), "good");
  assert.equal(metricTone("debt_equity", 1.0), "ok");
  assert.equal(metricTone("debt_equity", 3), "bad");
  assert.equal(metricTone("debt_equity", -1), "bad");
  assert.equal(metricTone("net_debt_ebitda", -1), "good"); // net cash
  assert.equal(metricTone("current_ratio", 0.8), "bad");
  assert.equal(metricTone("current_ratio", 1.6), "good");
});

test("metricTone rubric: dividend yield and ungraded keys", () => {
  assert.equal(metricTone("div_yield", 0.03), "good");
  assert.equal(metricTone("div_yield", 0.15), "ok"); // unusually high = possible trap
  assert.equal(metricTone("div_yield", 0), "neutral");
  assert.equal(metricTone("mcap", 1.23e9), "neutral"); // not graded
  assert.equal(metricTone("roic", null), "neutral");
});
