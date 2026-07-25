import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as db from '../db.js';
import * as paypal from '../paypal.js';
import { sendEmail, subscriptionEmail, cancelEmail } from '../email.js';
import { emailForNotifications } from '../userProfile.js';
import { cancelLinkedSubscription, cancellationErrorResponse } from '../subscriptionLifecycle.js';

const router = Router();

// Generous limiters — well above legitimate use, but cap abuse. Webhook traffic
// is from PayPal (low volume); activate/cancel are user-initiated (rare) and each
// makes a PayPal API call. Real client IPs resolve via the app's `trust proxy`.
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const actionLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// PayPal statuses that count as "subscribed → Pro".
const ACTIVE = new Set(['ACTIVE', 'APPROVED']);
const REPLACEABLE_SUBSCRIPTION_STATUSES = new Set(['', 'CANCELLED', 'EXPIRED']);
const SYNC_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'PAYMENT.SALE.COMPLETED',
]);
function toMs(t) {
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function canReplaceSubscription(user, nextSubscriptionId) {
  if (!user?.paypal_subscription_id || user.paypal_subscription_id === nextSubscriptionId) return true;
  return REPLACEABLE_SUBSCRIPTION_STATUSES.has(
    String(user.subscription_status || '').toUpperCase(),
  );
}

// GET /api/billing/config — safe browser config plus a per-user ownership token.
router.get('/billing/config', actionLimiter, (req, res) => {
  const config = paypal.publicConfig();
  if (!config.configured) return res.json(config);
  try {
    return res.json({ ...config, checkoutToken: db.createBillingCheckoutToken(req.userId) });
  } catch (error) {
    console.error('[billing] checkout token creation failed:', error.message);
    return res.status(500).json({ error: 'Could not initialize a secure checkout' });
  }
});

// GET /api/billing/status — the current user's subscription/plan state.
router.get('/billing/status', (req, res) => {
  const user = db.reconcileUserPlan(req.userId) || db.getUserByUsername(req.userId);
  if (!user) return res.json({ plan: 'free', status: null, subscriptionId: null, proUntil: null });
  res.json({
    plan: db.normalizePlan(user.plan),
    status: user.subscription_status || null,
    subscriptionId: user.paypal_subscription_id || null,
    proUntil: user.pro_until || null,
  });
});

// POST /api/billing/activate — verify a client-approved subscription with PayPal
// (never trust the client), then attach it and grant Pro. pro_until is set from
// PayPal's next_billing_time so we always know the paid-through date.
router.post('/billing/activate', actionLimiter, async (req, res) => {
  if (!paypal.isConfigured()) return res.status(503).json({ error: 'Billing is not configured' });

  const subscriptionId = String(req.body?.subscriptionID || req.body?.subscriptionId || '').trim();
  if (!subscriptionId) return res.status(400).json({ error: 'Missing subscription id' });

  let sub;
  try {
    sub = await paypal.getSubscription(subscriptionId);
  } catch (e) {
    console.error('[billing] getSubscription failed:', e.message);
    return res.status(502).json({ error: 'Could not verify the subscription with PayPal' });
  }

  if (paypal.expectedPlanId() && sub.plan_id !== paypal.expectedPlanId()) {
    return res.status(400).json({ error: 'Subscription is for a different plan' });
  }
  if (!ACTIVE.has(String(sub.status || '').toUpperCase())) {
    return res.status(400).json({ error: `Subscription is not active (status: ${sub.status})` });
  }

  const existing = db.getUserBySubscriptionId(subscriptionId);
  if (existing && existing.username !== req.userId) {
    return res.status(409).json({ error: 'This subscription is already linked to another account' });
  }

  const currentUser = db.getUserByUsername(req.userId);
  if (!currentUser) return res.status(404).json({ error: 'User not found' });
  if (!canReplaceSubscription(currentUser, subscriptionId)) {
    return res.status(409).json({ error: 'Cancel the existing subscription before linking another one' });
  }

  // Existing links have already established ownership. Every new link must carry
  // the opaque custom_id issued to this signed-in user before checkout started.
  if (!existing) {
    const checkoutOwner = db.getUserByBillingCheckoutToken(sub.custom_id);
    if (!checkoutOwner || checkoutOwner.username !== req.userId) {
      return res.status(403).json({
        error: 'This checkout does not belong to the signed-in account',
        code: 'checkout_owner_mismatch',
      });
    }
  }

  try {
    db.setUserSubscription(req.userId, {
      subscriptionId,
      status: sub.status,
      proUntil: toMs(sub?.billing_info?.next_billing_time),
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'This subscription is already linked to another account' });
    }
    console.error('[billing] subscription activation write failed:', error.message);
    return res.status(500).json({ error: 'Could not activate the subscription' });
  }

  const updated = db.getUserByUsername(req.userId);
  const to = emailForNotifications(updated);
  if (to) sendEmail({ to, ...subscriptionEmail(), priority: 'critical' }).catch(() => {});

  res.json({ ok: true, plan: db.normalizePlan(updated?.plan), status: sub.status, proUntil: updated?.pro_until || null });
});

// POST /api/billing/cancel — stop the recurring PayPal billing, but KEEP Pro
// until the end of the already-paid period (pro_until). A periodic sweep / lazy
// reconcile downgrades to Free once that date passes.
router.post('/billing/cancel', actionLimiter, async (req, res) => {
  const user = db.getUserByUsername(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.paypal_subscription_id) {
    return res.status(400).json({ error: 'No linked subscription was found' });
  }

  let cancellation;
  try {
    cancellation = await cancelLinkedSubscription(user);
  } catch (error) {
    console.error('[billing] cancellation failed:', error.cause?.message || error.message);
    const failure = cancellationErrorResponse(error);
    return res.status(failure.status).json(failure.body);
  }

  db.setUserSubscription(req.userId, {
    subscriptionId: cancellation.subscriptionId,
    status: 'CANCELLED',
    proUntil: cancellation.proUntil,
  });
  const updated = db.getUserByUsername(req.userId);

  const to = emailForNotifications(updated);
  if (to) sendEmail({ to, ...cancelEmail(updated?.pro_until), priority: 'critical' }).catch(() => {});

  res.json({
    ok: true,
    plan: db.normalizePlan(updated?.plan),
    status: 'CANCELLED',
    proUntil: updated?.pro_until || null,
  });
});

// POST /api/billing/webhook — PayPal calls this server-to-server (UNAUTHENTICATED;
// exempted from the session gate in index.js). Signature-verified, then synced.
router.post('/billing/webhook', webhookLimiter, async (req, res) => {
  const event = req.body || {};
  const verified = await paypal.verifyWebhookSignature(req.headers, event);
  if (!verified) return res.status(400).json({ error: 'Webhook signature verification failed' });
  try {
    await handleWebhookEvent(event);
  } catch (e) {
    console.error('[billing] webhook handling error:', e.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
  res.json({ ok: true });
});

export async function handleWebhookEvent(event) {
  const type = event?.event_type || '';
  const resource = event?.resource || {};
  const subId = type === 'PAYMENT.SALE.COMPLETED'
    ? resource.billing_agreement_id
    : resource.id || resource.billing_agreement_id;
  if (!subId) return;

  let user = db.getUserBySubscriptionId(subId);

  if (SYNC_EVENTS.has(type)) {
    // Always refresh from PayPal. This verifies the plan, finds custom_id for an
    // unlinked redirect checkout, and keeps the paid-through date current.
    const sub = await paypal.getSubscription(subId);
    if (paypal.expectedPlanId() && sub.plan_id !== paypal.expectedPlanId()) {
      console.warn('[billing] ignored webhook for an unexpected PayPal plan');
      return;
    }

    if (!user) {
      const checkoutOwner = db.getUserByBillingCheckoutToken(sub.custom_id || resource.custom_id);
      if (!checkoutOwner || !ACTIVE.has(String(sub.status || '').toUpperCase())) return;
      if (!canReplaceSubscription(checkoutOwner, subId)) {
        throw new Error('Checkout owner already has a different non-terminal subscription');
      }
      user = checkoutOwner;
    }

    db.setUserSubscription(user.username, {
      subscriptionId: subId,
      status: sub.status || 'ACTIVE',
      proUntil: toMs(sub?.billing_info?.next_billing_time),
    });
  } else if (
    type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
    type === 'BILLING.SUBSCRIPTION.SUSPENDED'
  ) {
    if (!user) return;
    // Keep the grace: status changes, pro_until (period end) is preserved.
    const status = type.split('.').pop(); // CANCELLED | SUSPENDED
    db.setUserSubscription(user.username, { subscriptionId: subId, status });
  } else if (type === 'BILLING.SUBSCRIPTION.EXPIRED') {
    if (!user) return;
    // The subscription is genuinely over → Free now.
    db.setUserSubscription(user.username, { subscriptionId: subId, status: 'EXPIRED', proUntil: null });
  }
}

export default router;
