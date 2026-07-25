import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelLinkedSubscription,
  SubscriptionCancellationError,
} from '../subscriptionLifecycle.js';

const USER = { username: 'buyer@example.com', paypal_subscription_id: 'I-TEST123' };

test('cancellation skips PayPal only when no subscription is linked', async () => {
  const result = await cancelLinkedSubscription(
    { username: USER.username, paypal_subscription_id: null },
    { client: null, logger: null },
  );
  assert.deepEqual(result, { subscriptionId: null, proUntil: undefined, skipped: true });
});

test('cancellation fails closed when PayPal is not configured', async () => {
  await assert.rejects(
    cancelLinkedSubscription(USER, {
      client: { isConfigured: () => false },
      logger: null,
    }),
    (error) => {
      assert.ok(error instanceof SubscriptionCancellationError);
      assert.equal(error.code, 'billing_not_configured');
      assert.equal(error.status, 503);
      return true;
    },
  );
});

test('cancellation preserves paid-through date after PayPal confirms', async () => {
  const nextBilling = '2026-08-17T12:00:00Z';
  let cancelledId = null;
  const result = await cancelLinkedSubscription(USER, {
    logger: null,
    client: {
      isConfigured: () => true,
      getSubscription: async () => ({ billing_info: { next_billing_time: nextBilling } }),
      cancelSubscription: async (id) => { cancelledId = id; },
    },
  });

  assert.equal(cancelledId, USER.paypal_subscription_id);
  assert.equal(result.subscriptionId, USER.paypal_subscription_id);
  assert.equal(result.proUntil, Date.parse(nextBilling));
  assert.equal(result.skipped, false);
});

test('cancellation never reports success when PayPal cancellation fails', async () => {
  await assert.rejects(
    cancelLinkedSubscription(USER, {
      logger: null,
      client: {
        isConfigured: () => true,
        getSubscription: async () => { throw new Error('lookup unavailable'); },
        cancelSubscription: async () => { throw new Error('PayPal unavailable'); },
      },
    }),
    (error) => {
      assert.ok(error instanceof SubscriptionCancellationError);
      assert.equal(error.code, 'paypal_cancel_failed');
      assert.equal(error.status, 502);
      return true;
    },
  );
});
