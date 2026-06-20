// Shared watchlist alert defaults + sanitization (client settings + server).

export const DEFAULT_WATCHLIST_ALERTS = {
  enabled: true,
  emailDigest: true,
  emailInstant: true,
  inApp: true,
  priceThresholdPct: 5,
  instantThresholdPct: 8,
};

export function sanitizeWatchlistAlerts(raw) {
  const out = { ...DEFAULT_WATCHLIST_ALERTS };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.emailDigest === 'boolean') out.emailDigest = raw.emailDigest;
  if (typeof raw.emailInstant === 'boolean') out.emailInstant = raw.emailInstant;
  if (typeof raw.inApp === 'boolean') out.inApp = raw.inApp;
  const price = Number(raw.priceThresholdPct);
  if (Number.isFinite(price)) out.priceThresholdPct = Math.max(3, Math.min(15, price));
  const instant = Number(raw.instantThresholdPct);
  if (Number.isFinite(instant)) out.instantThresholdPct = Math.max(5, Math.min(20, instant));
  return out;
}