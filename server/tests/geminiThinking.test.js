import { test } from "node:test";
import assert from "node:assert/strict";
import {
  thinkingConfigFor,
  chatThinkingLevel,
  gamePlanThinkingLevel,
  liteThinkingLevel,
  geminiGenerateJson,
  isProductionEnv,
} from "../geminiJson.js";

// Drive geminiGenerateJson with a stubbed fetch and return the captured outgoing
// request body, so we can assert what the structured (Game Plan / trickle) path
// actually sends to Gemini.
async function captureStructuredBody({ thinkingLevel }) {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevBackup = process.env.GEMINI_API_KEY_BACKUP;
  const realFetch = global.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_API_KEY_BACKUP; // single combo → single capture
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
      models: ["gemini-3.5-flash"],
    });
    return { captured, res };
  } finally {
    global.fetch = realFetch;
    if (prevKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    if (prevBackup != null) process.env.GEMINI_API_KEY_BACKUP = prevBackup;
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

test("geminiGenerateJson sends no thinkingConfig for the 'default' sentinel", async () => {
  const { captured } = await captureStructuredBody({ thinkingLevel: "default" });
  assert.equal(captured.generationConfig.thinkingConfig, undefined);
  assert.equal(captured.generationConfig.maxOutputTokens, 900);
});

test("per-journey level getters default low / medium / minimal and honor env", () => {
  const keys = ["ORI_CHAT_THINKING_LEVEL", "GAME_PLAN_THINKING_LEVEL", "GEMINI_LITE_THINKING_LEVEL"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    keys.forEach((k) => delete process.env[k]);
    assert.equal(chatThinkingLevel(), "low");
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

test("Railway preview environments do not silently enable paid Gemini tiers", () => {
  const keys = ["NODE_ENV", "APP_ENV", "PAYPAL_ENV", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME"];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    keys.forEach((key) => delete process.env[key]);
    process.env.RAILWAY_ENVIRONMENT = "preview-environment-id";
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
    assert.equal(isProductionEnv(), false);

    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    assert.equal(isProductionEnv(), true);
  } finally {
    keys.forEach((key) => (prev[key] == null ? delete process.env[key] : (process.env[key] = prev[key])));
  }
});
