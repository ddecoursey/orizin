import { test } from "node:test";
import assert from "node:assert/strict";
import {
  thinkingConfigFor,
  chatThinkingLevel,
  gamePlanThinkingLevel,
  liteThinkingLevel,
  geminiGenerateJson,
  isProductionEnv,
  backgroundLiteIntangiblesEnabled,
  frontierModel,
  valueModel,
  liteModel,
} from "../geminiJson.js";
import { chatModelsForRequest } from "../routes/chat.js";

// Drive geminiGenerateJson with a stubbed fetch and return the captured outgoing
// request body, so we can assert what the structured (Game Plan / trickle) path
// actually sends to Gemini.
async function captureStructuredBody({
  thinkingLevel,
  model = "gemini-3.5-flash-lite",
  temperature = 0.45,
}) {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevBackup = process.env.GEMINI_API_KEY_BACKUP;
  const prevAllowPaid = process.env.GEMINI_ALLOW_PAID_NONPROD;
  const realFetch = global.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_API_KEY_BACKUP; // single combo → single capture
  process.env.GEMINI_ALLOW_PAID_NONPROD = "1";
  let captured = null;
  global.fetch = async (_url, opts) => {
    captured = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    };
  };
  try {
    const res = await geminiGenerateJson({
      system: "sys",
      prompt: "hi",
      schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } },
      maxOutputTokens: 900,
      thinkingLevel,
      temperature,
      models: [model],
    });
    return { captured, res };
  } finally {
    global.fetch = realFetch;
    if (prevKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    if (prevBackup != null) process.env.GEMINI_API_KEY_BACKUP = prevBackup;
    if (prevAllowPaid == null) delete process.env.GEMINI_ALLOW_PAID_NONPROD;
    else process.env.GEMINI_ALLOW_PAID_NONPROD = prevAllowPaid;
  }
}

test("thinkingConfigFor maps 3.x levels to a nested thinkingConfig.thinkingLevel", () => {
  assert.deepEqual(thinkingConfigFor("gemini-3.5-flash", "low"), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingConfigFor("gemini-3.1-flash-lite", "minimal"), { thinkingConfig: { thinkingLevel: "minimal" } });
  assert.deepEqual(thinkingConfigFor("gemini-3.1-pro-preview", "high"), { thinkingConfig: { thinkingLevel: "high" } });
});

test("thinkingConfigFor clamps 'minimal' up to 'low' for 3.x Pro (which rejects minimal)", () => {
  assert.deepEqual(thinkingConfigFor("gemini-3.1-pro-preview", "minimal"), { thinkingConfig: { thinkingLevel: "low" } });
});

test("thinkingConfigFor maps 2.5 levels to a nested thinkingConfig.thinkingBudget", () => {
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash", "minimal"), { thinkingConfig: { thinkingBudget: 0 } });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash", "low"), { thinkingConfig: { thinkingBudget: 1024 } });
  // 2.5 Pro can't disable thinking — a 0 budget is clamped up.
  assert.deepEqual(thinkingConfigFor("gemini-2.5-pro", "minimal"), { thinkingConfig: { thinkingBudget: 1024 } });
});

test("thinkingConfigFor returns null for sentinels, unknown levels, and unknown models", () => {
  assert.equal(thinkingConfigFor("gemini-3.5-flash", "default"), null);
  assert.equal(thinkingConfigFor("gemini-3.5-flash", ""), null);
  assert.equal(thinkingConfigFor("gemini-3.5-flash", undefined), null);
  assert.equal(thinkingConfigFor(null, "low"), null);
  assert.equal(thinkingConfigFor("some-future-model", "low"), null);
});

test("geminiGenerateJson injects thinkingConfig into the structured request body", async () => {
  const { captured, res } = await captureStructuredBody({ thinkingLevel: "low" });
  assert.deepEqual(res.data, { ok: true });
  assert.equal(captured.generationConfig.thinkingConfig.thinkingLevel, "low");
  // Thinking config must not clobber the other generationConfig fields.
  assert.equal(captured.generationConfig.maxOutputTokens, 900);
  assert.ok(captured.generationConfig.responseSchema);
  // No explicit cache passed → system goes inline as systemInstruction.
  assert.equal(captured.systemInstruction.parts[0].text, "sys");
});

test("current 3.5/3.6 models omit deprecated sampling controls", async () => {
  for (const model of ["gemini-3.5-flash-lite", "gemini-3.6-flash"]) {
    const { captured } = await captureStructuredBody({
      model,
      thinkingLevel: "minimal",
      temperature: 0.2,
    });
    assert.equal(captured.generationConfig.temperature, undefined);
    assert.equal(captured.generationConfig.topP, undefined);
    assert.equal(captured.generationConfig.topK, undefined);
  }
  const { captured: older } = await captureStructuredBody({
    model: "gemini-3.1-flash-lite",
    thinkingLevel: "minimal",
    temperature: 0.2,
  });
  assert.equal(older.generationConfig.temperature, 0.2);
});

test("geminiGenerateJson sends no thinkingConfig for the 'default' sentinel", async () => {
  const { captured } = await captureStructuredBody({ thinkingLevel: "default" });
  assert.equal(captured.generationConfig.thinkingConfig, undefined);
  assert.equal(captured.generationConfig.maxOutputTokens, 900);
});

test("per-journey level getters default minimal / medium / minimal and honor env", () => {
  const keys = ["ORI_CHAT_THINKING_LEVEL", "GAME_PLAN_THINKING_LEVEL", "GEMINI_LITE_THINKING_LEVEL"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    keys.forEach((k) => delete process.env[k]);
    assert.equal(chatThinkingLevel(), "minimal");
    assert.equal(gamePlanThinkingLevel(), "medium");
    assert.equal(liteThinkingLevel(), "minimal");

    process.env.ORI_CHAT_THINKING_LEVEL = "medium";
    process.env.GAME_PLAN_THINKING_LEVEL = "high";
    process.env.GEMINI_LITE_THINKING_LEVEL = "default";
    assert.equal(chatThinkingLevel(), "medium");
    assert.equal(gamePlanThinkingLevel(), "high");
    assert.equal(liteThinkingLevel(), "default");
  } finally {
    keys.forEach((k) => (prev[k] == null ? delete process.env[k] : (process.env[k] = prev[k])));
  }
});

test("cost-optimized model defaults replace stale former-default environment values", () => {
  const keys = ["GEMINI_FRONTIER_MODEL", "GEMINI_VALUE_MODEL", "GEMINI_LITE_MODEL"];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    keys.forEach((key) => delete process.env[key]);
    assert.equal(frontierModel(), "gemini-3.6-flash");
    assert.equal(valueModel(), "gemini-3.5-flash-lite");
    assert.equal(liteModel(), "gemini-3.1-flash-lite");

    process.env.GEMINI_FRONTIER_MODEL = "gemini-3.1-pro-preview";
    process.env.GEMINI_VALUE_MODEL = "gemini-3.5-flash";
    process.env.GEMINI_LITE_MODEL = "gemini-2.5-flash-lite";
    assert.equal(frontierModel(), "gemini-3.6-flash");
    assert.equal(valueModel(), "gemini-3.5-flash-lite");
    assert.equal(liteModel(), "gemini-3.1-flash-lite");

    process.env.GEMINI_VALUE_MODEL = "custom-gemini-model";
    assert.equal(valueModel(), "custom-gemini-model");
  } finally {
    keys.forEach((key) => (prev[key] == null ? delete process.env[key] : (process.env[key] = prev[key])));
  }
});

test("Railway preview environments do not silently enable paid Gemini tiers", () => {
  const keys = [
    "NODE_ENV",
    "APP_ENV",
    "PAYPAL_ENV",
    "RAILWAY_ENVIRONMENT",
    "RAILWAY_ENVIRONMENT_NAME",
    "GEMINI_ALLOW_PAID_NONPROD",
    "SCREENER_INTANGIBLES_ENABLED",
  ];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    keys.forEach((key) => delete process.env[key]);
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "qa";
    assert.equal(isProductionEnv(), false);
    assert.deepEqual(chatModelsForRequest(["gemini-3.5-flash"]), ["gemini-3.1-flash-lite"]);

    delete process.env.APP_ENV;
    process.env.RAILWAY_ENVIRONMENT = "preview-environment-id";
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    assert.equal(isProductionEnv(), false);

    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    assert.equal(isProductionEnv(), true);
    assert.deepEqual(chatModelsForRequest(["gemini-3.5-flash"]), ["gemini-3.5-flash"]);

    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.APP_ENV = "production";
    assert.equal(backgroundLiteIntangiblesEnabled(), false);
    process.env.SCREENER_INTANGIBLES_ENABLED = "true";
    assert.equal(backgroundLiteIntangiblesEnabled(), true);
    process.env.APP_ENV = "qa";
    assert.equal(backgroundLiteIntangiblesEnabled(), false);
  } finally {
    keys.forEach((key) => (prev[key] == null ? delete process.env[key] : (process.env[key] = prev[key])));
  }
});

test("malformed structured output exposes its already-billable generation", async () => {
  const keys = ["GEMINI_API_KEY", "GEMINI_API_KEY_BACKUP", "GEMINI_ALLOW_PAID_NONPROD"];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const realFetch = global.fetch;
  try {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GEMINI_API_KEY_BACKUP;
    process.env.GEMINI_ALLOW_PAID_NONPROD = "1";
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"broken":' }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 },
      }),
    });

    await assert.rejects(
      geminiGenerateJson({
        system: "system",
        prompt: "prompt",
        schema: { type: "OBJECT" },
        models: ["gemini-3.5-flash-lite"],
      }),
      (error) => {
        assert.equal(error.code, "bad_json");
        assert.equal(error.billableGeneration.model, "gemini-3.5-flash-lite");
        assert.equal(error.billableGeneration.usage.promptTokenCount, 20);
        assert.equal(error.billableGeneration.fallback.outputText, '{"broken":');
        return true;
      },
    );
  } finally {
    global.fetch = realFetch;
    keys.forEach((key) => (prev[key] == null ? delete process.env[key] : (process.env[key] = prev[key])));
  }
});
