/** Shared Ori Game Plan cache helpers (frontier Pro vs flash-lite). */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function envDays(name, defaultDays) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : defaultDays;
}

function envHours(name, defaultHours) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : defaultHours;
}

/** Pro/frontier Deep Research Game Plan (gemini-3.1-pro) — default 1 week. */
export function gamePlanFrontierTtlMs() {
  return envDays("GAME_PLAN_FRONTIER_TTL_DAYS", 7) * DAY_MS;
}

/** Lite screener intangibles (gemini-3.1-flash-lite) — default 24h. */
export function gamePlanLiteTtlMs() {
  return envHours("GAME_PLAN_LITE_TTL_HOURS", 24) * HOUR_MS;
}

export function isFrontierGamePlan(ori) {
  return ori?.modelTier === "frontier" || ori?.model === "gemini-3.1-pro-preview";
}

/**
 * Read a fresh cached detail entry from memory and/or SQLite kv_cache.
 * @param {object} deps
 * @param {Map} deps.detailCache  in-memory LRU
 * @param {function} deps.kvGet
 * @param {function} [deps.promote]  (key, data, at) => warm memory cache
 */
export function readFreshDetail(key, ttlMs, { detailCache, kvGet, promote }) {
  const mem = detailCache?.get?.(key);
  if (mem && Date.now() - mem.at < ttlMs) return mem.data;

  const persisted = kvGet?.(key);
  if (persisted?.data != null && Date.now() - persisted.updatedAt < ttlMs) {
    promote?.(key, persisted.data, persisted.updatedAt);
    return persisted.data;
  }
  return null;
}

export function readFreshFrontierGamePlan(symbol, deps, ttlMs = gamePlanFrontierTtlMs()) {
  return readFreshDetail(`gameplan:${symbol}`, ttlMs, deps);
}

export function readFreshLiteGamePlan(symbol, deps, ttlMs = gamePlanLiteTtlMs()) {
  return readFreshDetail(`gameplan-lite:${symbol}`, ttlMs, deps);
}

/**
 * Normal DR load: frontier Pro first, lite placeholder only when Pro missing.
 * Explicit refresh=lite is handled separately and never clobbers frontier.
 */
export function resolveCachedGamePlan(symbol, deps, { retry = false } = {}) {
  const frontier = readFreshFrontierGamePlan(symbol, deps);
  if (frontier) {
    return { ori: frontier, tier: frontier.modelTier || "frontier", source: "frontier" };
  }
  if (!retry) {
    const lite = readFreshLiteGamePlan(symbol, deps);
    if (lite) {
      return { ori: lite, tier: "lite", source: "lite" };
    }
  }
  return null;
}