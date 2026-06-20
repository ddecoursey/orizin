// Provider-agnostic transactional email. No extra dependency — calls the
// provider's HTTP API with fetch. Configure ONE of:
//   RESEND_API_KEY    (https://resend.com)
//   SENDGRID_API_KEY  (https://sendgrid.com)
// plus EMAIL_FROM, e.g. 'Orizin <noreply@yourdomain.com>'.
// If neither key is set, sends are logged and skipped so signup/billing still work.

const FROM = process.env.EMAIL_FROM || 'Orizin <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const APP_URL = process.env.APP_URL || '';

export function emailConfigured() {
  return !!(RESEND_API_KEY || SENDGRID_API_KEY);
}

async function sendViaResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

async function sendViaSendgrid({ to, subject, html, text }) {
  const m = FROM.match(/<([^>]+)>/);
  const fromEmail = m ? m[1] : FROM;
  const fromName = m ? FROM.replace(/<[^>]+>/, '').trim().replace(/"/g, '') : undefined;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
      subject,
      content: [
        ...(text ? [{ type: 'text/plain', value: text }] : []),
        { type: 'text/html', value: html },
      ],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// Resolves (no throw) when unconfigured; throws only on real provider errors.
// Callers should treat email as fire-and-forget and .catch() so it never blocks
// or fails the user's request.
export async function sendEmail({ to, subject, html, text }) {
  if (!to) return { skipped: true };
  try {
    if (RESEND_API_KEY) { await sendViaResend({ to, subject, html, text }); return { ok: true }; }
    if (SENDGRID_API_KEY) { await sendViaSendgrid({ to, subject, html, text }); return { ok: true }; }
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { error: e.message };
  }
  console.log(`[email] (not configured) would send "${subject}" to ${to}`);
  return { skipped: true };
}

// ── Templates ────────────────────────────────────────────────────────────────
function wrap(bodyHtml) {
  const cta = APP_URL
    ? `<p style="margin:24px 0"><a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open Orizin</a></p>`
    : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;color:#1c1917;line-height:1.5">
    <h2 style="color:#4338ca;margin:0 0 16px">Orizin</h2>
    ${bodyHtml}${cta}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#888">Orizin — stock recommendation engine</p>
  </div>`;
}

export function welcomeEmail() {
  return {
    subject: 'Welcome to Orizin',
    text: 'Welcome to Orizin! Your account is ready. Screen stocks, run deep research, and track your portfolio. Upgrade to Pro anytime to unlock Ori, the AI analyst.',
    html: wrap(
      `<p>Welcome aboard! Your Orizin account is ready.</p>
       <p>Screen the market with Orizin Scores, run Deep Research, and track your portfolio, goals and theses. Upgrade to <strong>Pro</strong> anytime to unlock <strong>Ori</strong> — your portfolio-aware AI analyst.</p>`,
    ),
  };
}

export function subscriptionEmail() {
  return {
    subject: "You're now Orizin Pro",
    text: 'Thanks for subscribing to Orizin Pro! Ori, your AI analyst, is now unlocked. You can manage or cancel your subscription anytime in Account Settings.',
    html: wrap(
      `<p>Thanks for subscribing to <strong>Orizin Pro</strong> 🎉</p>
       <p><strong>Ori</strong>, your AI analyst, is now unlocked. Manage or cancel your subscription anytime from Account Settings.</p>`,
    ),
  };
}

function linkButton(url, label) {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>
    <p style="font-size:12px;color:#888;word-break:break-all">Or paste this link into your browser: ${url}</p>`;
}

export function resetPasswordEmail(resetUrl) {
  return {
    subject: 'Reset your Orizin password',
    text: `We received a request to reset your Orizin password. Use this link (valid for 1 hour, single use): ${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
    html: wrap(
      `<p>We received a request to reset your Orizin password.</p>
       ${linkButton(resetUrl, 'Reset password')}
       <p style="font-size:13px;color:#666">This link is valid for <strong>1 hour</strong> and can be used once. If you didn't request a reset, you can safely ignore this email — your password won't change.</p>`,
    ),
  };
}

export function cancelEmail(proUntilMs) {
  const until = proUntilMs ? new Date(proUntilMs).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;
  const line = until
    ? `Your subscription is cancelled and won't renew. You'll keep Pro access until <strong>${until}</strong>, then move to the Free plan.`
    : `Your subscription is cancelled and you've moved to the Free plan.`;
  return {
    subject: 'Your Orizin Pro subscription was cancelled',
    text: until
      ? `Your subscription is cancelled and won't renew. You keep Pro access until ${until}, then move to Free.`
      : `Your subscription is cancelled and you've moved to the Free plan.`,
    html: wrap(`<p>${line}</p><p>You can resubscribe anytime from the app. We'd love to have you back.</p>`),
  };
}

export function watchlistDigestEmail({ items = [], date }) {
  const lines = items.map((a) => {
    const sym = a.symbol || '—';
    if (a.type === 'price') return `<li><strong>${sym}</strong> — ${a.title}</li>`;
    if (a.type === 'conviction') return `<li><strong>${sym}</strong> — ${a.title}</li>`;
    if (a.type === 'news') return `<li><strong>${sym}</strong> — <a href="${a.url}">${a.title}</a></li>`;
    return `<li><strong>${sym}</strong> — ${a.title || a.message}</li>`;
  }).join('');
  const plain = items.map((a) => `${a.symbol}: ${a.title || a.message}`).join('\n');
  return {
    subject: `Orizin watchlist — ${date || 'today'}`,
    text: `Your watchlist digest:\n\n${plain}`,
    html: wrap(
      `<p>Here's what moved on your watchlist:</p><ul style="padding-left:18px;line-height:1.6">${lines}</ul>
       <p style="font-size:12px;color:#666">You're receiving this because watchlist email digests are enabled in Account settings.</p>`,
    ),
  };
}

export function watchlistUrgentEmail({ symbol, movePct, price }) {
  const dir = movePct >= 0 ? 'up' : 'down';
  const px = price != null ? `$${Number(price).toFixed(2)}` : '—';
  return {
    subject: `Urgent: ${symbol} ${dir} ${Math.abs(movePct).toFixed(1)}%`,
    text: `${symbol} is ${dir} ${Math.abs(movePct).toFixed(1)}% vs today's session baseline. Last price: ${px}.`,
    html: wrap(
      `<p><strong>${symbol}</strong> moved <strong>${dir} ${Math.abs(movePct).toFixed(1)}%</strong> vs today's session open.</p>
       <p>Last price: <strong>${px}</strong></p>
       <p style="font-size:12px;color:#666">Large-move instant alerts can be turned off in Account settings.</p>`,
    ),
  };
}

export function deletedAccountEmail() {
  return {
    subject: 'Your Orizin account was deleted',
    text: "Your Orizin account and all associated data have been permanently deleted, and any active subscription was cancelled so you won't be billed again. We're sorry to see you go — you can create a new account anytime.",
    html: wrap(
      `<p>Your Orizin account and all associated data have been <strong>permanently deleted</strong>.</p>
       <p>Any active subscription was cancelled, so you won't be billed again. We're sorry to see you go — you're welcome back anytime.</p>
       <p style="font-size:12px;color:#888">If you didn't request this, contact us right away at support@orizin.app.</p>`,
    ),
  };
}
