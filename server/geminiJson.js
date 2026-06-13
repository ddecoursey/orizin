// ── Structured (JSON) Gemini call ────────────────────────────────────────────
// The chat route streams free-form text (streamGenerateContent + SSE). The Game
// Plan needs ONE structured object back, so this uses the non-streaming
// generateContent endpoint with responseMimeType:application/json + a
// responseSchema, plus the same overload-aware retry/backoff philosophy as chat.
// Errors carry a `code` so callers can map them to friendly HTTP responses.

const GEMINI_JSON_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => 500 * 2 ** attempt + Math.random() * 250;
const retryable = (status, body) =>
  status === 429 || status === 503 || (status >= 500 && /unavailable|overloaded|try again/i.test(body || ""));

function err(message, code, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

/**
 * Generate a structured JSON object from Gemini.
 * @param {object}  opts
 * @param {string}  opts.system   system instruction
 * @param {string}  opts.prompt   user prompt
 * @param {object}  opts.schema   Gemini responseSchema (UPPERCASE OpenAPI types)
 * @param {number} [opts.temperature]
 * @returns {Promise<object>} parsed JSON
 * @throws  Error with .code: "no_key" | "overloaded" | "bad_json" | "error"
 */
export async function geminiGenerateJson({ system, prompt, schema, temperature = 0.45 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") throw err("GEMINI_API_KEY not configured", "no_key");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(GEMINI_JSON_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(backoff(attempt));
        continue;
      }
      throw err("Network error reaching Ori", "overloaded");
    }

    if (res.ok) {
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (!text) throw err("Ori returned an empty response", "bad_json");
      try {
        return JSON.parse(text);
      } catch {
        throw err("Ori returned malformed JSON", "bad_json");
      }
    }

    const bodyText = await res.text();
    lastStatus = res.status;
    if (retryable(res.status, bodyText) && attempt < MAX_RETRIES) {
      await sleep(backoff(attempt));
      continue;
    }
    throw err(`Gemini error ${res.status}`, retryable(res.status, bodyText) ? "overloaded" : "error", { status: res.status });
  }
  throw err(`Gemini error ${lastStatus}`, "overloaded", { status: lastStatus });
}
