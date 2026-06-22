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
    xFactors: [{ factor: "Brand", strength: "strong", note: "Pricing power" }],
    convictionDelta: 3,
  });
  assert.equal(out.intangiblesScore, 72);
  assert.equal(out.bullCase, "");
  assert.ok(Array.isArray(out.xFactors));
});