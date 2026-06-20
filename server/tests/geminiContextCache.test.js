import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatGeminiBody,
  getChatContextCacheName,
  cacheTtlSeconds,
  _resetChatContextCachesForTests,
  _setChatContextCacheForTests,
} from "../geminiContextCache.js";
import { ORI_SYSTEM_STATIC } from "../oriSystemStatic.js";
import { valueModel } from "../geminiJson.js";

beforeEach(() => {
  _resetChatContextCachesForTests();
});

test("buildChatGeminiBody uses cachedContent when a cache name exists", () => {
  const model = valueModel();
  _setChatContextCacheForTests(model, "cachedContents/test-cache");
  const body = buildChatGeminiBody(model, "dynamic ctx", [{ role: "user", parts: [{ text: "hi" }] }]);
  assert.equal(body.cachedContent, "cachedContents/test-cache");
  assert.equal(body.system_instruction.parts.length, 1);
  assert.equal(body.system_instruction.parts[0].text, "dynamic ctx");
  assert.ok(!body.system_instruction.parts.some((p) => p.text === ORI_SYSTEM_STATIC));
});

test("buildChatGeminiBody falls back to two-part system_instruction without cache", () => {
  const model = valueModel();
  const body = buildChatGeminiBody(model, "dynamic ctx", []);
  assert.equal(body.cachedContent, undefined);
  assert.equal(body.system_instruction.parts.length, 2);
  assert.equal(body.system_instruction.parts[0].text, ORI_SYSTEM_STATIC);
  assert.equal(body.system_instruction.parts[1].text, "dynamic ctx");
});

test("getChatContextCacheName returns null before bootstrap", () => {
  assert.equal(getChatContextCacheName(valueModel()), null);
});

test("cacheTtlSeconds defaults to one hour", () => {
  const prev = process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS;
  delete process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS;
  try {
    assert.equal(cacheTtlSeconds(), 3600);
  } finally {
    if (prev != null) process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS = prev;
  }
});