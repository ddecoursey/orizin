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
const { validateSessionPayload, inactivityMs, signToken, touchUserActivity } = await import("../session.js");

test("inactivityMs reads env override", () => {
  assert.equal(inactivityMs(), 60000);
});

test("touchUserActivity reports whether the rolling cookie should refresh", () => {
  db.createUser("active@example.com", "secret123", false, "active@example.com");
  assert.equal(touchUserActivity("active@example.com"), true);
  assert.equal(touchUserActivity("active@example.com"), false);
});

test("server-side session revocation rejects copied cookies", () => {
  const username = "session-id@example.com";
  const sid = "session-id-for-unit-test-1234567890";
  db.createUser(username, "secret123", false, username);
  db.createAuthSession(username, sid, Date.now() + 60_000);

  const payload = { user: username, sid, epoch: 0, iat: Date.now() };
  assert.equal(validateSessionPayload(payload).ok, true);
  assert.equal(db.revokeAuthSession(username, sid), true);

  const revoked = validateSessionPayload(payload);
  assert.equal(revoked.ok, false);
  assert.equal(revoked.body.code, "session_revoked");
});

test("legacy cookies remain valid long enough to receive a session id", () => {
  const username = "legacy-session@example.com";
  db.createUser(username, "secret123", false, username);
  const payload = { user: username, epoch: 0, iat: Date.now(), exp: Date.now() + 60_000 };
  const token = signToken(payload);
  const result = validateSessionPayload(payload, token);
  assert.equal(result.ok, true);
  assert.equal(result.needsSessionUpgrade, true);

  db.revokeLegacyAuthToken(username, token, payload.exp);
  const revoked = validateSessionPayload(payload, token);
  assert.equal(revoked.ok, false);
  assert.equal(revoked.body.code, "session_revoked");
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
