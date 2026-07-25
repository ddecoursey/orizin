// Helpers for Gemini streaming function-call turns. Kept separate from the
// Express route so thought signatures, function IDs, and usage aggregation stay
// explicit and testable.

const USAGE_FIELDS = [
  "promptTokenCount",
  "cachedContentTokenCount",
  "candidatesTokenCount",
  "thoughtsTokenCount",
  "toolUsePromptTokenCount",
  "totalTokenCount",
];

export function mergeGeminiUsage(current, next) {
  if (!next || typeof next !== "object") return current;
  const merged = { ...(current || {}) };
  for (const field of USAGE_FIELDS) {
    const value = Number(next[field]);
    if (!Number.isFinite(value)) continue;
    merged[field] = (Number(merged[field]) || 0) + Math.max(0, value);
  }
  return merged;
}

export function functionResponsePart(functionCall, response) {
  const call = functionCall || {};
  const value = response && typeof response === "object" && !Array.isArray(response)
    ? response
    : { result: response };
  return {
    functionResponse: {
      name: call.name,
      ...(call.id ? { id: call.id } : {}),
      response: value,
    },
  };
}

function processGeminiEvent(event, state, callbacks) {
  if (event?.usageMetadata) state.usage = event.usageMetadata;
  const candidate = event?.candidates?.[0];
  if (!candidate?.content) return;
  if (candidate.content.role) state.role = candidate.content.role;

  for (const rawPart of candidate.content.parts || []) {
    if (!rawPart || typeof rawPart !== "object") continue;
    // JSON parsing already gave us a detached object. Preserve every field,
    // especially Gemini 3's thoughtSignature on function-call parts.
    const part = { ...rawPart };
    state.parts.push(part);

    if (part.functionCall?.name) {
      state.functionCalls.push(part.functionCall);
      if (part.functionCall.name === "apply_screener_filters") {
        callbacks.onApplyFilters?.(part.functionCall.args || {});
      }
    }

    // Thought text is internal reasoning, not user-visible answer text.
    if (typeof part.text === "string" && !part.thought) {
      state.text += part.text;
      callbacks.onText?.(part.text);
    }
  }
}

function processSseLine(line, state, callbacks) {
  if (!line.startsWith("data:")) return;
  const raw = line.slice(5).trim();
  if (!raw || raw === "[DONE]") return;
  try {
    processGeminiEvent(JSON.parse(raw), state, callbacks);
  } catch {
    // A malformed upstream event should not discard the rest of a valid stream.
  }
}

/**
 * Read one Gemini stream and return the exact model parts plus any function
 * calls. onReader exposes the active reader so client disconnects can cancel it.
 */
export async function readGeminiStream(response, {
  timeoutMs,
  isCancelled,
  onReader,
  onText,
  onApplyFilters,
} = {}) {
  const reader = response.body.getReader();
  onReader?.(reader);
  const decoder = new TextDecoder();
  const state = {
    role: "model",
    parts: [],
    functionCalls: [],
    text: "",
    usage: null,
  };
  let buffer = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { reader.cancel().catch(() => {}); } catch { /* reader already closed */ }
  }, timeoutMs);

  try {
    while (true) {
      if (isCancelled?.()) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) processSseLine(line, state, { onText, onApplyFilters });
    }
    buffer += decoder.decode();
    if (buffer) processSseLine(buffer, state, { onText, onApplyFilters });
  } finally {
    clearTimeout(timer);
  }

  return { ...state, timedOut };
}
