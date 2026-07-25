import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _resetFmpMcpForTests,
  compactFmpResult,
  sanitizeFmpArguments,
  selectFmpFamilies,
} from "../fmpMcp.js";

beforeEach(() => {
  _resetFmpMcpForTests();
});

test("FMP MCP routing selects only relevant families for explicit questions", () => {
  const technical = selectFmpFamilies("Check AAPL RSI and insider buying", "deep-research");
  assert.deepEqual(technical, ["insiderTrades", "technicalIndicators", "chart", "quote"]);

  const macro = selectFmpFamilies("What does CPI and the Fed imply for rates?", "screener");
  assert.deepEqual(macro, ["economics"]);
});

test("FMP MCP routing supplies a useful default stock research set", () => {
  assert.deepEqual(
    selectFmpFamilies("What do you think about AAPL?", "deep-research"),
    ["quote", "company", "analyst", "calendar", "news", "statements"],
  );
});

test("sanitizeFmpArguments enforces Starter-safe endpoint, symbols, and row limits", () => {
  const schema = {
    properties: {
      endpoint: { type: "string" },
      symbols: { type: "array" },
      limit: { type: "number" },
      page: { type: "number" },
      ignored: { type: "string" },
    },
  };
  const args = sanitizeFmpArguments("news", {
    endpoint: "search-stock-news",
    symbols: ["aapl", "MSFT", "NVDA", "GOOG", "META", "AMZN"],
    limit: 500,
    page: 99,
    madeUp: "drop me",
  }, schema);
  assert.deepEqual(args.symbols, ["AAPL", "MSFT", "NVDA", "GOOG", "META"]);
  assert.equal(args.limit, 25);
  assert.equal(args.page, 10);
  assert.equal(args.madeUp, undefined);
});

test("sanitizeFmpArguments forces bounded daily technical data", () => {
  const schema = {
    properties: {
      endpoint: { type: "string" },
      symbol: { type: "string" },
      periodLength: { type: "number" },
      timeframe: { type: "string" },
      from_date: { type: "string" },
      to_date: { type: "string" },
    },
  };
  const args = sanitizeFmpArguments("technicalIndicators", {
    endpoint: "relative-strength-index",
    symbol: "aapl",
    periodLength: 5000,
    timeframe: "1min",
    from_date: "2000-01-01",
    to_date: "2026-01-01",
  }, schema);
  assert.equal(args.symbol, "AAPL");
  assert.equal(args.periodLength, 250);
  assert.equal(args.timeframe, "1day");
  assert.ok(
    (Date.parse(args.to_date) - Date.parse(args.from_date)) / 86_400_000 <= 370,
  );
});

test("sanitizeFmpArguments rejects premium or bulk endpoints", () => {
  const schema = { properties: { endpoint: { type: "string" } } };
  assert.throws(
    () => sanitizeFmpArguments("quote", { endpoint: "full-exchange-quotes" }, schema),
    /not enabled/,
  );
});

test("compactFmpResult reports row truncation and stays under its budget", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    index,
    description: "x".repeat(500),
  }));
  const result = compactFmpResult(rows, "news", 4000);
  assert.equal(result.totalRows, 100);
  assert.equal(result.truncated, true);
  assert.ok(result.returnedRows < 100);
  assert.ok(JSON.stringify(result.data).length <= 4100);
});
