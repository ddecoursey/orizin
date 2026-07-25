import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const previousFetch = globalThis.fetch;
const previousEnv = {
  PAYPAL_ENV: process.env.PAYPAL_ENV,
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_SECRET: process.env.PAYPAL_SECRET,
  PAYPAL_PLAN_ID: process.env.PAYPAL_PLAN_ID,
};

process.env.PAYPAL_ENV = 'sandbox';
process.env.PAYPAL_CLIENT_ID = 'test-client';
process.env.PAYPAL_SECRET = 'test-secret';
process.env.PAYPAL_PLAN_ID = 'P-TEST';

let subscriptionStatus = 'ACTIVE';
globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith('/v1/oauth2/token')) {
    return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (String(url).endsWith('/cancel') && options.method === 'POST') {
    return new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (String(url).includes('/v1/billing/subscriptions/I-STRICT')) {
    return new Response(JSON.stringify({ id: 'I-STRICT', status: subscriptionStatus }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`Unexpected PayPal test request: ${options.method || 'GET'} ${url}`);
};

const paypal = await import(`../paypal.js?strict-cancellation=${Date.now()}`);

after(() => {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('PayPal 422 is not accepted while the subscription remains active', async () => {
  await assert.rejects(
    paypal.cancelSubscription('I-STRICT'),
    /subscription remains ACTIVE/,
  );
});

test('PayPal 422 is accepted only after terminal status is verified', async () => {
  subscriptionStatus = 'CANCELLED';
  const result = await paypal.cancelSubscription('I-STRICT');
  assert.deepEqual(result, { ok: true, alreadyInactive: true });
});
