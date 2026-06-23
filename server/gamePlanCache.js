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

function envInt(name, defaultValue) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

/**
 * Output-token cap for a Game Plan generation. On Gemini 3.x, thinking tokens are
 * billed AGAINST this same budget, so it must leave room for BOTH the model's
 * thinking (the Game Plan runs at ~medium) AND the rich 15-field JSON. If it's too
 * tight, thinking eats the budget, the JSON truncates (finishReason MAX_TOKENS),
 * and geminiJson's runLadder throws bad_json — a HARD, already-billed failure,
 * since malformed JSON does not fail over to the next model. Default 4000 (≈2× the
 * old 2000) leaves comfortable headroom; tune via GAME_PLAN_MAX_OUTPUT.
 */
export function gamePlanMaxOutputTokens() {
  return envInt("GAME_PLAN_MAX_OUTPUT", 4000);
}

/** Pro/frontier Deep Research Game Plan (gemini-3.1-pro) — default 1 week. */
export function gamePlanFrontierTtlMs() {
  return envDays("GAME_PLAN_FRONTIER_TTL_DAYS", 7) * DAY_MS;
}

/** Lite screener intangibles (gemini-3.1-flash-lite) — default 24h. */
export function gamePlanLiteTtlMs() {
  return envHours("GAME_PLAN_LITE_TTL_HOURS", 24) * HOUR_MS;
}

/**
 * Lifetime of a BACKGROUND screener intangibles (lite) review — deliberately LONG
 * (default 30 days) and separate from gamePlanLiteTtlMs(). The hourly trickle sweeps
 * the WHOLE universe top-down by market cap, skipping any name that already carries a
 * review, so once a stock is scored its nudge should persist (kept on the row AND
 * skipped by the trickle) for weeks rather than expiring in a day and forcing a
 * re-spend before the trickle has even reached the rest of the universe. Intangibles
 * (moat / TAM / management / brand / sentiment) are slow-moving, so a multi-week read
 * is fine. Tune via SCREENER_INTANGIBLES_TTL_DAYS. NOTE: gamePlanLiteTtlMs() (24h) is
 * still used for the frontier self-heal window in readFreshFrontierGamePlan — don't
 * conflate the two.
 */
export function screenerLiteTtlMs() {
  return envDays("SCREENER_INTANGIBLES_TTL_DAYS", 30) * DAY_MS;
}

/**
 * Market-cap floor for the background intangibles trickle (default $10B). The job
 * only ever spends a lite call on names AT/ABOVE this cap — so the swept set is
 * small, bounded and made of the large-caps users actually screen, instead of
 * grinding through ~10k micro-caps. Below the floor, a stock only gets an Ori read
 * if a user opens Deep Research on it (user-initiated, metered). Tune via
 * SCREENER_INTANGIBLES_MIN_MCAP (raw dollars, e.g. 10000000000).
 */
export function screenerMinMcap() {
  const n = Number(process.env.SCREENER_INTANGIBLES_MIN_MCAP);
  return Number.isFinite(n) && n >= 0 ? n : 10e9;
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

// Tier-aware freshness. A real frontier (Pro) take is authoritative for the full
// frontier TTL (~7d). A SUB-frontier take only lands under this key because the
// frontier model was busy at first-open; pinning it for a week would serve a
// degraded "Pro" review (and feed the shared screener intangibles) the whole time
// with no upgrade path. So treat a non-frontier entry as fresh for just the lite
// window (~24h) — the next open then re-attempts frontier and it self-heals. An
// explicit ttlMs (callers/tests) overrides and keeps the old single-TTL behavior.
export function readFreshFrontierGamePlan(symbol, deps, ttlMs) {
  const key = `gameplan:${symbol}`;
  if (ttlMs != null) return readFreshDetail(key, ttlMs, deps);
  const data = readFreshDetail(key, gamePlanFrontierTtlMs(), deps);
  if (!data) return null;
  if (isFrontierGamePlan(data)) return data; // real Pro take — fresh for the full ~7d
  // Sub-frontier (value/lite) take: only honor it for the lite window so frontier
  // gets re-attempted soon instead of being pinned for the whole frontier TTL.
  return readFreshDetail(key, gamePlanLiteTtlMs(), deps);
}

// Default lite TTL stays the SHORT window (24h): resolveCachedGamePlan uses this to
// decide DR's lite fallback, and a stale lite there must NOT block frontier (Pro)
// generation — otherwise Deep Research would keep serving the cheap trickle take.
// SCREENER serving (db.getAllStocks, the intangibles GET) passes the long
// screenerLiteTtlMs explicitly so trickled names stay covered for weeks.
export function readFreshLiteGamePlan(symbol, deps, ttlMs = gamePlanLiteTtlMs()) {
  return readFreshDetail(`gameplan-lite:${symbol}`, ttlMs, deps);
}

/**
 * Normal DR load: frontier Pro first, lite placeholder only when Pro missing.
 * Explicit refresh=lite is handled separately and never clobbers frontier.
 */
/** True when a kv_cache `updated_at` is still inside the entry TTL. */
export function isFreshDetailCache(cachedAt, ttlMs, now = Date.now()) {
  return Number.isFinite(cachedAt) && now - cachedAt < ttlMs;
}

/** False when a fresh frontier Pro cache makes lite generation wasteful. */
export function shouldRunLiteIntangiblesGeneration(symbol, deps, { force = false } = {}) {
  if (force) return true;
  return !readFreshFrontierGamePlan(symbol, deps);
}

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