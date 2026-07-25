import { test } from "node:test";
import assert from "node:assert/strict";
import { productionConfigurationErrors } from "../productionConfig.js";

const validLive = {
  NODE_ENV: "production",
  APP_ENV: "production",
  APP_URL: "https://orizin.io",
  AUTH_SECRET: "a".repeat(64),
  PAYPAL_ENV: "live",
  PAYPAL_CLIENT_ID: "client-id",
  PAYPAL_SECRET: "secret",
  PAYPAL_PLAN_ID: "P-PLAN",
  PAYPAL_WEBHOOK_ID: "WH-ID",
};

test("complete live configuration passes launch validation", () => {
  assert.deepEqual(productionConfigurationErrors(validLive), []);
});

test("live configuration fails closed for weak auth, unsafe URL, and missing PayPal values", () => {
  const errors = productionConfigurationErrors({
    ...validLive,
    AUTH_SECRET: "short",
    APP_URL: "http://orizin.io/reset",
    PAYPAL_SECRET: "",
    PAYPAL_WEBHOOK_ID: "",
  });
  assert.ok(errors.some((error) => error.startsWith("AUTH_SECRET")));
  assert.ok(errors.some((error) => error.startsWith("APP_URL")));
  assert.ok(errors.some((error) => error.startsWith("PAYPAL_SECRET")));
  assert.ok(errors.some((error) => error.startsWith("PAYPAL_WEBHOOK_ID")));
});

test("local development does not require production-only configuration", () => {
  assert.deepEqual(productionConfigurationErrors({ NODE_ENV: "development" }), []);
});
