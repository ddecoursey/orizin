import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "orizin-user-deletion-"));
process.env.DB_PATH = path.join(tmpDir, "screener.db");

const db = await import("../db.js");

after(() => {
  try { db.default.close(); } catch { /* already closed */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

test("user deletion clears watchlist alert state and server sessions", () => {
  const username = "delete-all@example.com";
  const sid = "session-for-deletion-test-1234567890";
  db.createUser(username, "secret123", false, username);
  db.saveWatchlistAlertState(username, "AAPL", {
    baseline_price: 200,
    pending_digest: [{ type: "price" }],
  });
  db.createAuthSession(username, sid, Date.now() + 60_000);

  assert.equal(db.listWatchlistAlertStatesForUser(username).length, 1);
  assert.equal(db.isAuthSessionActive(username, sid), true);

  assert.equal(db.deleteUserCascade(username).changes, 1);
  assert.equal(db.listWatchlistAlertStatesForUser(username).length, 0);
  assert.equal(db.isAuthSessionActive(username, sid), false);
});
