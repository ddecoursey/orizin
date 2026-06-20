import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolate DB for session validation unit tests.
const tmpDir = mkdtempSync(path.join(tmpdir(), "orizin-session-"));
process.env.DB_PATH = path.join(tmpDir, "screener.db");
process.env.SESSION_INACTIVITY_MS = "60000";

const db = await import("../db.js");
const { validateSessionPayload, inactivityMs } = await import("../session.js");

test("inactivityMs reads env override", () => {
  assert.equal(inactivityMs(), 60000);
});

test("validateSessionPayload rejects stale activity", () => {
  db.createUser("idle@example.com", "secret123", false, "idle@example.com");
  db.recordUserLogin("idle@example.com", { ip: "127.0.0.1", kind: "login" });
  db.touchUserActivity("idle@example.com");

  const user = db.getUserByUsername("idle@example.com");
  // Simulate idle beyond the 60s test window.
  db.default.prepare("UPDATE users SET last_active_at = ? WHERE username = ?").run(Date.now() - 120000, user.username);

  const result = validateSessionPayload({
    user: user.username,
    epoch: user.session_epoch ?? 0,
    iat: Date.now() - 120000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.body.code, "session_inactive");
});

test("validateSessionPayload rejects bumped session epoch", () => {
  db.createUser("epoch@example.com", "secret123", false, "epoch@example.com");
  db.recordUserLogin("epoch@example.com", { kind: "login" });
  const user = db.getUserByUsername("epoch@example.com");
  db.bumpSessionEpoch("epoch@example.com");
  const updated = db.getUserByUsername("epoch@example.com");

  const result = validateSessionPayload({
    user: user.username,
    epoch: user.session_epoch ?? 0,
    iat: Date.now(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.body.code, "session_revoked");
  assert.ok((updated.session_epoch ?? 0) > (user.session_epoch ?? 0));
});

rmSync(tmpDir, { recursive: true, force: true });