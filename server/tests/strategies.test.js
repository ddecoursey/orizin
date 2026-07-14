import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAllocationBranches,
  buildHistoricalSimulation,
  buildTargetAllocations,
  calculateIndicators,
  createBlankStrategy,
  evaluateAllocationBranches,
  evaluateStock,
  nextRunDate,
  normalizeStrategy,
  rebalancePaperAccount,
  selectCandidates,
  strategyDataRequirements,
  strategyFromPreset,
} from "../../src/lib/strategies.js";

test("strategy schedules map plain-language frequencies to the correct next check", () => {
  const start = new Date("2026-07-14T12:00:00.000Z");
  assert.equal(nextRunDate("Daily", start), "2026-07-15T12:00:00.000Z");
  assert.equal(nextRunDate("Weekly", start), "2026-07-21T12:00:00.000Z");
  assert.equal(nextRunDate("Every 2 weeks", start), "2026-07-28T12:00:00.000Z");
  assert.equal(nextRunDate("Monthly", start), "2026-08-14T12:00:00.000Z");
  assert.equal(nextRunDate("Quarterly", start), "2026-10-14T12:00:00.000Z");
  assert.equal(nextRunDate("Monthly", new Date("2026-01-31T12:00:00.000Z")), "2026-03-02T12:00:00.000Z");
  assert.equal(nextRunDate("Daily", new Date("2026-07-17T12:00:00.000Z")), "2026-07-20T12:00:00.000Z");
});

test("persisted strategies discard unknown fields and sanitize nested execution data", () => {
  const normalized = normalizeStrategy({
    id: "safe",
    name: "Stored strategy",
    unexpected: { retained: true },
    universe: { type: "symbols", symbols: [" spy ", "bad symbol", "SPY"], includeEtfs: "false" },
    ranking: { primary: "conviction", injected: { retained: true } },
    limits: { rebalance: "Every second", allowOri: "false", injected: { retained: true } },
    rules: [{ metric: "is_biggest_loser", operator: "=", value: "false" }],
    paper: {
      startingCash: 100000,
      cash: 100000,
      holdings: [{ symbol: " spy ", shares: -10, avgPrice: 500, lastPrice: 510, source: "unknown" }],
      equityHistory: [],
    },
    activity: [{ source: "other", action: "x".repeat(500), explanation: "y".repeat(2000) }],
  });

  assert.equal(normalized.unexpected, undefined);
  assert.deepEqual(normalized.universe.symbols, ["SPY"]);
  assert.equal(normalized.universe.includeEtfs, false);
  assert.equal(normalized.limits.rebalance, "Monthly");
  assert.equal(normalized.limits.allowOri, false);
  assert.equal(normalized.limits.injected, undefined);
  assert.equal(normalized.ranking.injected, undefined);
  assert.equal(normalized.rules[0].value, false);
  assert.equal(normalized.paper.holdings[0].shares, 0);
  assert.equal(normalized.paper.holdings[0].source, "rule");
  assert.equal(normalized.activity[0].source, "system");
  assert.equal(normalized.activity[0].action.length, 180);
  assert.equal(normalized.activity[0].explanation.length, 1200);
});

test("fixed rules exclude a stock even when it has a high ranking score", () => {
  const strategy = strategyFromPreset("quality-compounder");
  const strong = {
    symbol: "GOOD",
    conviction: 80,
    roic: 0.22,
    revenue_growth: 0.12,
    net_debt_ebitda: 1,
    is_etf: 0,
  };
  const indebted = { ...strong, symbol: "DEBT", conviction: 99, net_debt_ebitda: 5 };

  assert.equal(evaluateStock(strong, strategy).eligible, true);
  assert.equal(evaluateStock(indebted, strategy).eligible, false);
  assert.deepEqual(selectCandidates([indebted, strong], strategy).map((item) => item.symbol), ["GOOD"]);
});

test("Ori ordering cannot admit an ineligible or unknown symbol", () => {
  const strategy = strategyFromPreset("quality-compounder");
  strategy.limits.maxPositions = 2;
  strategy.limits.maxPositionPct = 45;
  strategy.limits.cashReservePct = 10;
  const eligible = [
    { symbol: "AAA", name: "A", price: 10 },
    { symbol: "BBB", name: "B", price: 20 },
  ];
  const allocations = buildTargetAllocations(eligible, strategy, {
    picks: [
      { symbol: "BLOCKED", reason: "Should be ignored" },
      { symbol: "BBB", reason: "Ori preferred B" },
    ],
  });

  assert.deepEqual(allocations.map((item) => item.symbol), ["BBB", "AAA"]);
  assert.equal(allocations.some((item) => item.symbol === "BLOCKED"), false);
  assert.equal(allocations.reduce((sum, item) => sum + item.targetPct, 0), 90);
  assert.equal(allocations[0].source, "ori");
  assert.equal(allocations[1].source, "rule");
});

test("ranking treats zero as a real metric instead of missing data", () => {
  const strategy = strategyFromPreset("drawdown-defender");
  strategy.rules = [];
  strategy.universe = { type: "stocks", symbols: [], sectors: [], includeEtfs: true };
  strategy.ranking = { primary: "momentum90", secondary: "conviction", direction: "desc" };
  const candidates = selectCandidates(
    [{ symbol: "ZERO" }, { symbol: "MISSING" }, { symbol: "NEG" }],
    strategy,
    { ZERO: { momentum90: 0 }, MISSING: {}, NEG: { momentum90: -0.1 } },
  );
  assert.deepEqual(candidates.map((item) => item.symbol), ["ZERO", "NEG", "MISSING"]);
});

test("ascending rankings always put missing metrics last", () => {
  const strategy = strategyFromPreset("drawdown-defender");
  strategy.rules = [];
  strategy.universe = { type: "stocks", symbols: [], sectors: [], includeEtfs: true };
  strategy.ranking = { primary: "beta", secondary: "conviction", direction: "asc" };
  const candidates = selectCandidates([
    { symbol: "MISSING", conviction: 99 },
    { symbol: "LOW", beta: 0.7, conviction: 50 },
    { symbol: "HIGH", beta: 1.4, conviction: 80 },
  ], strategy);

  assert.deepEqual(candidates.map((item) => item.symbol), ["LOW", "HIGH", "MISSING"]);
});

test("an empty explicit-symbol universe cannot fall through to all stocks", () => {
  const strategy = createBlankStrategy();
  strategy.universe = { type: "symbols", symbols: [], sectors: [], includeEtfs: true };
  assert.equal(evaluateStock({ symbol: "SPY" }, strategy).excludedByUniverse, true);
});

test("paper rebalance records simulated shares and retains the cash floor", () => {
  const strategy = strategyFromPreset("quality-compounder", 100000);
  const allocations = [
    { symbol: "AAA", targetPct: 40, price: 100, source: "rule" },
    { symbol: "BBB", targetPct: 40, price: 50, source: "ori" },
  ];
  const result = rebalancePaperAccount(strategy, allocations, { AAA: 100, BBB: 50 });

  assert.equal(result.paper.holdings[0].shares, 400);
  assert.equal(result.paper.holdings[1].shares, 800);
  assert.equal(result.paper.cash, 20000);
  assert.equal(result.trades.length, 2);
});

test("paper rebalance preserves cost basis and never sells without a current price", () => {
  const strategy = createBlankStrategy(100000);
  strategy.paper = {
    ...strategy.paper,
    cash: 50000,
    holdings: [{ symbol: "AAA", shares: 500, avgPrice: 80, lastPrice: 100, targetPct: 50, source: "rule" }],
  };

  const increased = rebalancePaperAccount(
    strategy,
    [{ symbol: "AAA", targetPct: 60, price: 100, source: "rule" }],
    { AAA: 100 },
  );
  assert.equal(increased.paper.holdings[0].shares, 600);
  assert.ok(Math.abs(increased.paper.holdings[0].avgPrice - (500 * 80 + 100 * 100) / 600) < 0.0001);

  const unavailable = rebalancePaperAccount(strategy, [], {});
  assert.equal(unavailable.trades.length, 0);
  assert.deepEqual(unavailable.paper.holdings, strategy.paper.holdings);
  assert.equal(unavailable.paper.cash, strategy.paper.cash);
});

test("indicator calculation produces RSI, momentum, and a long average", () => {
  const prices = Array.from({ length: 220 }, (_, index) => 100 + index * 0.4 + Math.sin(index / 3));
  const indicators = calculateIndicators(prices);

  assert.ok(indicators.rsi14 > 50 && indicators.rsi14 <= 100);
  assert.ok(indicators.momentum90 > 0);
  assert.ok(indicators.sma200 > 100);
  assert.equal(indicators.price, prices.at(-1));
  assert.ok(indicators.windows[20].ema > 100);
  assert.ok(indicators.windows[20].priceStdDev > 0);
  assert.ok(indicators.windows[63].averageReturn > 0);
  assert.ok(indicators.windows[63].returnStdDev > 0);
  assert.ok(indicators.windows[126].maxDrawdown <= 0);
});

test("current-price rules require refreshed price history", () => {
  const strategy = createBlankStrategy();
  strategy.rules = [{ metric: "current_price", operator: ">=", value: 10 }];
  assert.equal(strategyDataRequirements(strategy).needsPriceHistory, true);
});

test("parameterized lookbacks drive eligibility conditions", () => {
  const prices = Array.from({ length: 260 }, (_, index) => 80 + index * 0.5);
  const indicators = calculateIndicators(prices, { lookbacks: [30, 120] });
  const strategy = createBlankStrategy();
  strategy.rules = [
    { id: "sma", metric: "price_vs_moving_average", lookbackDays: 120, operator: ">=", value: 0.1 },
    { id: "ret", metric: "cumulative_return", lookbackDays: 30, operator: ">=", value: 0.05 },
    { id: "rsi", metric: "rsi", lookbackDays: 14, operator: ">=", value: 50 },
  ];
  assert.equal(evaluateStock({ symbol: "UP" }, strategy, indicators).eligible, true);
  strategy.rules[1].value = 0.5;
  assert.equal(evaluateStock({ symbol: "UP" }, strategy, indicators).eligible, false);
});

test("ordered allocation branches use first match and can exclude", () => {
  const strategy = createBlankStrategy();
  strategy.rules = [];
  strategy.branches = [
    {
      id: "first",
      name: "First match overweights",
      match: "all",
      conditions: [{ id: "r1", metric: "rsi", lookbackDays: 14, operator: ">=", value: 60 }],
      action: "overweight",
      multiplier: 1.5,
    },
    {
      id: "second",
      name: "Later match excludes",
      match: "all",
      conditions: [{ id: "r2", metric: "rsi", lookbackDays: 14, operator: ">=", value: 70 }],
      action: "exclude",
      multiplier: 0,
    },
  ];
  const candidate = { symbol: "AAA", strategyIndicators: { windows: { 14: { rsi: 75 } } } };
  const firstMatch = applyAllocationBranches([candidate], strategy);
  assert.equal(firstMatch.length, 1);
  assert.equal(firstMatch[0].strategyAllocationPolicy.branch.id, "first");
  assert.equal(firstMatch[0].strategyWeightMultiplier, 1.5);

  strategy.branches.reverse();
  const excluded = evaluateAllocationBranches([candidate], strategy);
  assert.equal(excluded.included.length, 0);
  assert.equal(excluded.excluded.length, 1);
  assert.equal(excluded.excluded[0].strategyAllocationPolicy.branch.id, "second");
});

test("branch multipliers change target weights while caps and cash remain fixed", () => {
  const strategy = createBlankStrategy();
  strategy.limits = { ...strategy.limits, maxPositions: 2, maxPositionPct: 70, cashReservePct: 10 };
  const allocations = buildTargetAllocations([
    {
      symbol: "HEAVY",
      price: 10,
      strategyWeightMultiplier: 2,
      strategyAllocationPolicy: {
        matched: true,
        branch: { name: "Strong trend" },
        checks: [{ passed: true, value: 0.12, rule: { metric: "cumulative_return", lookbackDays: 63, operator: ">=", value: 0.1 } }],
      },
    },
    { symbol: "LIGHT", price: 10, strategyWeightMultiplier: 1 },
  ], strategy);
  assert.equal(allocations[0].targetPct, 60);
  assert.equal(allocations[1].targetPct, 30);
  assert.equal(allocations.reduce((sum, item) => sum + item.targetPct, 0), 90);
  assert.equal(allocations[0].branch, "Strong trend");
  assert.match(allocations[0].branchReason, /actual 12\.00%/);
});

test("stale FMP context fails closed and requirements request only used families", () => {
  const strategy = createBlankStrategy();
  strategy.rules = [{ id: "sector", metric: "sector_cumulative_return", operator: ">=", value: 0 }];
  strategy.branches = [{
    id: "movers",
    name: "Mover branch",
    match: "all",
    conditions: [{ id: "balance", metric: "sector_extreme_mover_balance", operator: ">=", value: 0 }],
    action: "overweight",
    multiplier: 1.2,
  }];
  const stock = { symbol: "AAA", sector: "Energy" };
  const stale = { sectorPerformance: { Energy: { usable: false, cumulativeReturn: 0.1 } } };
  const current = { sectorPerformance: { Energy: { usable: true, cumulativeReturn: 0.1 } } };
  assert.equal(evaluateStock(stock, strategy, {}, stale).eligible, false);
  assert.equal(evaluateStock(stock, strategy, {}, current).eligible, true);
  assert.deepEqual(new Set(strategyDataRequirements(strategy).signalFamilies), new Set(["sectorPerformance", "movers"]));
});

test("an unavailable movers feed is missing data rather than a false signal", () => {
  const strategy = createBlankStrategy();
  strategy.rules = [{ id: "not-loser", metric: "is_biggest_loser", operator: "=", value: false }];
  const stock = { symbol: "AAA" };
  const unavailable = { movers: { usable: false, bySymbol: {} } };
  const available = { movers: { usable: true, bySymbol: {} } };

  const unavailableResult = evaluateStock(stock, strategy, {}, unavailable);
  assert.equal(unavailableResult.eligible, false);
  assert.equal(unavailableResult.checks[0].missing, true);
  assert.equal(evaluateStock(stock, strategy, {}, available).eligible, true);
});

test("historical simulation uses actual input series and reports drawdown", () => {
  const rising = Array.from({ length: 100 }, (_, index) => 100 + index);
  const volatile = Array.from({ length: 100 }, (_, index) => 100 + index * 0.5 + Math.sin(index / 5) * 12);
  const benchmark = Array.from({ length: 100 }, (_, index) => 100 + index * 0.25);
  const result = buildHistoricalSimulation(
    { AAA: rising, BBB: volatile },
    [
      { symbol: "AAA", targetPct: 45 },
      { symbol: "BBB", targetPct: 45 },
    ],
    benchmark,
    100000,
  );

  assert.equal(result.days, 100);
  assert.ok(result.metrics.totalReturn > 0);
  assert.ok(result.metrics.benchmarkReturn > 0);
  assert.ok(result.metrics.maxDrawdown <= 0);
  assert.equal(result.series[0].value, 100000);
  assert.ok(result.series.at(-1).value < 100000 * ((rising.at(-1) / rising[0] + volatile.at(-1) / volatile[0]) / 2));
});

test("historical simulation accepts the dated price objects returned by the sparkline API", () => {
  const prices = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    price: 100 + index,
  }));
  const result = buildHistoricalSimulation(
    { SPY: prices },
    [{ symbol: "SPY", targetPct: 90 }],
    prices,
    100000,
  );

  assert.equal(result.days, 30);
  assert.ok(result.metrics.totalReturn > 0);
  assert.ok(result.metrics.benchmarkReturn > 0);
});
