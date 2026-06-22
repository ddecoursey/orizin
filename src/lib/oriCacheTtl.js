// Client-side Ori cache TTL defaults — keep aligned with server/gamePlanCache.js env fallbacks.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const ORI_FRONTIER_TTL_MS = 7 * DAY_MS;
export const ORI_LITE_TTL_MS = 24 * HOUR_MS;

export function isFreshOriCache(cachedAt, ttlMs, now = Date.now()) {
  return Number.isFinite(cachedAt) && now - cachedAt < ttlMs;
}