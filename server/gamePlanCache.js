/** Shared 24h Ori Game Plan cache helpers (frontier Pro vs flash/lite). */

export const GAME_PLAN_TTL_MS = 24 * 60 * 60 * 1000;

export function isFrontierGamePlan(ori) {
  return ori?.modelTier === 'frontier' || ori?.model === 'gemini-3.1-pro-preview';
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

export function readFreshFrontierGamePlan(symbol, deps, ttlMs = GAME_PLAN_TTL_MS) {
  return readFreshDetail(`gameplan:${symbol}`, ttlMs, deps);
}

export function readFreshLiteGamePlan(symbol, deps, ttlMs = GAME_PLAN_TTL_MS) {
  return readFreshDetail(`gameplan-lite:${symbol}`, ttlMs, deps);
}

/**
 * Normal DR load: frontier Pro first, lite placeholder only when Pro missing.
 * Explicit refresh=lite is handled separately and never clobbers frontier.
 */
export function resolveCachedGamePlan(symbol, deps, { retry = false } = {}) {
  const frontier = readFreshFrontierGamePlan(symbol, deps);
  if (frontier) {
    return { ori: frontier, tier: frontier.modelTier || 'frontier', source: 'frontier' };
  }
  if (!retry) {
    const lite = readFreshLiteGamePlan(symbol, deps);
    if (lite) {
      return { ori: lite, tier: 'lite', source: 'lite' };
    }
  }
  return null;
}