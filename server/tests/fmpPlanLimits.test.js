import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  execCompAllowed,
  execCompRestricted,
  _resetFmpPlanLimitsForTests,
} from "../fmpPlanLimits.js";

beforeEach(() => {
  _resetFmpPlanLimitsForTests();
  delete process.env.FMP_EXEC_COMP_SYMBOLS;
});

test("execCompAllowed permits all symbols when env is unset", () => {
  assert.equal(execCompRestricted(), false);
  assert.equal(execCompAllowed("PLD"), true);
  assert.equal(execCompAllowed("aapl"), true);
});

test("execCompAllowed respects comma-separated allowlist", () => {
  process.env.FMP_EXEC_COMP_SYMBOLS = "AAPL, MSFT, nvda";
  assert.equal(execCompRestricted(), true);
  assert.equal(execCompAllowed("AAPL"), true);
  assert.equal(execCompAllowed("MSFT"), true);
  assert.equal(execCompAllowed("NVDA"), true);
  assert.equal(execCompAllowed("PLD"), false);
});

test("empty FMP_EXEC_COMP_SYMBOLS means unrestricted", () => {
  process.env.FMP_EXEC_COMP_SYMBOLS = "  ";
  assert.equal(execCompRestricted(), false);
  assert.equal(execCompAllowed("PLD"), true);
});