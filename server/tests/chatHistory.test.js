import { test } from "node:test";
import assert from "node:assert/strict";
import {
  truncateChatHistory,
  clipMessageContent,
  toGeminiContents,
  historyContextNote,
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