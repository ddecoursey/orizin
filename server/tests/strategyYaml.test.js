import test from "node:test";
import assert from "node:assert/strict";
import {
  StrategyYamlError,
  strategyFromYaml,
  strategyToYaml,
  validateStrategyYaml,
} from "../../src/lib/strategyYaml.js";
import { createBlankStrategy, strategyFromPreset } from "../../src/lib/strategies.js";

test("strategy YAML round-trips preset rules, branches, limits, and Ori boundaries", () => {
  const original = strategyFromPreset("sector-rotator", 125000);
  const source = strategyToYaml(original);
  const compiled = strategyFromYaml(source, original);

  assert.match(source, /decision_tree:/);
  assert.match(source, /else:/);
  assert.equal(compiled.name, original.name);
  assert.equal(compiled.rules.length, original.rules.length);
  assert.equal(compiled.branches.length, original.branches.length);
  assert.equal(compiled.branches[0].action, "overweight");
  assert.equal(compiled.limits.cashReservePct, 16);
  assert.equal(compiled.limits.allowOri, true);
  assert.equal(compiled.paper.startingCash, 125000);
});

test("strategy YAML compiles readable percentages and ordered when/then logic", () => {
  const base = createBlankStrategy();
  const source = `
version: 1
name: YAML momentum
description: A readable strategy fixture.
universe:
  type: symbols
  symbols: [SPY, QQQ]
  sectors: []
  include_etfs: true
eligibility:
  if:
    match: all
    conditions:
      - metric: cumulative_return
        operator: ">="
        value: 5%
        lookback_days: 63
        explanation: Return must be positive.
  then: continue
  else: reject
decision_tree:
  - when:
      name: Trim overbought assets
      match: any
      conditions:
        - metric: rsi
          operator: ">="
          value: 72
          lookback_days: 14
          explanation: RSI is stretched.
    then:
      allocation: underweight
      weight_multiplier: 0.5
  - else:
      allocation: normal
      weight_multiplier: 1
ranking:
  metric: cumulative_return
  lookback_days: 63
  direction: desc
  tiebreaker: conviction
portfolio:
  max_positions: 2
  max_position: 35%
  minimum_cash: 30%
  review: Monthly
ori:
  enabled: false
  role: Off. Fixed rules decide.
  minimum_confidence: 65
  brief: ""
benchmark: SPY
paper:
  starting_cash: 100000
`;
  const strategy = strategyFromYaml(source, base);

  assert.equal(strategy.rules[0].value, 0.05);
  assert.equal(strategy.rules[0].lookbackDays, 63);
  assert.equal(strategy.branches[0].multiplier, 0.5);
  assert.equal(strategy.limits.maxPositionPct, 35);
  assert.equal(strategy.limits.cashReservePct, 30);
});

test("strategy YAML rejects unknown metrics and a missing final else", () => {
  const base = createBlankStrategy();
  const invalid = strategyToYaml(base)
    .replace("metric: conviction", "metric: future_prediction")
    .replace("decision_tree:\n  - else:\n      allocation: normal\n      weight_multiplier: 1\n", "decision_tree: []\n");
  const result = validateStrategyYaml(invalid, base);

  assert.equal(result.strategy, null);
  assert.ok(result.errors.some((error) => error.includes("future_prediction")));
  assert.ok(result.errors.some((error) => error.includes("explicit else")));
});

test("strategy YAML cannot reset starting cash after paper holdings exist", () => {
  const base = createBlankStrategy(100000);
  base.paper.holdings = [{ symbol: "SPY", shares: 10, avgPrice: 500, lastPrice: 500 }];
  const source = strategyToYaml(base).replace("starting_cash: 100000", "starting_cash: 200000");

  assert.throws(() => strategyFromYaml(source, base), (error) => {
    assert.ok(error instanceof StrategyYamlError);
    assert.ok(error.errors.some((message) => message.includes("cannot change")));
    return true;
  });
});

test("strategy YAML parses quoted booleans instead of treating any string as true", () => {
  const base = createBlankStrategy();
  const source = strategyToYaml(base).replace("include_etfs: false", 'include_etfs: "false"');
  assert.equal(strategyFromYaml(source, base).universe.includeEtfs, false);

  const invalid = source.replace('include_etfs: "false"', 'include_etfs: "sometimes"');
  assert.throws(() => strategyFromYaml(invalid, base), StrategyYamlError);
});
