import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "orizin-upstream-timeouts-"));
const previousFetch = globalThis.fetch;
const envKeys = [
  "DB_PATH",
  "NODE_ENV",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_VOLUME_MOUNT_PATH",
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_SECRET",
  "PAYPAL_PLAN_ID",
  "PAYPAL_HTTP_TIMEOUT_MS",
  "RESEND_API_KEY",
  "SENDGRID_API_KEY",
  "EMAIL_DISABLED",
  "EMAIL_HTTP_TIMEOUT_MS",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Object.assign(process.env, {
  DB_PATH: path.join(tmpDir, "screener.db"),
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT: "",
  RAILWAY_VOLUME_MOUNT_PATH: "",
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "test-client",
  PAYPAL_SECRET: "test-secret",
  PAYPAL_PLAN_ID: "P-TEST",
  PAYPAL_HTTP_TIMEOUT_MS: "1000",
  RESEND_API_KEY: "test-resend-key",
  SENDGRID_API_KEY: "",
  EMAIL_DISABLED: "false",
  EMAIL_HTTP_TIMEOUT_MS: "1000",
});

const requests = [];
let hangRequests = false;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), signal: options.signal });
  if (hangRequests) {
    return new Promise((_, reject) => {
      // A real open HTTP socket keeps Node alive. Mirror that here because the
      // internal timer used by AbortSignal.timeout() is intentionally unref'ed.
      const socketGuard = setTimeout(() => reject(new Error("mock socket never aborted")), 5_000);
      const abort = () => {
        clearTimeout(socketGuard);
        reject(options.signal?.reason || new Error("request aborted"));
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  }
  if (String(url).endsWith("/v1/oauth2/token")) {
    return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (String(url).includes("/v1/billing/subscriptions/")) {
    return new Response(JSON.stringify({ id: "I-TEST", status: "ACTIVE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (String(url) === "https://api.resend.com/emails") return new Response(null, { status: 200 });
  throw new Error(`Unexpected request: ${url}`);
};

const db = await import("../db.js");
const paypal = await import(`../paypal.js?timeouts=${Date.now()}`);
const email = await import(`../email.js?timeouts=${Date.now()}`);

after(() => {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { db.default.close(); } catch { /* already closed */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

test("PayPal and email requests carry bounded abort signals", async () => {
  assert.equal(paypal.paypalHttpTimeoutMs(), 1000);
  assert.equal(email.emailHttpTimeoutMs(), 1000);

  await paypal.getSubscription("I-TEST");
  const sent = await email.sendEmail({
    to: "recipient@example.com",
    subject: "Timeout test",
    html: "<p>test</p>",
    priority: "critical",
  });
  assert.equal(sent.ok, true);

  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.signal.aborted, false);
  }
});

test("PayPal and email abort a provider that never responds", async () => {
  const requestStart = requests.length;
  const startedAt = Date.now();
  hangRequests = true;
  try {
    const [paypalResult, emailResult] = await Promise.all([
      paypal.getSubscription("I-HANG").then(
        () => ({ ok: true }),
        (error) => ({ error }),
      ),
      email.sendEmail({
        to: "recipient@example.com",
        subject: "Hanging provider test",
        html: "<p>test</p>",
        priority: "critical",
      }),
    ]);

    assert.equal(paypalResult.error?.name, "TimeoutError");
    assert.match(emailResult.error || "", /aborted|timeout/i);
    assert.ok(Date.now() - startedAt >= 800, "deadline fired implausibly early");
    assert.ok(Date.now() - startedAt < 3000, "provider calls remained open past their deadline");

    const hangingRequests = requests.slice(requestStart);
    assert.ok(hangingRequests.length >= 2);
    assert.ok(hangingRequests.every((request) => request.signal?.aborted));
  } finally {
    hangRequests = false;
  }
});

test("invalid timeout overrides fall back to safe defaults", () => {
  assert.equal(paypal.paypalHttpTimeoutMs({ PAYPAL_HTTP_TIMEOUT_MS: "0" }), 15000);
  assert.equal(email.emailHttpTimeoutMs({ EMAIL_HTTP_TIMEOUT_MS: "999999" }), 10000);
});
