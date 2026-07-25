import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

const tmpDir = mkdtempSync(path.join(tmpdir(), 'orizin-billing-ownership-'));
const previousFetch = globalThis.fetch;
const previousEnv = {
  DB_PATH: process.env.DB_PATH,
  PAYPAL_ENV: process.env.PAYPAL_ENV,
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_SECRET: process.env.PAYPAL_SECRET,
  PAYPAL_PLAN_ID: process.env.PAYPAL_PLAN_ID,
  EMAIL_DISABLED: process.env.EMAIL_DISABLED,
};

process.env.DB_PATH = path.join(tmpDir, 'screener.db');
process.env.PAYPAL_ENV = 'sandbox';
process.env.PAYPAL_CLIENT_ID = 'test-client';
process.env.PAYPAL_SECRET = 'test-secret';
process.env.PAYPAL_PLAN_ID = 'P-TEST';
process.env.EMAIL_DISABLED = 'true';

const subscriptions = new Map();
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/v1/oauth2/token')) {
    return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const prefix = '/v1/billing/subscriptions/';
  const index = String(url).indexOf(prefix);
  if (index >= 0) {
    const id = decodeURIComponent(String(url).slice(index + prefix.length));
    const subscription = subscriptions.get(id);
    return new Response(JSON.stringify(subscription || { name: 'RESOURCE_NOT_FOUND' }), {
      status: subscription ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`Unexpected PayPal test request: ${url}`);
};

const db = await import('../db.js');
const { default: billingRouter, handleWebhookEvent } = await import('../routes/billing.js');

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    req.userId = req.get('x-test-user') || '';
    next();
  });
  app.use('/api', billingRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.default.close();
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

test('activation binds a new subscription only to the checkout owner', async () => {
  const owner = 'checkout-owner@example.com';
  const other = 'other-account@example.com';
  assert.equal(db.createUser(owner, 'strongpass1A', false, owner).success, true);
  assert.equal(db.createUser(other, 'strongpass1A', false, other).success, true);

  const configResponse = await previousFetch(`${base}/api/billing/config`, {
    headers: { 'x-test-user': owner },
  });
  const config = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.ok(config.checkoutToken);

  subscriptions.set('I-OWNER', {
    id: 'I-OWNER',
    plan_id: 'P-TEST',
    status: 'ACTIVE',
    custom_id: config.checkoutToken,
    billing_info: { next_billing_time: '2026-08-17T12:00:00Z' },
  });

  const wrongOwner = await previousFetch(`${base}/api/billing/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': other },
    body: JSON.stringify({ subscriptionID: 'I-OWNER' }),
  });
  assert.equal(wrongOwner.status, 403);
  assert.equal(db.getUserByUsername(other).paypal_subscription_id, null);

  const activate = await previousFetch(`${base}/api/billing/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': owner },
    body: JSON.stringify({ subscriptionID: 'I-OWNER' }),
  });
  assert.equal(activate.status, 200);
  assert.equal(db.getUserByUsername(owner).paypal_subscription_id, 'I-OWNER');
});

test('an activation webhook recovers an unlinked redirect checkout by custom_id', async () => {
  const owner = 'redirect-owner@example.com';
  assert.equal(db.createUser(owner, 'strongpass1A', false, owner).success, true);
  const checkoutToken = db.createBillingCheckoutToken(owner);

  subscriptions.set('I-REDIRECT', {
    id: 'I-REDIRECT',
    plan_id: 'P-TEST',
    status: 'ACTIVE',
    custom_id: checkoutToken,
    billing_info: { next_billing_time: '2026-08-17T12:00:00Z' },
  });

  await handleWebhookEvent({
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resource: { id: 'I-REDIRECT' },
  });

  const updated = db.getUserByUsername(owner);
  assert.equal(updated.paypal_subscription_id, 'I-REDIRECT');
  assert.equal(updated.plan, 'pro');
});

test('payment webhooks resolve billing_agreement_id rather than the sale id', async () => {
  const owner = 'sale-owner@example.com';
  assert.equal(db.createUser(owner, 'strongpass1A', false, owner).success, true);
  const checkoutToken = db.createBillingCheckoutToken(owner);

  subscriptions.set('I-SALE-SUB', {
    id: 'I-SALE-SUB',
    plan_id: 'P-TEST',
    status: 'ACTIVE',
    custom_id: checkoutToken,
    billing_info: { next_billing_time: '2026-08-17T12:00:00Z' },
  });

  await handleWebhookEvent({
    event_type: 'PAYMENT.SALE.COMPLETED',
    resource: { id: 'SALE-TRANSACTION', billing_agreement_id: 'I-SALE-SUB' },
  });

  assert.equal(db.getUserByUsername(owner).paypal_subscription_id, 'I-SALE-SUB');
});
