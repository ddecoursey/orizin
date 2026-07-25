import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "orizin-ori-reservation-"));
process.env.DB_PATH = path.join(tmpDir, "screener.db");
process.env.ORI_SESSION_LIMIT = "2";
process.env.ORI_DAILY_LIMIT = "20";
process.env.ORI_WEEKLY_LIMIT = "40";
process.env.ORI_MONTHLY_LIMIT = "80";

const db = await import("../db.js");
const {
  acquireOriQuota,
  getOriUsageSummary,
  recordOriUsage,
  releaseOriQuota,
} = await import("../oriUsage.js");

const USER = "quota@example.com";
db.createUser(USER, "secret123", false, USER, "pro");

after(() => {
  try { db.default.close(); } catch { /* already closed */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

test("in-flight Ori calls count against the session cap", () => {
  const first = acquireOriQuota(USER);
  const second = acquireOriQuota(USER);
  const blocked = acquireOriQuota(USER);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.scope, "session");

  releaseOriQuota(first.reservation);
  const admitted = acquireOriQuota(USER);
  assert.equal(admitted.ok, true);

  releaseOriQuota(first.reservation);
  releaseOriQuota(second.reservation);
  releaseOriQuota(admitted.reservation);
});

test("completed Ori usage updates calendar and rolling ledgers together", async () => {
  const recorded = await recordOriUsage(USER, {
    kind: "chat",
    model: "gemini-3.1-flash-lite",
    usage: { promptTokenCount: 100, candidatesTokenCount: 20 },
  });
  assert.equal(recorded, true);

  const summary = getOriUsageSummary(USER);
  assert.equal(summary.day.requests, 1);
  assert.equal(summary.session.used, 1);
});

test("admin Ori access remains unlimited and needs no reservation", () => {
  db.createUser("quota-admin@example.com", "secret123", true, "quota-admin@example.com", "pro");
  const quota = acquireOriQuota("quota-admin@example.com");
  assert.equal(quota.ok, true);
  assert.equal(quota.unlimited, true);
  assert.equal(quota.reservation, null);
});
