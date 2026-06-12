// PayPal REST client for subscriptions. Works against sandbox or live based on
// PAYPAL_ENV. All credentials come from environment variables ONLY — never
// hardcode secrets here (see .env.example). Node 18+ global fetch is used.
//
// Required env:
//   PAYPAL_ENV         'sandbox' (default) | 'live'
//   PAYPAL_CLIENT_ID   OAuth client id (also public — used by the browser SDK)
//   PAYPAL_SECRET      OAuth secret (server only — keep out of the repo)
//   PAYPAL_PLAN_ID     the subscription plan id (P-XXXX) buyers subscribe to
//   PAYPAL_WEBHOOK_ID  the webhook id from the PayPal dashboard (for verifying
//                      incoming webhook signatures). Optional locally.

const ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
const IS_LIVE = ENV === 'live';
const API_BASE = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const SECRET = process.env.PAYPAL_SECRET || '';
const PLAN_ID = process.env.PAYPAL_PLAN_ID || '';
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

export function paypalEnv() {
  return IS_LIVE ? 'live' : 'sandbox';
}

// Configured enough to run a checkout (client + secret + plan).
export function isConfigured() {
  return !!(CLIENT_ID && SECRET && PLAN_ID);
}

export function expectedPlanId() {
  return PLAN_ID;
}

// Safe to expose to the browser: client id and plan id are not secrets (the
// client id is embedded in the SDK URL; the plan id identifies a public plan).
export function publicConfig() {
  return { configured: isConfigured(), env: paypalEnv(), clientId: CLIENT_ID, planId: PLAN_ID };
}

// ── OAuth token (client-credentials), cached until shortly before expiry ──────
let cachedToken = null; // { token, exp }

async function getAccessToken() {
  if (!CLIENT_ID || !SECRET) throw new Error('PayPal not configured (missing client id / secret)');
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;

  const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`PayPal token error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3000) * 1000 };
  return cachedToken.token;
}

async function papi(path, { method = 'GET', body, headers } = {}) {
  const token = await getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// Fetch the full subscription object (status, plan_id, subscriber, billing_info).
export async function getSubscription(subscriptionId) {
  const res = await papi(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`PayPal getSubscription ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

// Cancel a subscription. 204 = cancelled; 422 = already inactive (treat as done).
export async function cancelSubscription(subscriptionId, reason = 'Customer cancelled from Orizin') {
  const res = await papi(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    body: { reason },
  });
  if (res.status === 204) return { ok: true };
  if (res.status === 422) return { ok: true, alreadyInactive: true };
  const t = await res.text().catch(() => '');
  throw new Error(`PayPal cancel ${res.status}: ${t.slice(0, 200)}`);
}

// Verify a webhook came from PayPal using the dashboard webhook id. Without a
// configured PAYPAL_WEBHOOK_ID we cannot verify, so we reject (fail closed).
export async function verifyWebhookSignature(headers, event) {
  if (!WEBHOOK_ID) return false;

  const authAlgo = headers['paypal-auth-algo'];
  const certUrl = headers['paypal-cert-url'];
  const transmissionId = headers['paypal-transmission-id'];
  const transmissionSig = headers['paypal-transmission-sig'];
  const transmissionTime = headers['paypal-transmission-time'];

  // Cheap rejects BEFORE spending a PayPal API call: real events always carry
  // all five signature headers, and the cert must live on a paypal.com host.
  // This stops trivial junk POSTs from draining our PayPal API quota.
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return false;
  try {
    const host = new URL(certUrl).hostname.toLowerCase();
    if (host !== 'paypal.com' && !host.endsWith('.paypal.com')) return false;
  } catch {
    return false;
  }

  const body = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: WEBHOOK_ID,
    webhook_event: event,
  };
  try {
    const res = await papi('/v1/notifications/verify-webhook-signature', { method: 'POST', body });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return data.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
