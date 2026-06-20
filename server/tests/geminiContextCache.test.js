import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatGeminiBody,
  contentsWithDynamicContext,
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

test("buildChatGeminiBody uses cachedContent without system_instruction", () => {
  const model = valueModel();
  _setChatContextCacheForTests(model, "cachedContents/test-cache");
  const body = buildChatGeminiBody(model, "dynamic ctx", [{ role: "user", parts: [{ text: "hi" }] }]);
  assert.equal(body.cachedContent, "cachedContents/test-cache");
  assert.equal(body.system_instruction, undefined);
  assert.equal(body.contents.length, 3);
  assert.match(body.contents[0].parts[0].text, /dynamic ctx/);
  assert.equal(body.contents[1].role, "model");
  assert.equal(body.contents[2].parts[0].text, "hi");
});

test("contentsWithDynamicContext prepends context before history", () => {
  const out = contentsWithDynamicContext("ctx", [{ role: "user", parts: [{ text: "question" }] }]);
  assert.equal(out.length, 3);
  assert.match(out[0].parts[0].text, /ctx/);
  assert.equal(out[2].parts[0].text, "question");
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