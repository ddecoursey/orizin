import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatGeminiBody,
  buildFmpPlanningGeminiBody,
  contentsWithDynamicContext,
  getChatContextCacheName,
  cacheTtlSeconds,
  chatCacheModels,
  chatCacheViews,
  chatContextCacheEnvironmentEnabled,
  ensureChatContextCaches,
  fmpPlanningMaxOutputTokens,
  _resetChatContextCachesForTests,
  _setChatContextCacheForTests,
} from "../geminiContextCache.js";
import { ORI_SYSTEM_STATIC, ORI_SYSTEM_STATIC_DR } from "../oriSystemStatic.js";
import { chatMaxOutputTokens } from "../geminiContextCache.js";
import { valueModel } from "../geminiJson.js";
import { liteModel } from "../geminiJson.js";

beforeEach(() => {
  _resetChatContextCachesForTests();
});

test("buildChatGeminiBody uses cachedContent without system_instruction", () => {
  const model = valueModel();
  _setChatContextCacheForTests(model, "cachedContents/test-cache");
  const body = buildChatGeminiBody(model, "dynamic ctx", [{ role: "user", parts: [{ text: "hi" }] }]);
  assert.equal(body.cachedContent, "cachedContents/test-cache");
  assert.equal(body.system_instruction, undefined);
  assert.equal(body.generationConfig.maxOutputTokens, chatMaxOutputTokens("screener"));
  assert.equal(body.contents.length, 3);
  assert.match(body.contents[0].parts[0].text, /dynamic ctx/);
  assert.equal(body.contents[1].role, "model");
  assert.equal(body.contents[2].parts[0].text, "hi");
});

test("buildChatGeminiBody uses DR cache and higher output cap", () => {
  const model = valueModel();
  _setChatContextCacheForTests(model, "cachedContents/dr-cache", "deep-research");
  const body = buildChatGeminiBody(model, "dr ctx", [], "deep-research");
  assert.equal(body.cachedContent, "cachedContents/dr-cache");
  assert.equal(body.generationConfig.maxOutputTokens, chatMaxOutputTokens("deep-research"));
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

test("cacheTtlSeconds defaults to 24 hours", () => {
  const prev = process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS;
  delete process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS;
  try {
    assert.equal(cacheTtlSeconds(), 24 * 3600);
  } finally {
    if (prev != null) process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS = prev;
  }
});

test("buildChatGeminiBody DR fallback uses DR static text", () => {
  const model = valueModel();
  const body = buildChatGeminiBody(model, "dynamic ctx", [], "deep-research");
  assert.equal(body.system_instruction.parts[0].text, ORI_SYSTEM_STATIC_DR);
});

test("buildChatGeminiBody applies the configured chat thinking level (cached + fallback)", () => {
  const model = valueModel(); // gemini-3.5-flash → thinkingLevel
  const prev = process.env.ORI_CHAT_THINKING_LEVEL;
  process.env.ORI_CHAT_THINKING_LEVEL = "low";
  try {
    const fallback = buildChatGeminiBody(model, "ctx", []);
    assert.equal(fallback.generationConfig.thinkingConfig.thinkingLevel, "low");

    _setChatContextCacheForTests(model, "cachedContents/test-cache");
    const cached = buildChatGeminiBody(model, "ctx", []);
    assert.equal(cached.generationConfig.thinkingConfig.thinkingLevel, "low");
  } finally {
    if (prev == null) delete process.env.ORI_CHAT_THINKING_LEVEL;
    else process.env.ORI_CHAT_THINKING_LEVEL = prev;
  }
});

test("buildChatGeminiBody bypasses cachedContent when request-level tools are present", () => {
  const model = valueModel();
  const declarations = [{
    name: "fmp_quote",
    description: "Get a quote",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  }];

  const fallback = buildChatGeminiBody(model, "ctx", [], "screener", declarations);
  assert.deepEqual(fallback.tools, [{ functionDeclarations: declarations }]);
  assert.equal(fallback.toolConfig.functionCallingConfig.mode, "AUTO");

  _setChatContextCacheForTests(model, "cachedContents/test-cache");
  const toolEnabled = buildChatGeminiBody(model, "ctx", [], "screener", declarations);
  assert.equal(toolEnabled.cachedContent, undefined);
  assert.equal(toolEnabled.system_instruction.parts[0].text, ORI_SYSTEM_STATIC);
  assert.equal(toolEnabled.system_instruction.parts[1].text, "ctx");
  assert.deepEqual(toolEnabled.tools, [{ functionDeclarations: declarations }]);
  assert.equal(toolEnabled.toolConfig.functionCallingConfig.mode, "AUTO");
});

test("FMP planning body is Lite-sized and excludes Ori static/history context", () => {
  const declarations = [{
    name: "fmp_quote",
    description: "Get a quote",
    parameters: { type: "object", properties: { symbol: { type: "string" } } },
  }];
  const body = buildFmpPlanningGeminiBody(liteModel(), {
    message: "What is the current AAPL price?",
    view: "deep-research",
    activeSymbol: "AAPL",
  }, declarations);
  assert.equal(body.generationConfig.maxOutputTokens, fmpPlanningMaxOutputTokens());
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
  assert.deepEqual(body.tools, [{ functionDeclarations: declarations }]);
  assert.doesNotMatch(body.system_instruction.parts[0].text, /CURRENT REQUEST CONTEXT/);
  assert.ok(body.system_instruction.parts[0].text.length < 600);
  assert.equal(body.contents.length, 1);
});

test("cache targets default to production value+screener only", () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    GEMINI_CONTEXT_CACHE_NONPROD_ENABLED: process.env.GEMINI_CONTEXT_CACHE_NONPROD_ENABLED,
    GEMINI_CONTEXT_CACHE_LITE_ENABLED: process.env.GEMINI_CONTEXT_CACHE_LITE_ENABLED,
    GEMINI_CONTEXT_CACHE_VIEWS: process.env.GEMINI_CONTEXT_CACHE_VIEWS,
  };
  try {
    process.env.APP_ENV = "production";
    delete process.env.GEMINI_CONTEXT_CACHE_NONPROD_ENABLED;
    delete process.env.GEMINI_CONTEXT_CACHE_LITE_ENABLED;
    delete process.env.GEMINI_CONTEXT_CACHE_VIEWS;
    assert.equal(chatContextCacheEnvironmentEnabled(), true);
    assert.deepEqual(chatCacheModels(), [valueModel()]);
    assert.deepEqual(chatCacheViews(), ["screener"]);

    process.env.APP_ENV = "qa";
    assert.equal(chatContextCacheEnvironmentEnabled(), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("cache bootstrap reuses and extends a matching resource instead of creating another", async () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_CONTEXT_CACHE_ENABLED: process.env.GEMINI_CONTEXT_CACHE_ENABLED,
    GEMINI_CONTEXT_CACHE_VIEWS: process.env.GEMINI_CONTEXT_CACHE_VIEWS,
  };
  const originalFetch = global.fetch;
  const calls = [];
  try {
    process.env.APP_ENV = "production";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_CONTEXT_CACHE_ENABLED = "true";
    process.env.GEMINI_CONTEXT_CACHE_VIEWS = "screener";
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (!options.method) {
        return new Response(JSON.stringify({
          cachedContents: [{
            name: "cachedContents/existing",
            model: `models/${valueModel()}`,
            displayName: `orizin-ori-chat-static-v4-${valueModel()}`,
            expireTime: new Date(Date.now() + 60_000).toISOString(),
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      assert.equal(options.method, "PATCH");
      return new Response(JSON.stringify({
        name: "cachedContents/existing",
        expireTime: new Date(Date.now() + 86_400_000).toISOString(),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    await ensureChatContextCaches();
    assert.deepEqual(calls.map((call) => call.method), ["GET", "PATCH"]);
    assert.equal(getChatContextCacheName(valueModel()), "cachedContents/existing");
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
