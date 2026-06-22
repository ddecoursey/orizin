import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  buildDeepResearchPrompt,
  buildPortfolioContextForSymbol,
} from "../routes/chat.js";

const sampleStock = {
  symbol: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  industry: "Consumer Electronics",
  price: 190,
  mcap: 2900,
  pe: 28,
  pb: 45,
  ev_ebitda: 22,
  fcf_yield: 0.04,
  roic: 0.55,
  roe: 1.5,
  op_margin: 0.3,
  revenue_growth: 0.08,
  eps_growth: 0.1,
  div_yield: 0.005,
  net_debt_ebitda: -0.5,
  beta: 1.2,
  score: 0.82,
  conviction: 78,
  qScore: 0.85,
  vScore: 0.7,
  gScore: 0.75,
  dataCoverage: 0.95,
  latestRsi: 55,
  verdict: {
    conviction: 78,
    horizon: "3yr",
    action: "Hold",
    headline: "Quality compounder at fair price.",
    reasons: ["Strong ROIC", "Services growth"],
    pillars: [{ id: "fundamentals", score: 82 }],
  },
  profile: { description: "Makes iPhones and services. ".repeat(50) },
  news: [{ title: "Apple launches new chip", date: "2026-06-01" }],
};

test("buildDeepResearchPrompt omits screener table and sectors", () => {
  const prompt = buildDeepResearchPrompt({
    view: "deep-research",
    today: "2026-06-21",
    weights: { q: 40, v: 30, g: 30 },
    activeStock: sampleStock,
    portfolioGoals: { holdsSymbol: false, position: null, goals: ["Retire by 55"], theses: [] },
  });

  assert.ok(prompt.includes("CURRENT_VIEW: deep-research"));
  assert.ok(prompt.includes("ACTIVE_SYMBOL: AAPL"));
  assert.ok(prompt.includes("=== AAPL"));
  assert.ok(!prompt.includes("STOCK DATA"));
  assert.ok(!prompt.includes("Available Sectors"));
  assert.ok(!prompt.includes("LATEST MARKET NEWS"));
  assert.ok(prompt.includes("Retire by 55"));
});

test("buildDeepResearchPrompt is shorter than screener prompt for same stock", () => {
  const dr = buildDeepResearchPrompt({
    view: "deep-research",
    today: "2026-06-21",
    activeStock: sampleStock,
  });
  const screener = buildSystemPrompt({
    view: "screener",
    today: "2026-06-21",
    stocks: [sampleStock],
    activeStock: sampleStock,
    availableSectors: ["Technology"],
    availableIndustries: ["Consumer Electronics"],
    totalFiltered: 500,
    filters: {},
    weights: { q: 35, v: 35, g: 30 },
    pinnedStocks: [sampleStock],
    news: [{ title: "Market rally", source: "CNBC" }],
    portfolioGoals: {
      grandTotal: 100000,
      portfolios: [{ name: "Main", totalInvested: 100000, holdings: [{ ticker: "MSFT", percent: 50, dollars: 50000 }] }],
      goals: ["Retire by 55"],
      theses: ["AI winners"],
    },
  });

  assert.ok(dr.length < screener.length * 0.6, `DR ${dr.length} should be much shorter than screener ${screener.length}`);
});

test("buildSystemPrompt routes deep-research to compact prompt", () => {
  const prompt = buildSystemPrompt({ view: "deep-research", today: "2026-06-21", activeStock: sampleStock });
  assert.ok(!prompt.includes("CURRENTLY OPEN STOCK"));
  assert.ok(prompt.includes("=== AAPL"));
});

test("buildPortfolioContextForSymbol handles slim client payload", () => {
  const block = buildPortfolioContextForSymbol(
    {
      holdsSymbol: true,
      position: { percent: 12.5, dollars: 25000 },
      goals: ["Income"],
      theses: ["AAPL ecosystem"],
    },
    "AAPL"
  );
  assert.ok(block.includes("Holds AAPL"));
  assert.ok(block.includes("12.5%"));
  assert.ok(block.includes("Income"));
});

test("buildDeepResearchStockSection truncates long profile text", () => {
  const prompt = buildDeepResearchPrompt({
    view: "deep-research",
    today: "2026-06-21",
    activeStock: sampleStock,
  });
  assert.ok(!prompt.includes("Makes iPhones".repeat(20)));
  assert.ok(prompt.includes("Biz:"));
});