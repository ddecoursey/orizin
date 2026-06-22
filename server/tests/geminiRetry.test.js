import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiGenerateJson } from "../geminiJson.js";

// Drive geminiGenerateJson's structured ladder with a scripted fetch. We force
// the paid ladder on (GEMINI_ALLOW_PAID_NONPROD) so the real pro→flash→lite
// combos run instead of the non-prod lite-only collapse, and shrink the backoff
// to ~1ms so the retry tests stay fast. `handler(callNo, url, opts)` returns the
// stubbed Response for each attempt.
const TOUCHED = [
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_BACKUP",
  "GEMINI_ALLOW_PAID_NONPROD",
  "GEMINI_JSON_BACKOFF_BASE_MS",
  "GEMINI_JSON_BACKOFF_MAX_MS",
];

async function runLadder({ keys = ["A"], models, maxAttempts, handler }) {
  const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  const realFetch = global.fetch;
  process.env.GEMINI_API_KEY = keys[0];
  if (keys[1] != null) process.env.GEMINI_API_KEY_BACKUP = keys[1];
  else delete process.env.GEMINI_API_KEY_BACKUP;
  process.env.GEMINI_ALLOW_PAID_NONPROD = "1";
  process.env.GEMINI_JSON_BACKOFF_BASE_MS = "1";
  process.env.GEMINI_JSON_BACKOFF_MAX_MS = "1";
  let calls = 0;
  global.fetch = async (url, opts) => handler(++calls, url, opts);
  try {
    const outcome = await geminiGenerateJson({
      system: "s",
      prompt: "p",
      schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } },
      models,
      ...(maxAttempts ? { maxAttempts } : {}),
    }).then((value) => ({ value }), (error) => ({ error }));
    return { ...outcome, calls };
  } finally {
    global.fetch = realFetch;
    for (const k of TOUCHED) (saved[k] == null ? delete process.env[k] : (process.env[k] = saved[k]));
  }
}

const ok = () => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 1 },
  }),
});
const busy = (status = 503) => ({ ok: false, status, text: async () => "model is overloaded, please try again" });
const notFound = () => ({ ok: false, status: 404, text: async () => "model not found for this key" });
const badReq = () => ({ ok: false, status: 400, text: async () => "bad request" });

test("structured ladder rides out a transient overload (503 → 200) in one call", async () => {
  const r = await runLadder({
    models: ["m1", "m2", "m3"],
    handler: (n) => (n === 1 ? busy(503) : ok()),
  });
  assert.deepEqual(r.value?.data, { ok: true });
  assert.equal(r.calls, 2); // first 503, backed off, retried → success
});

test("structured ladder gives up with code 'overloaded' after maxAttempts", async () => {
  const r = await runLadder({
    models: ["m1"],
    maxAttempts: 3,
    handler: () => busy(503),
  });
  assert.equal(r.error?.code, "overloaded");
  assert.equal(r.calls, 3); // exactly maxAttempts — never bursts past the cap
});

test("structured ladder fails over a 404 to the next model immediately", async () => {
  const r = await runLadder({
    models: ["m404", "mok"],
    handler: (n, url) => (url.includes("m404") ? notFound() : ok()),
  });
  assert.deepEqual(r.value?.data, { ok: true });
  assert.equal(r.calls, 2); // m404 → mok, no wasted attempts
});

test("structured ladder throws immediately on a non-failover error", async () => {
  const r = await runLadder({
    models: ["m1"],
    handler: () => badReq(),
  });
  assert.equal(r.error?.code, "error");
  assert.equal(r.error?.status, 400);
  assert.equal(r.calls, 1); // 400 is deterministic — no retry
});

test("structured ladder retries the lead (Pro) model on the backup key", async () => {
  const r = await runLadder({
    keys: ["A", "B"],
    models: ["pro", "flash", "lite"],
    handler: (n, url, opts) =>
      url.includes("pro") && opts.headers["X-goog-api-key"] === "B" ? ok() : busy(503),
  });
  // pro@A, flash@A, lite@A all busy → pro@B succeeds: the "try all 3 again on the
  // other key" path, including Pro.
  assert.deepEqual(r.value?.data, { ok: true });
  assert.equal(r.value?.model, "pro");
  assert.equal(r.calls, 4);
});
