import { Router } from 'express';
import * as db from '../db.js';
import * as paypal from '../paypal.js';
import { sendEmail, subscriptionEmail, cancelEmail } from '../email.js';

const router = Router();

// PayPal statuses that count as "subscribed → Pro".
const ACTIVE = new Set(['ACTIVE', 'APPROVED']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toMs(t) {
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
function emailFor(user) {
  if (!user) return null;
  if (user.email && EMAIL_RE.test(user.email)) return user.email;
  if (user.username && EMAIL_RE.test(user.username)) return user.username;
  return null;
}

// GET /api/billing/config — public config for the browser PayPal SDK.
router.get('/billing/config', (req, res) => {
  res.json(paypal.publicConfig());
});

// GET /api/billing/status — the current user's subscription/plan state.
router.get('/billing/status', (req, res) => {
  const user = db.reconcileUserPlan(req.userId) || db.getUserByUsername(req.userId);
  if (!user) return res.json({ plan: 'free', status: null, subscriptionId: null, proUntil: null });
  res.json({
    plan: user.plan === 'pro' ? 'pro' : 'free',
    status: user.subscription_status || null,
    subscriptionId: user.paypal_subscription_id || null,
    proUntil: user.pro_until || null,
  });
});

// POST /api/billing/activate — verify a client-approved subscription with PayPal
// (never trust the client), then attach it and grant Pro. pro_until is set from
// PayPal's next_billing_time so we always know the paid-through date.
router.post('/billing/activate', async (req, res) => {
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

  db.setUserSubscription(req.userId, {
    subscriptionId,
    status: sub.status,
    proUntil: toMs(sub?.billing_info?.next_billing_time),
  });

  const updated = db.getUserByUsername(req.userId);
  const to = emailFor(updated);
  if (to) sendEmail({ to, ...subscriptionEmail() }).catch(() => {});

  res.json({ ok: true, plan: 'pro', status: sub.status, proUntil: updated?.pro_until || null });
});

// POST /api/billing/cancel — stop the recurring PayPal billing, but KEEP Pro
// until the end of the already-paid period (pro_until). A periodic sweep / lazy
// reconcile downgrades to Free once that date passes.
router.post('/billing/cancel', async (req, res) => {
  const user = db.getUserByUsername(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const subId = user.paypal_subscription_id;
  let proUntil; // undefined → keep the existing pro_until (the known period end)

  if (subId && paypal.isConfigured()) {
    // Read the paid-through date BEFORE cancelling (PayPal clears it after).
    try {
      const sub = await paypal.getSubscription(subId);
      const ms = toMs(sub?.billing_info?.next_billing_time);
      if (ms) proUntil = ms;
    } catch (e) {
      console.error('[billing] cancel: getSubscription failed:', e.message);
    }
    // Stop future charges. Downgrade-with-grace happens locally regardless.
    try {
      await paypal.cancelSubscription(subId);
    } catch (e) {
      console.error('[billing] cancel: PayPal cancel failed (continuing):', e.message);
    }
  }

  db.setUserSubscription(req.userId, { subscriptionId: subId || null, status: 'CANCELLED', proUntil });
  const updated = db.getUserByUsername(req.userId);

  const to = emailFor(updated);
  if (to) sendEmail({ to, ...cancelEmail(updated?.pro_until) }).catch(() => {});

  res.json({
    ok: true,
    plan: updated?.plan === 'pro' ? 'pro' : 'free',
    status: 'CANCELLED',
    proUntil: updated?.pro_until || null,
  });
});

// POST /api/billing/webhook — PayPal calls this server-to-server (UNAUTHENTICATED;
// exempted from the session gate in index.js). Signature-verified, then synced.
router.post('/billing/webhook', async (req, res) => {
  const event = req.body || {};
  const verified = await paypal.verifyWebhookSignature(req.headers, event);
  if (!verified) return res.status(400).json({ error: 'Webhook signature verification failed' });
  try {
    await handleWebhookEvent(event);
  } catch (e) {
    console.error('[billing] webhook handling error:', e.message);
  }
  res.json({ ok: true });
});

async function handleWebhookEvent(event) {
  const type = event?.event_type || '';
  const resource = event?.resource || {};
  const subId = resource.id || resource.billing_agreement_id;
  if (!subId) return;

  const user = db.getUserBySubscriptionId(subId);
  if (!user) return; // not one of ours (or not linked yet)

  if (
    type === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
    type === 'BILLING.SUBSCRIPTION.RE-ACTIVATED' ||
    type === 'BILLING.SUBSCRIPTION.UPDATED' ||
    type === 'PAYMENT.SALE.COMPLETED'
  ) {
    // Refresh from the source of truth so pro_until tracks each renewal.
    let status = 'ACTIVE';
    let proUntil;
    try {
      const sub = await paypal.getSubscription(subId);
      status = sub.status || 'ACTIVE';
      proUntil = toMs(sub?.billing_info?.next_billing_time);
    } catch (e) {
      console.error('[billing] webhook getSubscription failed:', e.message);
    }
    db.setUserSubscription(user.username, { subscriptionId: subId, status, proUntil });
  } else if (
    type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
    type === 'BILLING.SUBSCRIPTION.SUSPENDED'
  ) {
    // Keep the grace: status changes, pro_until (period end) is preserved.
    const status = type.split('.').pop(); // CANCELLED | SUSPENDED
    db.setUserSubscription(user.username, { subscriptionId: subId, status });
  } else if (type === 'BILLING.SUBSCRIPTION.EXPIRED') {
    // The subscription is genuinely over → Free now.
    db.setUserSubscription(user.username, { subscriptionId: subId, status: 'EXPIRED', proUntil: null });
  }
}

export default router;
