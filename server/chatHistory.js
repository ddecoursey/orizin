// Ori chat history limits: what we send to Gemini vs what we keep in SQLite.

function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function boundedEnvInt(name, dflt, min, max) {
  return Math.min(max, Math.max(min, envInt(name, dflt)));
}

/** Max messages (user + assistant) included in a Gemini request. Default 16 ≈ 8 turns. */
export function chatHistoryMaxMessages() {
  return boundedEnvInt("ORI_CHAT_HISTORY_MAX", 16, 2, 24);
}

/** Deep Research chat uses a shorter window — one-stock threads rarely need long replay. */
export function chatHistoryMaxMessagesForView(view) {
  if (view === "deep-research") return boundedEnvInt("ORI_CHAT_HISTORY_MAX_DR", 10, 2, 16);
  return chatHistoryMaxMessages();
}

/** Per-message char cap when replaying history (long old replies are clipped). */
export function chatHistoryMsgChars() {
  return boundedEnvInt("ORI_CHAT_HISTORY_MSG_CHARS", 6000, 1000, 8000);
}

/** Time to wait for Gemini to start streaming a response. */
export function chatFetchTimeoutMs() {
  return envInt("ORI_CHAT_FETCH_TIMEOUT_MS", 45000);
}

/** Max wall time to read an in-flight stream (long answers). */
export function chatStreamTimeoutMs() {
  return envInt("ORI_CHAT_STREAM_TIMEOUT_MS", 180000);
}

export function clipMessageContent(content, maxChars = chatHistoryMsgChars()) {
  const text = typeof content === "string" ? content : "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[…message truncated for context…]`;
}

/**
 * Keep only the most recent messages for the model. Full history stays in DB;
 * this only bounds what we send on each turn.
 * @returns {{ messages: object[], truncated: boolean, dropped: number }}
 */
export function truncateChatHistory(messages, maxMessages = chatHistoryMaxMessages()) {
  if (!Array.isArray(messages) || messages.length <= maxMessages) {
    return { messages: messages || [], truncated: false, dropped: 0 };
  }
  let kept = messages.slice(-maxMessages);
  // Don't start mid-turn: drop a leading assistant message with no user before it.
  while (kept.length && kept[0].role === "assistant") kept = kept.slice(1);
  return {
    messages: kept,
    truncated: true,
    dropped: messages.length - kept.length,
  };
}

export function historyContextNote(dropped) {
  if (!dropped || dropped <= 0) return "";
  return `

=== CONVERSATION CONTEXT NOTE ===
${dropped} earlier message(s) from this chat are omitted from context to control cost and stay within limits. Continue naturally; only ask the user to repeat something if you truly need it.`;
}

/** Convert stored chat rows to Gemini contents (with per-message clipping). */
export function toGeminiContents(messages) {
  return (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: clipMessageContent(m.content) }],
  }));
}
