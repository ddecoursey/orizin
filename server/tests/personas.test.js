import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePillarWeights, resolvePillarPercents, PERSONAS, PERSONA_KEYS, CATEGORIES,
  explainPersonaFit, topStrengthsRisks,
} from "../../src/lib/personas.js";
import { quickConviction } from "../../src/lib/verdict.js";

const sum = (w) => CATEGORIES.reduce((s, k) => s + w[k], 0);
const topCategory = (sel) => {
  const w = resolvePillarWeights(sel);
  return CATEGORIES.slice().sort((a, b) => w[b] - w[a])[0];
};

test("resolvePillarWeights returns non-negative fractions summing to ~1 for every persona", () => {
  for (const p of PERSONA_KEYS) {
    const w = resolvePillarWeights({ persona: p });
    assert.ok(Math.abs(sum(w) - 1) < 1e-9, `${p} sums to ${sum(w)}`);
    for (const k of CATEGORIES) assert.ok(w[k] >= 0, `${p}.${k} is negative`);
  }
});

test("the default selection equals the Balanced Growth base (grow goal is neutral)", () => {
  const w = resolvePillarWeights({ persona: "balanced_growth", risk: "balanced", horizon: "medium", goal: "grow" });
  const base = PERSONAS.balanced_growth.weights; // percent points, sum 100
  for (const k of CATEGORIES) {
    assert.ok(Math.abs(w[k] - base[k] / 100) < 1e-9, `${k}: ${w[k]} vs ${base[k] / 100}`);
  }
  assert.ok(w.intangibles > 0.3 && w.intangibles >= w.fundamentals, "Intangibles is the dominant default pillar");
});

test("persona shapes: deep_value→valuation, momentum→technicals, disruptor→intangibles lead", () => {
  assert.equal(topCategory({ persona: "deep_value" }), "valuation");
  assert.equal(topCategory({ persona: "momentum" }), "technicals");
  assert.equal(topCategory({ persona: "disruptor" }), "intangibles");
});

test("modifiers apply in order, clamp at zero, and renormalize", () => {
  // Stacked anti-intangibles modifiers never push a weight below 0; result still sums to 1.
  const w = resolvePillarWeights({ persona: "momentum", risk: "conservative", horizon: "short", goal: "preserve" });
  assert.ok(Math.abs(sum(w) - 1) < 1e-9);
  for (const k of CATEGORIES) assert.ok(w[k] >= 0);
  // Aggressive risk lifts Intangibles vs conservative for the same persona.
  const agg = resolvePillarWeights({ persona: "garp", risk: "aggressive" }).intangibles;
  const con = resolvePillarWeights({ persona: "garp", risk: "conservative" }).intangibles;
  assert.ok(agg > con, `aggressive intangibles ${agg} should exceed conservative ${con}`);
});

test("resolvePillarPercents sums to exactly 100", () => {
  for (const p of PERSONA_KEYS) {
    const pct = resolvePillarPercents({ persona: p, goal: "maximize", risk: "aggressive", horizon: "long" });
    assert.equal(CATEGORIES.reduce((s, k) => s + pct[k], 0), 100, `${p} percents must total 100`);
  }
});

test("Intangibles down-weights while it's only the durability proxy", () => {
  // Strong hard-data row but a WEAK intangibles signal (score 20). With only the
  // proxy, Intangibles is down-weighted; a cached Ori review with the SAME low
  // score carries full weight → drags conviction further down.
  const base = {
    score: 0.9, pe: 18, fcf_yield: 0.05, eps_growth: 0.15,
    price: 100, target_consensus: 130, sma50: 110, sma200: 90,
    mcap: 5e10, beta: 1, net_margin: 0.2, op_margin: 0.25, debt_equity: 0.3, net_debt_ebitda: 1,
  };
  const proxyRow = { ...base, durabilityProxy: 20 };
  const reviewedRow = { ...base, ori: { intangiblesScore: 20, convictionDelta: 0 } };
  const cProxy = quickConviction(proxyRow);
  const cReviewed = quickConviction(reviewedRow);
  assert.ok(cProxy != null && cReviewed != null);
  assert.ok(cReviewed < cProxy, `full-weight low intangibles (${cReviewed}) should be < down-weighted proxy (${cProxy})`);
});

test("explainPersonaFit + topStrengthsRisks read off the verdict pillars", () => {
  const verdict = {
    pillars: [
      { id: "fundamentals", score: 0.9 },
      { id: "valuation", score: 0.3 },
      { id: "technicals", score: 0.6 },
      { id: "smartMoney", score: 0.5 },
      { id: "analyst", score: 0.55 },
      { id: "fit", score: null },
      { id: "intangibles", score: 0.8 },
    ],
  };
  const fit = explainPersonaFit(verdict, { persona: "disruptor" });
  assert.ok(fit && typeof fit.text === "string" && fit.fitScore >= 0 && fit.fitScore <= 100);
  const { strengths, risks } = topStrengthsRisks(verdict);
  assert.equal(strengths[0].id, "fundamentals", "highest score is the top strength");
  assert.ok(risks.some((r) => r.id === "valuation"), "lowest score is a top risk");
});
