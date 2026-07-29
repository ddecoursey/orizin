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

test("tool-assisted chat reserves and records one quota unit per Gemini generation", async () => {
  const user = "tool-quota@example.com";
  db.createUser(user, "secret123", false, user, "pro");

  const reservation = acquireOriQuota(user, { units: 2 });
  assert.equal(reservation.ok, true);
  assert.equal(reservation.reservation.units, 2);
  assert.equal(acquireOriQuota(user).ok, false);
  releaseOriQuota(reservation.reservation);

  const recorded = await recordOriUsage(user, {
    kind: "chat",
    generations: [
      {
        model: "gemini-3.1-flash-lite",
        usage: { promptTokenCount: 50, candidatesTokenCount: 5 },
      },
      {
        model: "gemini-3.5-flash",
        usage: {
          promptTokenCount: 200,
          cachedContentTokenCount: 100,
          candidatesTokenCount: 20,
        },
      },
    ],
  });
  assert.equal(recorded, true);

  const summary = getOriUsageSummary(user);
  assert.equal(summary.day.requests, 2);
  assert.equal(summary.day.chatRequests, 1);
  assert.equal(summary.session.used, 2);
  assert.equal(summary.day.promptTokens, 250);
  assert.equal(summary.day.cachedTokens, 100);
});

test("dollar-denominated guard blocks further generations after the budget is spent", async () => {
  const user = "cost-quota@example.com";
  db.createUser(user, "secret123", false, user, "pro");
  const previous = process.env.ORI_DAILY_COST_LIMIT_USD;
  process.env.ORI_DAILY_COST_LIMIT_USD = "0.00001";
  try {
    await recordOriUsage(user, {
      kind: "chat",
      model: "gemini-3.5-flash",
      usage: { promptTokenCount: 100, candidatesTokenCount: 100 },
    });
    const blocked = acquireOriQuota(user);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.scope, "cost_day");
  } finally {
    if (previous == null) delete process.env.ORI_DAILY_COST_LIMIT_USD;
    else process.env.ORI_DAILY_COST_LIMIT_USD = previous;
  }
});

test("admin Ori access is metered unless unlimited mode is explicitly enabled", () => {
  db.createUser("quota-admin@example.com", "secret123", true, "quota-admin@example.com", "pro");
  const metered = acquireOriQuota("quota-admin@example.com");
  assert.equal(metered.ok, true);
  assert.equal(metered.unlimited, undefined);
  assert.ok(metered.reservation);
  releaseOriQuota(metered.reservation);

  process.env.ORI_ADMIN_UNLIMITED = "true";
  try {
    const unlimited = acquireOriQuota("quota-admin@example.com");
    assert.equal(unlimited.ok, true);
    assert.equal(unlimited.unlimited, true);
    assert.equal(unlimited.reservation, null);
  } finally {
    delete process.env.ORI_ADMIN_UNLIMITED;
  }
});
