import * as paypal from './paypal.js';

export class SubscriptionCancellationError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = 'SubscriptionCancellationError';
    this.code = code;
    this.status = status;
  }
}

function paidThroughMs(subscription) {
  const value = subscription?.billing_info?.next_billing_time;
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Cancel a user's linked PayPal subscription before mutating local state.
 * Failure is deliberately fatal to the caller: reporting a local cancellation
 * or deleting the account while PayPal can still charge would orphan billing.
 */
export async function cancelLinkedSubscription(
  user,
  { client = paypal, logger = console } = {},
) {
  const subscriptionId = String(user?.paypal_subscription_id || '').trim();
  if (!subscriptionId) {
    return { subscriptionId: null, proUntil: undefined, skipped: true };
  }

  if (!client.isConfigured()) {
    throw new SubscriptionCancellationError(
      'billing_not_configured',
      'Billing is temporarily unavailable. The subscription was not changed.',
      { status: 503 },
    );
  }

  let proUntil;
  try {
    proUntil = paidThroughMs(await client.getSubscription(subscriptionId));
  } catch (error) {
    // The paid-through lookup is best effort. Cancellation itself remains the
    // authoritative operation and must still be attempted.
    logger?.error?.('[billing] paid-through lookup before cancellation failed:', error.message);
  }

  try {
    await client.cancelSubscription(subscriptionId);
  } catch (cause) {
    throw new SubscriptionCancellationError(
      'paypal_cancel_failed',
      'PayPal could not confirm the cancellation. Nothing was changed; please try again.',
      { status: 502, cause },
    );
  }

  return { subscriptionId, proUntil, skipped: false };
}

export function cancellationErrorResponse(error) {
  if (error instanceof SubscriptionCancellationError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  return {
    status: 502,
    body: {
      error: 'PayPal could not confirm the cancellation. Nothing was changed; please try again.',
      code: 'paypal_cancel_failed',
    },
  };
}
