import { test } from "node:test";
import assert from "node:assert/strict";
import {
  functionResponsePart,
  mergeGeminiUsage,
  readGeminiStream,
} from "../geminiTooling.js";

test("mergeGeminiUsage sums token counts across tool-loop generations", () => {
  const first = {
    promptTokenCount: 100,
    cachedContentTokenCount: 80,
    candidatesTokenCount: 10,
    thoughtsTokenCount: 4,
  };
  const second = {
    promptTokenCount: 140,
    cachedContentTokenCount: 80,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 6,
  };
  assert.deepEqual(mergeGeminiUsage(first, second), {
    promptTokenCount: 240,
    cachedContentTokenCount: 160,
    candidatesTokenCount: 30,
    thoughtsTokenCount: 10,
  });
});

test("functionResponsePart preserves Gemini function-call IDs", () => {
  assert.deepEqual(
    functionResponsePart({ name: "fmp_quote", id: "call-7" }, { ok: true }),
    {
      functionResponse: {
        name: "fmp_quote",
        id: "call-7",
        response: { ok: true },
      },
    },
  );
});

test("readGeminiStream keeps thought signatures but hides thought text", async () => {
  const events = [
    {
      candidates: [{
        content: {
          role: "model",
          parts: [{ text: "private thought", thought: true }],
        },
      }],
    },
    {
      candidates: [{
        content: {
          role: "model",
          parts: [{
            functionCall: { name: "fmp_quote", id: "abc", args: { symbol: "AAPL" } },
            thoughtSignature: "signature-data",
          }],
        },
      }],
      usageMetadata: { promptTokenCount: 12 },
    },
  ];
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const response = new Response(payload);
  let visible = "";
  const result = await readGeminiStream(response, {
    timeoutMs: 1000,
    onText: (text) => { visible += text; },
  });

  assert.equal(visible, "");
  assert.equal(result.text, "");
  assert.equal(result.functionCalls[0].id, "abc");
  assert.equal(result.parts[1].thoughtSignature, "signature-data");
  assert.deepEqual(result.usage, { promptTokenCount: 12 });
});
