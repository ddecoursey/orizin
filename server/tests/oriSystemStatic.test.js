import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORI_SYSTEM_STATIC,
  ORI_SYSTEM_STATIC_DR,
  ORI_SCORECARD_DEFINITION,
  estimateOriStaticTokens,
  oriStaticForView,
} from "../oriSystemStatic.js";

const GEMINI_35_FLASH_CACHE_MIN_TOKENS = 4096;

test("ORI_SYSTEM_STATIC includes score methodology and view-mode rules", () => {
  assert.match(ORI_SYSTEM_STATIC, /CONVICTION METHODOLOGY/);
  assert.match(ORI_SYSTEM_STATIC, /VIEW MODE/);
  assert.ok(ORI_SYSTEM_STATIC.includes(ORI_SCORECARD_DEFINITION.description.slice(0, 40)));
});

test("ORI_SYSTEM_STATIC meets Gemini 3.5 Flash explicit-cache minimum", () => {
  const est = estimateOriStaticTokens();
  assert.ok(
    est >= GEMINI_35_FLASH_CACHE_MIN_TOKENS,
    `expected ≥${GEMINI_35_FLASH_CACHE_MIN_TOKENS} est. tokens, got ${est} (${ORI_SYSTEM_STATIC.length} chars)`,
  );
});

test("ORI_SYSTEM_STATIC_DR meets cache minimum and omits screener filter block", () => {
  const est = estimateOriStaticTokens(ORI_SYSTEM_STATIC_DR);
  assert.ok(est >= GEMINI_35_FLASH_CACHE_MIN_TOKENS, `DR static too short: ${est} tokens`);
  assert.ok(!ORI_SYSTEM_STATIC_DR.includes("SCREENER RECOMMENDATIONS (FILTERS ONLY)"));
  assert.match(ORI_SYSTEM_STATIC_DR, /DEEP RESEARCH RESPONSE STYLE/);
});

test("oriStaticForView selects DR static on deep-research", () => {
  assert.equal(oriStaticForView("deep-research"), ORI_SYSTEM_STATIC_DR);
  assert.equal(oriStaticForView("screener"), ORI_SYSTEM_STATIC);
});