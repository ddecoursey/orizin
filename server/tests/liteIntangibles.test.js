import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasClientGamePlanContext,
  stockRowToLiteStats,
  buildLiteTricklePrompt,
  sanitizeLiteIntangibles,
} from "../liteIntangibles.js";

test("hasClientGamePlanContext is false for empty trickle args", () => {
  assert.equal(hasClientGamePlanContext({}, {}), false);
});

test("hasClientGamePlanContext is true when client sends stats", () => {
  assert.equal(hasClientGamePlanContext({ price: 10 }, {}), true);
});

test("stockRowToLiteStats maps SQLite row fields and enrichment target", () => {
  const stats = stockRowToLiteStats(
    {
      symbol: "AAPL",
      price: 190,
      mcap: 2900,
      pe: 28,
      roic: 0.55,
      score: 0.82,
      sector: "Technology",
    },
    { target_consensus: 210 },
  );
  assert.equal(stats.orizinScore, 82);
  assert.equal(stats.sector, "Technology");
  assert.equal(stats.target, 210);
  assert.ok(stats.targetUpsidePct > 0);
});

test("buildLiteTricklePrompt includes fundamentals, target, longer profile, five headlines", () => {
  const p = buildLiteTricklePrompt({
    symbol: "AAPL",
    profile: { companyName: "Apple", description: "x".repeat(900) },
    news: Array.from({ length: 6 }, (_, i) => ({ publishedDate: "2026-06-01", title: `Headline ${i}` })),
    stats: stockRowToLiteStats(
      { price: 190, pe: 28, roic: 0.5, score: 0.8 },
      { target_consensus: 220 },
    ),
  });
  assert.ok(p.includes("FUNDAMENTALS"));
  assert.ok(p.includes("P/E"));
  assert.ok(p.includes("Analyst consensus target"));
  assert.ok(p.includes("Headline 4"));
  assert.ok(!p.includes("Headline 5"));
  assert.ok(p.includes("x".repeat(750)));
  assert.ok(!p.includes("x".repeat(800)));
});

test("sanitizeLiteIntangibles returns screener-safe shape", () => {
  const out = sanitizeLiteIntangibles({
    bottomLine: "Moat intact",
    intangiblesScore: 72,
    intangiblesRationale: "Brand",
    convictionDelta: 3,
  });
  assert.equal(out.intangiblesScore, 72);
  assert.equal(out.bullCase, "");
  assert.ok(Array.isArray(out.xFactors));
});

test("xFactors are derived from categoryScores — sorted by score, 'none' dropped", () => {
  const out = sanitizeLiteIntangibles({
    bottomLine: "Mixed",
    intangiblesScore: 50,
    intangiblesRationale: "x",
    convictionDelta: 0,
    categoryScores: {
      future_growth_potential: { score: 80, rating: "strong", note: "TAM" },
      future_importance: { score: 30, rating: "weak", note: "replaceable" },
      moat_strength: { score: 0, rating: "none", note: "no moat" }, // dropped
      platform_infrastructure_potential: { score: 60, rating: "moderate", note: "some lock-in" },
      management_execution: { score: 45, rating: "moderate", note: "ok" },
      ecosystem_dependence: { score: 20, rating: "weak", note: "alternatives" },
      innovation_velocity: { score: 55, rating: "moderate", note: "steady" },
    },
  });
  // "none"-rated category is filtered out; the rest are ordered strongest-first.
  assert.deepEqual(out.xFactors.map((x) => x.factor), [
    "future_growth_potential",      // 80
    "platform_infrastructure_potential", // 60
    "innovation_velocity",          // 55
    "management_execution",         // 45
    "future_importance",            // 30
    "ecosystem_dependence",         // 20
  ]);
  assert.equal(out.xFactors.find((x) => x.factor === "moat_strength"), undefined);
  // Derived rows carry the category's rating + note, and no internal _score field.
  assert.equal(out.xFactors[0].strength, "strong");
  assert.equal(out.xFactors[0].note, "TAM");
  assert.equal("_score" in out.xFactors[0], false);
});

test("intangiblesScore is derived from categoryScores when the model omits it", () => {
  const out = sanitizeLiteIntangibles({
    bottomLine: "Weak",
    intangiblesRationale: "commodity",
    convictionDelta: -5,
    categoryScores: {
      future_growth_potential: { score: 30, rating: "weak" },
      future_importance: { score: 25, rating: "weak" },
      moat_strength: { score: 20, rating: "none" },
      platform_infrastructure_potential: { score: 15, rating: "none" },
      management_execution: { score: 40, rating: "moderate" },
      ecosystem_dependence: { score: 20, rating: "weak" },
      innovation_velocity: { score: 25, rating: "weak" },
    },
  });
  // 30*.2 + 25*.2 + 20*.15 + 15*.15 + 40*.1 + 20*.1 + 25*.1 = 24.75 → 25
  assert.equal(out.intangiblesScore, 25);
});