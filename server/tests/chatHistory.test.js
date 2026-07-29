import { test } from "node:test";
import assert from "node:assert/strict";
import {
  truncateChatHistory,
  clipMessageContent,
  toGeminiContents,
  historyContextNote,
  chatHistoryMaxMessages,
  chatHistoryMaxMessagesForView,
  chatHistoryMsgChars,
} from "../chatHistory.js";

test("truncateChatHistory keeps full history when under the cap", () => {
  const msgs = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ];
  const r = truncateChatHistory(msgs, 10);
  assert.equal(r.truncated, false);
  assert.equal(r.dropped, 0);
  assert.equal(r.messages.length, 2);
});

test("truncateChatHistory drops oldest messages beyond the cap", () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));
  const r = truncateChatHistory(msgs, 24);
  assert.equal(r.truncated, true);
  assert.equal(r.dropped, 6);
  assert.equal(r.messages.length, 24);
  assert.equal(r.messages[0].content, "m6");
});

test("truncateChatHistory does not start on a lone assistant turn", () => {
  const msgs = [
    { role: "user", content: "old" },
    { role: "assistant", content: "old reply" },
    { role: "user", content: "new" },
  ];
  const r = truncateChatHistory(msgs, 2);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].role, "user");
  assert.equal(r.messages[0].content, "new");
});

test("clipMessageContent shortens very long messages", () => {
  const long = "x".repeat(100);
  const clipped = clipMessageContent(long, 20);
  assert.ok(clipped.length < long.length);
  assert.ok(clipped.includes("truncated"));
});

test("toGeminiContents maps assistant to model", () => {
  const contents = toGeminiContents([{ role: "assistant", content: "hi" }]);
  assert.equal(contents[0].role, "model");
});

test("historyContextNote is empty when nothing dropped", () => {
  assert.equal(historyContextNote(0), "");
});

test("chatHistoryMaxMessagesForView uses shorter cap for deep-research", () => {
  const prev = process.env.ORI_CHAT_HISTORY_MAX_DR;
  delete process.env.ORI_CHAT_HISTORY_MAX_DR;
  assert.equal(chatHistoryMaxMessagesForView("deep-research"), 10);
  assert.equal(chatHistoryMaxMessagesForView("screener"), chatHistoryMaxMessagesForView());
  if (prev != null) process.env.ORI_CHAT_HISTORY_MAX_DR = prev;
});

test("history environment overrides cannot remove cost ceilings", () => {
  const keys = ["ORI_CHAT_HISTORY_MAX", "ORI_CHAT_HISTORY_MAX_DR", "ORI_CHAT_HISTORY_MSG_CHARS"];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.ORI_CHAT_HISTORY_MAX = "9999";
    process.env.ORI_CHAT_HISTORY_MAX_DR = "9999";
    process.env.ORI_CHAT_HISTORY_MSG_CHARS = "999999";
    assert.equal(chatHistoryMaxMessages(), 24);
    assert.equal(chatHistoryMaxMessagesForView("deep-research"), 16);
    assert.equal(chatHistoryMsgChars(), 8000);
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
