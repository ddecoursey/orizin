import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeMovers,
  summarizePeRows,
  summarizePerformanceRows,
} from "../strategyMarketSignals.js";

test("sector performance rows are sorted, converted to decimals, and summarized", () => {
  const rows = [
    { date: "2026-07-09", averageChange: 2 },
    { date: "2026-07-08", averageChange: -1 },
    { date: "2026-07-10", averageChange: 1 },
  ];
  const summary = summarizePerformanceRows(rows, Date.parse("2026-07-10T23:00:00Z"));
  assert.equal(summary.asOf, "2026-07-10");
  assert.equal(summary.latestReturn, 0.01);
  assert.ok(Math.abs(summary.cumulativeReturn - 0.019898) < 1e-9);
  assert.ok(summary.returnStdDev > 0);
  assert.ok(summary.maxDrawdown < 0);
  assert.equal(summary.usable, true);
});

test("old Starter-plan historical samples are marked unusable", () => {
  const summary = summarizePerformanceRows(
    [{ date: "2024-03-01", averageChange: 1.2 }],
    Date.parse("2026-07-10T00:00:00Z"),
  );
  assert.equal(summary.usable, false);
  assert.ok(summary.ageDays > 800);
});

test("P/E history reports current value relative to its window average", () => {
  const summary = summarizePeRows([
    { date: "2026-07-08", pe: 10 },
    { date: "2026-07-09", pe: 20 },
    { date: "2026-07-10", pe: 30 },
  ], Date.parse("2026-07-10T12:00:00Z"));
  assert.equal(summary.pe, 30);
  assert.equal(summary.averagePe, 20);
  assert.equal(summary.peVsAverage, 0.5);
  assert.equal(summary.usable, true);
});

test("movers are joined to sectors and industries without calling profile APIs", () => {
  const summary = summarizeMovers(
    [
      { symbol: "AAA", changesPercentage: 10 },
      { symbol: "BBB", changesPercentage: 5 },
    ],
    [{ symbol: "CCC", changesPercentage: -8 }],
    [
      { symbol: "AAA", sector: "Energy", industry: "Oil" },
      { symbol: "BBB", sector: "Energy", industry: "Oil" },
      { symbol: "CCC", sector: "Energy", industry: "Coal" },
    ],
  );
  assert.equal(summary.bySymbol.AAA.side, "gainer");
  assert.equal(summary.bySymbol.CCC.return, -0.08);
  assert.equal(summary.sectors.Energy.gainerCount, 2);
  assert.equal(summary.sectors.Energy.loserCount, 1);
  assert.equal(summary.sectors.Energy.extremeMoverBalance, 1 / 3);
  assert.equal(summary.industries.Oil.extremeMoverBalance, 1);
});

