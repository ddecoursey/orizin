import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateCostUsd,
  tokensFromUsage,
  costBreakdownFromTotals,
  microsToUsd,
} from '../geminiTokens.js';
import { valueModel, frontierModel } from '../geminiJson.js';

test('tokensFromUsage normalizes Gemini usageMetadata', () => {
  const t = tokensFromUsage({
    promptTokenCount: 1000,
    cachedContentTokenCount: 400,
    candidatesTokenCount: 250,
  });
  assert.equal(t.promptTokens, 1000);
  assert.equal(t.cachedTokens, 400);
  assert.equal(t.outputTokens, 250);
});

test('estimateCostUsd splits cached vs uncached input', () => {
  const model = valueModel();
  const c = estimateCostUsd(model, {
    promptTokens: 10_000,
    cachedTokens: 4_000,
    outputTokens: 2_000,
  });
  assert.ok(c.totalUsd > 0);
  assert.equal(c.uncachedTokens, 6_000);
  assert.equal(c.cachedTokens, 4_000);
  assert.ok(c.uncachedCostUsd > c.cachedCostUsd);
  assert.ok(c.outputCostUsd > 0);
});

test('frontier plan tokens cost more than flash chat tokens at same volume', () => {
  const tokens = { promptTokens: 5000, cachedTokens: 0, outputTokens: 1500 };
  const flash = estimateCostUsd(valueModel(), tokens).totalUsd;
  const frontier = estimateCostUsd(frontierModel(), tokens).totalUsd;
  assert.ok(frontier > flash);
});

test('costBreakdownFromTotals uses stored micros when present', () => {
  const b = costBreakdownFromTotals({
    prompt_tokens: 100,
    cached_tokens: 20,
    output_tokens: 50,
    chat_cost_usd_micros: 1_500_000,
    plan_cost_usd_micros: 500_000,
    cost_usd_micros: 2_000_000,
  });
  assert.equal(b.totalUsd, 2);
  assert.equal(b.chatUsd, 1.5);
  assert.equal(b.planUsd, 0.5);
  assert.equal(microsToUsd(2_000_000), 2);
});