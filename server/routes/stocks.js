import { Router } from "express";
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  getAllStocks,
  getStock,
  saveScreenerBatch,
  saveKm,
  saveRat,
  getMissingEnrich,
  setMeta,
  getMeta,
  getStockCount,
  getEnrichedCount,
  saveAiEnrichment,
  getAiEnrichment,
  getSparkline,
  saveSparkline,
  saveMomentum,
  momentumFromSparkline,
  saveTrend,
  trendFromSparkline,
  pruneUniverse,
  kvGet,
  kvSet,
  kvPurgeOlderThan,
  getUserByUsername,
} from "../db.js";
import { logError } from "../logger.js";
import { requireAdmin } from "../auth.js";
import { hasOriAccess } from "../access.js";
import { geminiGenerateJson, frontierModel, valueModel, liteModel, modelTier } from "../geminiJson.js";

// Rate limiters for expensive operations (per user or IP)
// Relaxed in dev (non-prod) so you can iterate on Universe Refresh / gather without
// constant "too many" blocks while the background job + UI activity is also using quota.
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const refreshLimiter = rateLimit({
  windowMs: isProd ? 60 * 60 * 1000 : 5 * 60 * 1000,
  max: isProd ? 5 : 100,
  message: { error: 'Too many refresh requests. Please wait before refreshing again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

const enrichLimiter = rateLimit({
  windowMs: isProd ? 60 * 60 * 1000 : 10 * 60 * 1000,
  max: isProd ? 3 : 30,
  message: { error: 'Too many enrichment requests. Please wait before gathering data again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

// Light limiter for the per-symbol valuation lookup (DCF / targets / owner
// earnings). It's cached 24h in the DB, so this only guards against bursts.
const aiDetailLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests — slow down a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

const sparklineLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Too many sparkline requests — slow down a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

const SYM_RE = /^[A-Z0-9.-]{1,12}$/;
function validSymbol(raw) {
  const sym = String(raw || "").toUpperCase();
  return SYM_RE.test(sym) ? sym : null;
}

function sparklinePricesFromRow(row) {
  if (!row?.data) return null;
  try {
    const prices = JSON.parse(row.data || "[]");
    return Array.isArray(prices) && prices.length ? prices : null;
  } catch {
    return null;
  }
}

async function resolveSparklinePrices(symbol, days, force = false) {
  if (!force) {
    const direct = sparklinePricesFromRow(getSparkline(symbol, days));
    if (direct) return direct.slice(-days);
    if (days <= 365) {
      const wider = sparklinePricesFromRow(getSparkline(symbol, 365));
      if (wider && wider.length >= days) return wider.slice(-days);
    }
  }
  const prices = await fetchHistoricalPricesLight(symbol, days);
  if (prices?.length) {
    saveSparkline(symbol, days, prices);
    if (days >= 45 && prices.length > days) saveSparkline(symbol, 365, prices);
  }
  return prices || [];
}

import {
  fetchProfiles,
  fetchKeyMetrics,
  fetchRatios,
  fetchProfile,
  profileToRow,
  fetchIncomeStatements,
  fetchBalanceSheets,
  fetchCashFlows,
  fetchSecFilings,
  fetchExecutiveCompensation,
  fetchStockPeers,
  fetchGrowthHistory,
  fetchScreenerStocks,
  fetchDCF,
  fetchPriceTarget,
  fetchFinancialGrowth,
  fetchAnalystEstimates,
  fetchOwnerEarnings,
  fetchStockList,
  fetchHistoricalPricesLight,
  fetchRSI,
  fetchIndicatorLatest,
  fetchEarnings,
  fetchCongressTrades,
  fetchInsiderBySymbol,
  fetchRatingsSnapshot,
  fetchGrades,
  fetchGeneralNews,
  fetchInsiderTrades,
  fetchStockNews,
  fetchIntraday,
  fetchUniverseRows,
  fetchEtfsFunds,
} from "../fmp.js";
// Universe refresh uses company-screener as the primary source: stocks are fetched
// with a market-cap floor and isEtf/isFund=false (full data inline — mcap/sector/
// price); ETFs/funds are fetched separately (no floor) and kept for price/name only,
// never enriched. The stable stock-list/etf-list path is a last-resort fallback.
const DEFAULT_MIN_MARKET_CAP = 500_000_000; // default floor for the stock universe

const UNIVERSE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Two-level TTL cache for per-symbol detail lookups (profile / ratings / grades
// / rsi / news / insider). Level 1 is an in-memory LRU for hot keys; level 2 is
// the SQLite kv_cache, so a server restart/redeploy doesn't throw away every
// cached lookup and re-bill it against the FMP quota. Only meaningful results
// are cached (non-null object / non-empty array), so a transient failure isn't
// pinned for the whole TTL.
const detailCache = new Map(); // key -> { at, data }
// In-flight coalescing: when several requests for the same uncached key arrive
// together (e.g. a fresh screener firing Ori reviews for the same leaders across
// tabs/users on a cold cache), they share ONE underlying fetch/Gemini call
// instead of each billing the quota. Key -> Promise, cleared when it settles.
const inFlightDetail = new Map();
// Cap the in-memory cache so a long-running server doesn't grow it without
// bound. Map iterates in insertion order, so evicting the first key drops the
// oldest entry.
const DETAIL_CACHE_MAX = 3000;
const detailCacheStats = { hits: 0, dbHits: 0, misses: 0 };
export function getDetailCacheStats() {
  return { ...detailCacheStats, memEntries: detailCache.size, memMax: DETAIL_CACHE_MAX };
}
function setDetailCache(key, data) {
  if (detailCache.has(key)) {
    detailCache.delete(key); // re-insert so updates move to the tail (newest)
  } else if (detailCache.size >= DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value;
    if (oldest !== undefined) detailCache.delete(oldest);
  }
  detailCache.set(key, { at: Date.now(), data });
  kvSet(key, data); // write-through so it survives restarts
}
async function cachedDetail(key, ttlMs, fn, force = false) {
  if (!force) {
    const hit = detailCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
      detailCacheStats.hits++;
      return hit.data;
    }
    // Memory miss → check the persistent cache before going to FMP.
    const persisted = kvGet(key);
    if (persisted && Date.now() - persisted.updatedAt < ttlMs) {
      detailCacheStats.dbHits++;
      // Promote to memory without rewriting the same payload to SQLite.
      if (detailCache.size >= DETAIL_CACHE_MAX) {
        const oldest = detailCache.keys().next().value;
        if (oldest !== undefined) detailCache.delete(oldest);
      }
      detailCache.set(key, { at: persisted.updatedAt, data: persisted.data });
      return persisted.data;
    }
  }
  detailCacheStats.misses++;
  // Coalesce concurrent misses for the same key onto a single in-flight call.
  // (force still shares a refresh in flight — a stampede of refreshes is the
  // same wasted work we want to avoid.)
  const pending = inFlightDetail.get(key);
  if (pending) return pending;
  const p = (async () => {
    const data = await fn();
    const useful = Array.isArray(data) ? data.length > 0 : data != null;
    if (useful) setDetailCache(key, data);
    return data;
  })();
  inFlightDetail.set(key, p);
  try {
    return await p;
  } finally {
    inFlightDetail.delete(key);
  }
}

// Bound the persistent cache: drop entries unused for 14 days, once a day.
setInterval(() => {
  try {
    const purged = kvPurgeOlderThan(14 * 24 * 60 * 60 * 1000);
    if (purged > 0) console.log(`[cache] purged ${purged} stale kv_cache entries`);
  } catch (e) {
    console.warn('[cache] purge failed:', e.message);
  }
}, 24 * 60 * 60 * 1000).unref();

async function getUniverse(force = false) {
  const cachedAt = getMeta("universe_cache_at");
  const cachedSymbols = getMeta("universe_cache");
  if (
    !force &&
    cachedAt &&
    cachedSymbols &&
    Date.now() - Number(cachedAt) < UNIVERSE_CACHE_TTL
  ) {
    return JSON.parse(cachedSymbols);
  }
  console.log("[universe] fetching fresh stock list from FMP…");
  const symbols = await fetchStockList();
  if (symbols && symbols.length) {
    setMeta("universe_cache", JSON.stringify(symbols));
    setMeta("universe_cache_at", String(Date.now()));
    console.log(`[universe] cached ${symbols.length} symbols`);
    return symbols;
  }
  // Do not fall back to a hardcoded list — require a live or cached universe.
  throw new Error(
    "No universe symbols returned from FMP (and no cache present)",
  );
}

// Universe via company-screener (primary): stocks fetched with a market-cap floor
// and isEtf/isFund=false (full data inline — mcap/sector/industry/price), plus all
// ETFs/funds (no floor) tagged is_etf=1 for price/name display only (never enriched).
// Scope maps to screener country/exchange filters. Falls back to the stable
// stock-list/etf-list only if the screener returns no stocks.
async function getUniverseRows(force = false, scope = "global", { minMarketCap = 0, includeEtfs = true } = {}) {
  const s = ["us", "us-listed", "global"].includes(scope) ? scope : "global";
  const floor = minMarketCap > 0 ? minMarketCap : DEFAULT_MIN_MARKET_CAP;
  // Cache keyed by scope + floor + etf-toggle so changing any of them re-fetches.
  const cacheKey = `universe_rows_cache:${s}:${floor}:${includeEtfs ? 1 : 0}`;
  const cacheAtKey = `universe_rows_cache_at:${s}:${floor}:${includeEtfs ? 1 : 0}`;

  const cachedAt = getMeta(cacheAtKey);
  const cached = getMeta(cacheKey);
  if (!force && cachedAt && cached && Date.now() - Number(cachedAt) < UNIVERSE_CACHE_TTL) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  // Map scope → screener country/exchange filters (global = no restriction).
  let country = null;
  let exchange = null;
  if (s === "us") country = "US";
  else if (s === "us-listed") exchange = "NYSE,NASDAQ,AMEX";

  // 1) Stocks above the floor (no ETFs/funds), full data inline.
  let stockRows = [];
  let stockErr = null;
  try {
    stockRows = await fetchScreenerStocks({
      minMarketCap: floor,
      limit: 15000,
      country,
      exchange,
      isActivelyTrading: true,
      includeEtfsAndFunds: false,
    });
  } catch (e) {
    stockErr = e;
    console.warn("[universe] stock screener failed:", e.message);
  }

  // 2) ETFs/funds (no floor) — kept for price/name only, never enriched.
  let etfRows = [];
  if (includeEtfs) {
    try {
      etfRows = await fetchEtfsFunds({ country, exchange, limit: 15000 });
    } catch (e) {
      console.warn("[universe] ETF/fund screener failed:", e.message);
    }
  }

  let rows = [...stockRows, ...etfRows];

  // Fallback: screener gave us no stocks → use the stable lists (symbol+name only).
  if (stockRows.length === 0) {
    console.warn("[universe] screener returned no stocks — falling back to stable lists");
    try {
      let listRows = await fetchUniverseRows();
      if (s === "us-listed") {
        listRows = listRows.filter((r) => ["NYSE", "NASDAQ", "AMEX"].includes(String(r.exchange || "").toUpperCase()));
      } else if (s === "us") {
        listRows = listRows.filter((r) => String(r.country || "").toUpperCase() === "US");
      }
      if (!includeEtfs) listRows = listRows.filter((r) => !r.is_etf);
      if (listRows.length) rows = listRows;
    } catch (e) {
      if (!rows.length) throw stockErr || e;
    }
  }

  if (!rows.length) {
    if (stockErr) throw stockErr;
    return [];
  }

  setMeta(cacheKey, JSON.stringify(rows));
  setMeta(cacheAtKey, String(Date.now()));
  return rows;
}

const router = Router();

// ── GET /api/stocks ────────────────────────────────────────────────────────
router.get("/stocks", (req, res) => {
  try {
    const stocks = getAllStocks();
    const lastFetch = getMeta("last_screener_fetch");
    res.json({
      stocks,
      meta: {
        count: stocks.length,
        enrichedCount: stocks.filter((s) => s.has_km && s.has_rat).length,
        lastFetch: lastFetch ? Number(lastFetch) : null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/stocks/refresh ───────────────────────────────────────────────
// Only admins may trigger universe/data refreshes from FMP.
router.post("/stocks/refresh", refreshLimiter, requireAdmin, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering (Railway, nginx, etc.) so SSE events stream live.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    const force = Boolean(req.body?.force || req.query?.force);
    // Accept new 'scope' or legacy 'usOnly' for backward compat with old clients/tabs
    const rawScope = req.body?.scope;
    const legacyUsOnly = req.body?.usOnly;
    let scope = "global";
    if (["us", "us-listed", "global"].includes(rawScope)) {
      scope = rawScope;
    } else if (legacyUsOnly !== undefined) {
      scope = legacyUsOnly !== false ? "us" : "us-listed";
    }

    const minMcap = Number(req.body?.minMarketCap) || 0;
    const floor = minMcap > 0 ? minMcap : DEFAULT_MIN_MARKET_CAP;
    // ETFs/funds are kept by default (price/name only, never enriched). Allow opting out.
    const includeEtfs = req.body?.includeEtfs !== false;
    // Captured before the fetch so a force-prune can tell refreshed rows (updated_at
    // after this) from stale ones the screener no longer returns (below floor/delisted).
    const refreshStart = Date.now();

    // Primary path: company-screener — stocks above the floor (full data inline) plus
    // ETFs/funds (no floor, kept for reference). Scope maps to country/exchange filters.
    send({ type: "status", message: `Fetching universe via FMP company-screener (${scope}, floor $${Math.round(floor / 1e6)}M${includeEtfs ? ", +ETFs" : ""})…` });

    const universeRows = await getUniverseRows(force, scope, { minMarketCap: floor, includeEtfs });
    if (universeRows.length) {
      saveScreenerBatch(universeRows);

      // On force, prune the universe down to the new floor: drop non-ETF stocks below
      // the floor and stale placeholders the screener no longer returns. ETFs are kept.
      // Guarded by a healthy stock count so a partial/failed fetch can't wipe the table.
      if (force) {
        const fetchedStocks = universeRows.filter((r) => !r.is_etf).length;
        if (fetchedStocks > 500) {
          const pruned = pruneUniverse(floor, refreshStart);
          if (pruned.total > 0) {
            console.log(`[refresh] Pruned ${pruned.total} (${pruned.belowFloor} below $${Math.round(floor / 1e6)}M, ${pruned.stalePlaceholders} stale) — ETFs kept`);
          }
        } else {
          console.warn(`[refresh] Skipping prune — only ${fetchedStocks} stocks fetched (looks partial)`);
        }
      }

      setMeta("last_screener_fetch", Date.now());
      const stocks = getAllStocks();
      send({
        type: "done",
        stocks,
        meta: {
          count: stocks.length,
          enrichedCount: stocks.filter((s) => s.has_km && s.has_rat).length,
          lastFetch: Date.now(),
        },
      });
      res.end();
      return;
    }

    // Legacy slow path (only if stable lists + profiles gave us nothing)
    send({ type: "status", message: "Falling back to symbol list + profiles…" });
    let universe;
    try {
      universe = await getUniverse(force);
    } catch (e) {
      console.warn("Legacy getUniverse also failed:", e.message);
      send({ type: "error", message: e.message || "Failed to fetch universe symbols from FMP" });
      res.end();
      return;
    }
    send({
      type: "progress",
      done: 0,
      total: universe.length,
      phase: "profiles",
    });
    const rows = await fetchProfiles(universe, {
      concurrency: 4,
      batchSize: 1, // starter plans do not support comma batches
      onProgress: (d, t) => {
        if (d % 25 === 0 || d === t)
          send({ type: "progress", done: d, total: t, phase: "profiles" });
      },
    });
    if (!rows.length) {
      send({
        type: "error",
        message: "FMP returned no profiles — check your API key or try again",
      });
      res.end();
      return;
    }
    saveScreenerBatch(rows);
    setMeta("last_screener_fetch", Date.now());
    const stocks = getAllStocks();
    send({
      type: "done",
      stocks,
      meta: {
        count: stocks.length,
        enrichedCount: stocks.filter((s) => s.has_km && s.has_rat).length,
        lastFetch: Date.now(),
      },
    });
  } catch (e) {
    send({ type: "error", message: e.message });
  }
  res.end();
});

// ── POST /api/stocks/enrich ───────────────────────────────────────────────
// Combined: fetches key-metrics-ttm + ratios-ttm per symbol in one pass
// Only admins may trigger data gathers/enriches.
router.post("/stocks/enrich", enrichLimiter, requireAdmin, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering (Railway, nginx, etc.) so SSE events stream live.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

  // Cancellation support — stop starting new FMP work when the client hits Stop
  let cancelled = false;
  const cancelHandler = () => { cancelled = true; };
  req.on('close', cancelHandler);

  try {
    const { symbols, force } = req.body || {};
    // ETFs/funds (is_etf=1) have no key-metrics/ratios, so they're never enrichment
    // targets — their price/name comes from the universe screener refresh instead.
    let targets;
    if (symbols?.length) {
      targets = symbols.filter((s) => {
        const r = getStock(s);
        return r && !r.is_etf && (force || !r.has_km || !r.has_rat);
      });
    } else if (force) {
      targets = getAllStocks().filter((r) => !r.is_etf).map((r) => r.symbol);
    } else {
      targets = getMissingEnrich();
    }

    if (!targets.length) {
      send({ type: "done", done: 0, total: 0, errors: 0 });
      res.end();
      return;
    }

    const total = targets.length;
    let done = 0,
      errors = 0,
      cursor = 0,
      lastEmit = 0;

    // Pacing tuned for FMP 300 rpm plan.
    // On force we now also refresh rich panel data (~10-12 FMP calls per symbol),
    // so we pace on *requests*, not stocks. This prevents stalls on large universes.
    const POOL = 4;

    // Enrichment-specific fetch options: 1 retry max, then move on.
    // Shorter timeout so one slow/broken symbol doesn't gum up a worker.
    const ENRICH_OPTS = { maxRetries: 1, timeoutMs: 9500 };

    // Request-level pacing (safer when a "stock" now does many calls on force: km+rat+spark+ai+profile+insider+news+rsi+ratings+grades+full history).
    // Target ~270 requests/min safe under FMP's 300 rpm limit.
    const REQUESTS_PER_MINUTE = 270;
    const MIN_MS_PER_REQUEST = Math.floor(60000 / REQUESTS_PER_MINUTE);

    let nextRequestSlot = 0;
    let extraBackoffUntil = 0;

    // Only call on real rate limit signals. Much gentler than before.
    function recordRateLimitHit() {
      extraBackoffUntil = Date.now() + 800; // short penalty
    }

    async function claimNextRequestSlot() {
      const target = Math.max(nextRequestSlot, extraBackoffUntil);
      const now = Date.now();
      if (now >= target) {
        nextRequestSlot = now + MIN_MS_PER_REQUEST;
        return;
      }

      if (extraBackoffUntil > now) {
        send({
          type: "status",
          message: "Rate limited — queuing (waiting for API limit to reset)..."
        });
      }

      await new Promise(r => setTimeout(r, target - now));
      nextRequestSlot = Date.now() + MIN_MS_PER_REQUEST;
    }

    await Promise.all(
      Array.from({ length: POOL }, async () => {
        while (true) {
          if (cancelled) return; // Stop as soon as client disconnects / hits Stop

          // Claim a request slot (we now do many more calls per symbol on force)
          await claimNextRequestSlot();

          const idx = cursor++;
          if (idx >= targets.length) return;
          const symbol = targets[idx];
          const row = getStock(symbol);
          try {
            if (cancelled) return;

            // Ensure basic profile fields are populated (price, mcap, sector, industry etc.)
            // This fixes missing data for symbols added via the list-based universe
            // (which only provides symbol+name for perf reasons). Gather will now also
            // backfill basics for any symbol it touches (in addition to the force path).
            const currentRow = getStock(symbol);
            // Track the freshest mcap we know for this symbol. The km-derived metrics
            // (ps / net_margin / fcf_margin) need it, and for a freshly-listed symbol
            // the captured `row` has mcap=null — so we must use the value the profile
            // backfill just wrote, not the stale snapshot.
            let mcap = currentRow?.mcap ?? null;
            const needsBasic = !currentRow?.price || !currentRow?.mcap || !currentRow?.sector || currentRow?.sector === '—';
            let profileBackfilled = false;
            if (needsBasic) {
              try {
                const prof = await fetchProfile(symbol, ENRICH_OPTS);
                if (prof) {
                  const profRow = profileToRow(prof);
                  saveScreenerBatch([profRow]);
                  if (profRow.mcap != null) mcap = profRow.mcap;
                  profileBackfilled = true;
                  setDetailCache(`profile:${symbol}`, prof);
                }
              } catch (e) {
                console.warn(`[Enrich] Profile backfill failed for ${symbol}:`, e.message);
              }
            }

            // ── Parallelize the two most important calls per symbol ─────────
            // On force we re-fetch even already-loaded metrics so the core valuation
            // numbers (PE/ROIC/margins) actually refresh — matching what the
            // "Force re-gather all" action promises.
            const needKm = force || !row?.has_km;
            const needRat = force || !row?.has_rat;

            let km = null;
            let rat = null;

            if (needKm || needRat) {
              const [kmResult, ratResult] = await Promise.allSettled([
                needKm ? fetchKeyMetrics(symbol, ENRICH_OPTS) : Promise.resolve(null),
                needRat ? fetchRatios(symbol, ENRICH_OPTS) : Promise.resolve(null),
              ]);

              if (kmResult.status === "fulfilled") km = kmResult.value;
              else {
                const errMsg = kmResult.reason?.message || '';
                if (errMsg.includes('429') || errMsg.includes('Too Many')) recordRateLimitHit();
                console.warn(`[Enrich] key-metrics failed for ${symbol}: ${errMsg}`);
              }

              if (ratResult.status === "fulfilled") rat = ratResult.value;
              else {
                const errMsg = ratResult.reason?.message || '';
                if (errMsg.includes('429') || errMsg.includes('Too Many')) recordRateLimitHit();
                console.warn(`[Enrich] ratios failed for ${symbol}: ${errMsg}`);
              }
            }

            if (km) {
              if (km._haveEv && km._ev && mcap) {
                const ev = km._ev;
                if (km.earnings_yield != null && km.ev_sales != null)
                  km.net_margin = (mcap * km.earnings_yield * km.ev_sales) / ev;
                if (km.fcf_yield != null && km.ev_sales != null)
                  km.fcf_margin = (mcap * km.fcf_yield * km.ev_sales) / ev;
                if (km.ev_sales != null) km.ps = (mcap * km.ev_sales) / ev;
              }
              delete km._ev;
              delete km._haveEv;
              saveKm(symbol, km);
            } else if (needKm) {
              console.warn(`[Enrich] No key-metrics returned for ${symbol}`);
            }

            if (rat) {
              const updated = getStock(symbol);
              if (updated?.ev_sales != null && rat.gross_margin != null && rat.gross_margin > 0)
                rat.ev_gp = updated.ev_sales / rat.gross_margin;
              saveRat(symbol, rat);
            } else if (needRat) {
              console.warn(`[Enrich] No ratios returned for ${symbol}`);
            }

            if (cancelled) return;

            // Sparkline data is gathered as part of the same enrichment pass
            // so it behaves exactly like the main metrics (populated by Gather/Force,
            // served from DB on refresh, only re-fetched on explicit force).
            const needSpark = force || !getSparkline(symbol, 45);
            if (needSpark) {
              try {
                const spark = await fetchHistoricalPricesLight(symbol, 45);
                if (spark && spark.length > 0) {
                  saveSparkline(symbol, 45, spark);
                  // Recompute the ~45-day momentum the screener Conviction uses.
                  saveMomentum(symbol, momentumFromSparkline(spark));
                }
              } catch (e) {
                console.warn(`[Enrich] Sparkline fetch failed for ${symbol}:`, e.message);
              }
            }

            // === FORCE: also refresh rich per-symbol data for the company overview panel ===
            // This makes "Force Re-gather All" actually pull the latest from FMP for
            // profile, DCF + analyst targets, insider, news, RSI, ratings, grades, and 365d history.
            if (force) {
              try {
                // AI valuation (DCF, targets, owner earnings) — bypass 24h SQLite cache
                const growthRows = await cachedDetail(`growthhist:${symbol}`, 24 * 60 * 60 * 1000, () =>
                  fetchGrowthHistory(symbol),
                );
                const growthLatest = growthRows?.[0] || null;
                const settled = await Promise.allSettled([
                  fetchDCF(symbol),
                  fetchPriceTarget(symbol),
                  Promise.resolve(growthLatest ? {
                    revenue_growth: growthLatest.revenue_growth,
                    net_income_growth: growthLatest.net_income_growth,
                    eps_growth: growthLatest.eps_growth,
                    fcf_growth: growthLatest.fcf_growth,
                    op_income_growth: growthLatest.op_income_growth,
                    gross_profit_growth: growthLatest.gross_profit_growth,
                  } : fetchFinancialGrowth(symbol)),
                  fetchOwnerEarnings(symbol),
                ]);
                const val = (s) => (s.status === "fulfilled" ? s.value : null);
                const [d, t, g, o] = settled.map(val);

                const aiRow = {
                  dcf: d?.dcf ?? null,
                  stock_price: d?.stock_price ?? null,
                  dcf_date: d?.dcf_date ?? null,
                  target_high: t?.target_high ?? null,
                  target_low: t?.target_low ?? null,
                  target_consensus: t?.target_consensus ?? null,
                  target_median: t?.target_median ?? null,
                  revenue_growth: g?.revenue_growth ?? null,
                  net_income_growth: g?.net_income_growth ?? null,
                  eps_growth: g?.eps_growth ?? null,
                  fcf_growth: g?.fcf_growth ?? null,
                  op_income_growth: g?.op_income_growth ?? null,
                  owner_earnings: o?.owner_earnings ?? null,
                  owner_eps: o?.owner_eps ?? null,
                  growth_capex: o?.growth_capex ?? null,
                  estimates_json: null,
                };
                saveAiEnrichment(symbol, aiRow);
              } catch (e) {
                console.warn(`[Enrich][force] AI data failed for ${symbol}:`, e.message);
              }

              // Profile — skip if the needsBasic backfill above already fetched it.
              if (!profileBackfilled) {
                try {
                  const prof = await fetchProfile(symbol);
                  if (prof) {
                    setDetailCache(`profile:${symbol}`, prof);
                    saveScreenerBatch([profileToRow(prof)]);
                  }
                } catch (e) {
                  console.warn(`[Enrich][force] Profile failed for ${symbol}:`, e.message);
                }
              }

              // Insider trades (shared cache key with GET /insider and smart-money)
              try {
                const trades = await cachedDetail(`insider:${symbol}`, 6 * 60 * 60 * 1000, () =>
                  fetchInsiderTrades(symbol, { limit: 80 }),
                true);
                if (Array.isArray(trades)) setDetailCache(`insider:${symbol}`, trades);
              } catch (e) {
                console.warn(`[Enrich][force] Insider failed for ${symbol}:`, e.message);
              }

              // Company news
              try {
                const nws = await fetchStockNews(symbol, { limit: 20 });
                if (Array.isArray(nws)) {
                  setDetailCache(`stocknews:${symbol}`, nws);
                }
              } catch (e) {
                console.warn(`[Enrich][force] News failed for ${symbol}:`, e.message);
              }

              // RSI (10)
              try {
                const rsiData = await fetchRSI(symbol, { periodLength: 10 });
                if (Array.isArray(rsiData)) {
                  setDetailCache(`rsi:${symbol}:10`, rsiData);
                }
              } catch (e) {
                console.warn(`[Enrich][force] RSI failed for ${symbol}:`, e.message);
              }

              // Ratings
              try {
                const ratSnap = await fetchRatingsSnapshot(symbol);
                if (ratSnap) {
                  setDetailCache(`ratings:${symbol}`, ratSnap);
                }
              } catch (e) {
                console.warn(`[Enrich][force] Ratings failed for ${symbol}:`, e.message);
              }

              // Analyst grades
              try {
                const gr = await fetchGrades(symbol);
                if (Array.isArray(gr)) {
                  setDetailCache(`grades:${symbol}`, gr);
                }
              } catch (e) {
                console.warn(`[Enrich][force] Grades failed for ${symbol}:`, e.message);
              }

              // 365-day sparkline (full history for the detail chart) + the
              // SMA50/200 trend the screener Conviction technicals pillar uses.
              try {
                const fullSpark = await fetchHistoricalPricesLight(symbol, 365);
                if (fullSpark && fullSpark.length > 0) {
                  saveSparkline(symbol, 365, fullSpark);
                  const t = trendFromSparkline(fullSpark);
                  if (t) saveTrend(symbol, t.sma50, t.sma200);
                }
              } catch (e) {
                console.warn(`[Enrich][force] 365d sparkline failed for ${symbol}:`, e.message);
              }
            }

            // Growth phase removed from main hot path (Option D - separate lighter phase)
            // Growth can be run later in a low-concurrency background pass if needed.
          } catch (err) {
            const message = err?.message || String(err);

            // Special handling: 429s should just queue/wait via our pacer, not count as errors
            if (message.includes('429') || message.includes('Too Many Requests')) {
              recordRateLimitHit();
              console.warn(`[Enrich] Rate limited on ${symbol}, will slow down: ${message}`);
            } else {
              // Any other error: log it and continue (do not kill the whole enrichment)
              errors++;
              console.warn(`[Enrich] Error on ${symbol} (continuing): ${message}`);
              logError(`[Enrich] Error on ${symbol}`, { symbol, error: message, stack: err?.stack });
            }
          }

          done++;
          const now = Date.now();
          if (now - lastEmit > 350 || done === total) {
            lastEmit = now;
            send({ type: "progress", done, total, errors });
          }
        }
      }),
    );

    if (!cancelled) {
      send({ type: "done", done, total, errors });
    } else {
      send({ type: "cancelled", done, total, errors });
    }
  } catch (e) {
    // Top-level error in the enrich handler — log it but try not to kill the stream
    // unless the client already cancelled.
    if (!cancelled) {
      console.error('[Enrich] Top-level error (enrichment will attempt to continue):', e);
      // We do NOT send an error event here anymore so the UI doesn't think it "closed"
      // The workers should keep going unless something is truly fatal.
    }
  }

  req.off('close', cancelHandler);
  res.end();
});

// Backward compat aliases
router.post("/stocks/load-metrics", (req, res, next) => {
  req.url = "/stocks/enrich";
  next("route");
});
router.post("/stocks/deep-enrich", (req, res, next) => {
  req.url = "/stocks/enrich";
  next("route");
});

// ── POST /api/stocks/ai-enrich ────────────────────────────────────────────
// On-demand: fetches DCF + analyst targets + growth + estimates + owner earnings
// Only admins may trigger (heavy) data enrichment.
router.post("/stocks/ai-enrich", enrichLimiter, requireAdmin, async (req, res) => {
  const { symbols } = req.body;
  if (!symbols?.length)
    return res.status(400).json({ error: "symbols required" });
  const capped = symbols.slice(0, 10);

  try {
    const results = {};
    for (const symbol of capped) {
      const cached = getAiEnrichment(symbol);
      if (cached && Date.now() - cached.updated_at < 24 * 60 * 60 * 1000) {
        results[symbol] = cached;
        continue;
      }
      const [dcf, target, growth, estimates, owner] = await Promise.all([
        fetchDCF(symbol),
        fetchPriceTarget(symbol),
        fetchFinancialGrowth(symbol),
        fetchAnalystEstimates(symbol),
        fetchOwnerEarnings(symbol),
      ]);
      const row = {
        dcf: dcf?.dcf ?? null,
        stock_price: dcf?.stock_price ?? null,
        dcf_date: dcf?.dcf_date ?? null,
        target_high: target?.target_high ?? null,
        target_low: target?.target_low ?? null,
        target_consensus: target?.target_consensus ?? null,
        target_median: target?.target_median ?? null,
        revenue_growth: growth?.revenue_growth ?? null,
        net_income_growth: growth?.net_income_growth ?? null,
        eps_growth: growth?.eps_growth ?? null,
        fcf_growth: growth?.fcf_growth ?? null,
        op_income_growth: growth?.op_income_growth ?? null,
        owner_earnings: owner?.owner_earnings ?? null,
        owner_eps: owner?.owner_eps ?? null,
        growth_capex: owner?.growth_capex ?? null,
        estimates_json: estimates ? JSON.stringify(estimates) : null,
      };
      saveAiEnrichment(symbol, row);
      results[symbol] = { symbol, ...row, updated_at: Date.now() };
    }
    res.json({ data: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/ai-data/:symbol ───────────────────────────────────────
router.get("/stocks/ai-data/:symbol", (req, res) => {
  const data = getAiEnrichment(req.params.symbol.toUpperCase());
  if (!data)
    return res.status(404).json({ error: "No AI enrichment data cached" });
  res.json(data);
});

// ── POST /api/stocks/add ───────────────────────────────────────────────────
router.post("/stocks/add", enrichLimiter, requireAdmin, async (req, res) => {
  const { symbol } = req.body;
  if (typeof symbol !== "string" || !symbol.trim()) return res.status(400).json({ error: "symbol required" });
  // Tickers are short alphanumerics (plus . and - for class shares / exchanges).
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(sym)) return res.status(400).json({ error: "Invalid ticker symbol" });
  try {
    const [prof, km, rat] = await Promise.all([
      fetchProfile(sym),
      fetchKeyMetrics(sym),
      fetchRatios(sym),
    ]);
    if (!prof)
      return res.status(404).json({ error: `Symbol ${sym} not found` });
    saveScreenerBatch([profileToRow(prof)]);
    if (km) {
      delete km._ev;
      delete km._haveEv;
      saveKm(sym, km);
    }
    if (rat) {
      const row = getStock(sym);
      if (
        row?.ev_sales != null &&
        rat.gross_margin != null &&
        rat.gross_margin > 0
      )
        rat.ev_gp = row.ev_sales / rat.gross_margin;
      saveRat(sym, rat);
    }
    res.json({ stock: getStock(sym) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/rsi/:symbol ────────────────────────────────────────────
// RSI technical indicator (0–100) for the detail chart overlay.
router.get("/stocks/rsi/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const periodLength = parseInt(req.query.periodLength) || 10;
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const rsi = await cachedDetail(`rsi:${symbol}:${periodLength}`, 6 * 60 * 60 * 1000, () =>
      fetchRSI(symbol, { periodLength }), force
    );
    res.json({ symbol, periodLength, rsi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/technicals/:symbol ─────────────────────────────────────
// Batched technical indicators for the Deep Research "Technical Analysis" panel
// (moving averages, ADX trend strength, Williams %R, volatility). Cached ~6h —
// 1-day indicators only change daily — to bound FMP cost; rate-limited.
router.get("/stocks/technicals/:symbol", aiDetailLimiter, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const data = await cachedDetail(`tech:${symbol}`, 6 * 60 * 60 * 1000, async () => {
      const [sma50, sma200, ema20, rsi14, adx, williams, stddev] = await Promise.all([
        fetchIndicatorLatest(symbol, "sma", 50),
        fetchIndicatorLatest(symbol, "sma", 200),
        fetchIndicatorLatest(symbol, "ema", 20),
        fetchIndicatorLatest(symbol, "rsi", 14),
        fetchIndicatorLatest(symbol, "adx", 14),
        fetchIndicatorLatest(symbol, "williams", 14),
        fetchIndicatorLatest(symbol, "standarddeviation", 20),
      ]);
      // If every indicator came back null (transient FMP failure / rate limit),
      // return null so cachedDetail does NOT cache an empty result for 6h.
      const anyData = [sma50, sma200, ema20, rsi14, adx, williams, stddev].some((x) => x && x.value != null);
      if (!anyData) return null;
      const close = sma50?.close ?? ema20?.close ?? adx?.close ?? null;
      const asOf = sma50?.date ?? ema20?.date ?? adx?.date ?? null;
      return {
        symbol,
        asOf,
        price: close,
        sma50: sma50?.value ?? null,
        sma200: sma200?.value ?? null,
        ema20: ema20?.value ?? null,
        rsi: rsi14?.value ?? null,
        adx: adx?.value ?? null,
        williams: williams?.value ?? null,
        stdDev: stddev?.value ?? null,
      };
    }, force);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "Could not load technical indicators" });
  }
});

// Aggregate Congress + insider trades into a "smart money" snapshot.
function aggregateSmartMoney(symbol, senate, house, insider) {
  const now = Date.now();
  const within = (d, days) => { const t = Date.parse(d); return Number.isFinite(t) && now - t <= days * 86400000; };
  const isBuy = (type) => /purchase|buy/i.test(type || "");
  const isSell = (type) => /sale|sell/i.test(type || "");
  const byDateDesc = (a, b) => new Date(b.transactionDate) - new Date(a.transactionDate);

  // Congress (disclosures lag, so a wider 180-day window).
  const congress = [...senate, ...house].filter((t) => within(t.transactionDate, 180));
  const cBuyers = new Set(), cSellers = new Set();
  for (const t of congress) { if (isBuy(t.type)) cBuyers.add(t.name); else if (isSell(t.type)) cSellers.add(t.name); }
  const congressRecent = [...congress].sort(byDateDesc).slice(0, 12).map((t) => ({
    date: t.transactionDate, name: t.name, chamber: t.chamber, district: t.district,
    type: isBuy(t.type) ? "buy" : isSell(t.type) ? "sell" : "other", amount: t.amount,
  }));

  // Insiders — open-market only (P-Purchase / S-Sale; exclude awards/options/gifts).
  const openMarket = insider.filter((t) => within(t.transactionDate, 120) && /^(P|S)-/i.test(t.transactionType || ""));
  const iBuyers = new Set(), iSellers = new Set();
  let buyValue = 0;
  for (const t of openMarket) {
    if (/^P-/i.test(t.transactionType)) { iBuyers.add(t.name); buyValue += (t.shares || 0) * (t.price || 0); }
    else iSellers.add(t.name);
  }
  const insiderRecent = [...openMarket].sort(byDateDesc).slice(0, 6).map((t) => ({
    date: t.transactionDate, name: t.name, role: t.role,
    type: /^P-/i.test(t.transactionType) ? "buy" : "sell", shares: t.shares,
    value: Math.round((t.shares || 0) * (t.price || 0)),
  }));

  const net = (cBuyers.size - cSellers.size) + (iBuyers.size - iSellers.size);
  let signal = "quiet";
  if (congress.length || openMarket.length) signal = net > 0 ? "buying" : net < 0 ? "selling" : "mixed";

  return {
    symbol,
    signal,
    congress: { buyers: cBuyers.size, sellers: cSellers.size, total: congress.length, recent: congressRecent },
    insider: { buyers: iBuyers.size, sellers: iSellers.size, total: openMarket.length, buyValue: Math.round(buyValue), recent: insiderRecent },
  };
}

// ── GET /api/stocks/smart-money/:symbol ────────────────────────────────────
// Congressional (Senate + House) + insider (open-market Form 4) trades, rolled
// up into a buy/sell signal + recent activity. Cached ~6h; rate-limited.
router.get("/stocks/smart-money/:symbol", aiDetailLimiter, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const data = await cachedDetail(`smartmoney:${symbol}`, 6 * 60 * 60 * 1000, async () => {
      const [senate, house, insiderTrades] = await Promise.all([
        fetchCongressTrades("senate", symbol),
        fetchCongressTrades("house", symbol),
        cachedDetail(`insider:${symbol}`, 6 * 60 * 60 * 1000, () =>
          fetchInsiderTrades(symbol, { limit: 80 }),
        ),
      ]);
      const insider = (insiderTrades || []).map((t) => ({
        transactionDate: typeof t.transactionDate === "string" ? t.transactionDate.split(" ")[0] : t.transactionDate,
        name: t.reportingName || "—",
        role: t.typeOfOwner || null,
        transactionType: t.transactionType || null,
        shares: t.securitiesTransacted,
        price: t.price,
      }));
      return aggregateSmartMoney(symbol, senate, house, insider);
    }, force);
    res.json(data || { symbol, signal: "quiet", congress: { total: 0, recent: [] }, insider: { total: 0, recent: [] } });
  } catch (e) {
    res.status(502).json({ error: "Could not load smart-money data" });
  }
});

// ── POST /api/stocks/game-plan/:symbol ─────────────────────────────────────
// Ori's intelligence layer for the unified Game Plan. The client sends its
// deterministic verdict + a compact fundamentals snapshot; the server adds
// canonical narrative data (profile + recent news) and asks Gemini to judge the
// INTANGIBLES / future potential (the Tesla/SpaceX factor a spreadsheet misses),
// macro tail/headwinds, bull & bear cases, and a BOUNDED adjustment to the
// verdict. Pro-gated, rate-limited, cached 24h (company-level, not personalized).
const GAME_PLAN_SYSTEM = `You are Ori, the in-house analyst for the Orizin stock app. You produce the "intangibles" layer of a stock's Game Plan — the judgment a spreadsheet can't make.

Your job: weigh what the NUMBERS MISS. Durable moat, brand, founder/management quality, total addressable market, disruption & optionality, regulatory and macro tailwinds/headwinds, and narrative momentum. A company can have weak current fundamentals yet enormous intangible potential (e.g. an early Tesla or a SpaceX) — say so when it's true, and equally call out hype with no substance.

Rules:
- Be sharp and specific to THIS company, not generic. Use the profile and recent news.
- Be balanced: always give a real bull case AND a real bear case, plus what would change your mind.
- xFactors: break the intangible case into the specific "X-factors" that drive it, each rated strong/moderate/weak/none with a one-line, company-specific note. Cover the ones that actually apply: MARKET DOMINANCE / MOAT (e.g. a near-monopoly, network effects, switching costs, irreplaceable IP), TOTAL ADDRESSABLE MARKET & OPTIONALITY, MANAGEMENT / FOUNDER quality, BRAND / PRICING POWER, and REGULATORY / MACRO positioning. Omit a factor entirely rather than padding with filler. The intangiblesScore must be the honest roll-up of these — a genuine monopoly/moat should pull it high; "none" across the board should keep it low.
- intangiblesScore (0-100): how strong the non-financial / future-potential case is, consistent with your xFactors. High only with a concrete reason.
- convictionDelta (-20..20): how much you'd nudge the data-driven conviction, and no more. The data is the anchor; you adjust within reason.
- horizonView / actionView: your view, knowing it may be reconciled toward the data verdict.
- riskLevel: be honest; story-driven names are usually "high" or "speculative".
- This is EDUCATIONAL analysis, never personalized financial advice. Do not tell the user to buy/sell with their own money; describe the setup.
Return ONLY the JSON object matching the schema.`;

const GAME_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    bottomLine: { type: "STRING" },
    intangiblesScore: { type: "INTEGER" },
    intangiblesRationale: { type: "STRING" },
    xFactors: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          factor: { type: "STRING" },
          strength: { type: "STRING", enum: ["strong", "moderate", "weak", "none"] },
          note: { type: "STRING" },
        },
        required: ["factor", "strength"],
        propertyOrdering: ["factor", "strength", "note"],
      },
    },
    futurePotential: { type: "STRING" },
    keyFactors: { type: "ARRAY", items: { type: "STRING" } },
    macroTailwinds: { type: "ARRAY", items: { type: "STRING" } },
    macroHeadwinds: { type: "ARRAY", items: { type: "STRING" } },
    bullCase: { type: "STRING" },
    bearCase: { type: "STRING" },
    whatWouldChangeMyMind: { type: "STRING" },
    riskLevel: { type: "STRING", enum: ["low", "moderate", "high", "speculative"] },
    horizonView: { type: "STRING", enum: ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"] },
    actionView: { type: "STRING" },
    convictionDelta: { type: "INTEGER" },
  },
  required: [
    "bottomLine", "intangiblesScore", "intangiblesRationale", "xFactors", "futurePotential",
    "bullCase", "bearCase", "whatWouldChangeMyMind", "riskLevel", "horizonView",
    "actionView", "convictionDelta",
  ],
  propertyOrdering: [
    "bottomLine", "intangiblesScore", "intangiblesRationale", "xFactors", "futurePotential",
    "keyFactors", "macroTailwinds", "macroHeadwinds", "bullCase", "bearCase",
    "whatWouldChangeMyMind", "riskLevel", "horizonView", "actionView", "convictionDelta",
  ],
};

function buildGamePlanPrompt({ symbol, profile, news, stats, verdict }) {
  const p = profile || {};
  const s = stats || {};
  const v = verdict || {};
  const num = (x, suf = "") => (x == null || !Number.isFinite(Number(x)) ? "—" : `${x}${suf}`);
  const pctf = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : `${(Number(x) * 100).toFixed(1)}%`);
  // The deterministic verdict + stats come from the CLIENT and the result is
  // cached per-symbol shared across users, so scrub free-text fields (strip
  // newlines/control chars + cap length) before they enter the prompt — no
  // crafted body can inject instructions or poison the shared cache.
  // eslint-disable-next-line no-control-regex -- intentionally strips control chars from untrusted client text
  const clean = (x, max = 160) => (typeof x === "string" ? x.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, max) : "");
  const reasons = Array.isArray(v.reasons) ? v.reasons.map((x) => clean(x, 140)).filter(Boolean).slice(0, 6) : [];
  const flags = v.flags && typeof v.flags === "object"
    ? Object.entries(v.flags).filter(([, on]) => on).map(([k]) => clean(k, 24)).filter(Boolean).slice(0, 6)
    : [];
  const headlines = (Array.isArray(news) ? news : [])
    .slice(0, 8)
    .map((n) => `• ${n.publishedDate ? String(n.publishedDate).slice(0, 10) + " " : ""}${clean(n.title, 200)}`)
    .join("\n");

  return `STOCK: ${symbol}${p.companyName ? ` — ${clean(p.companyName, 80)}` : ""}
Sector / Industry: ${clean(p.sector || s.sector, 40) || "—"} / ${clean(p.industry, 40) || "—"}
Price ${num(s.price)} · Market cap ${num(s.mcap)} · Beta ${num(s.beta)}

WHAT THE NUMBERS SAY (the deterministic verdict you are adjusting):
- Hold horizon: ${clean(v.horizon, 40) || "—"} · Right-now action: ${clean(v.action, 40) || "—"} · Conviction ${num(v.conviction)}/100
- Fundamentals/Orizin: ${num(s.orizinScore)}/100 · durability ${num(v.durability)} · valuation ${num(v.valuation)}
- Flags: ${flags.length ? flags.join(", ") : "none"}
${reasons.length ? `- Drivers: ${reasons.join("; ")}` : ""}

KEY FUNDAMENTALS:
- Valuation: P/E ${num(s.pe)}, P/S ${num(s.ps)}, P/B ${num(s.pb)}, FCF yield ${pctf(s.fcf_yield)}, DCF ${num(s.dcf)}, analyst target ${num(s.target)}
- Quality: ROIC ${pctf(s.roic)}, ROE ${pctf(s.roe)}, net margin ${pctf(s.net_margin)}, op margin ${pctf(s.op_margin)}, gross ${pctf(s.gross_margin)}, FCF margin ${pctf(s.fcf_margin)}
- Growth: revenue ${pctf(s.revenue_growth)}, EPS ${pctf(s.eps_growth)}
- Balance sheet: D/E ${num(s.debt_equity)}, net-debt/EBITDA ${num(s.net_debt_ebitda)}; dividend yield ${pctf(s.div_yield)}

COMPANY PROFILE:
${p.description ? String(p.description).slice(0, 1200) : "(no description available)"}

RECENT HEADLINES:
${headlines || "(none available)"}

Assess the intangibles and future potential of ${symbol}, then fill the JSON schema. Remember: the data verdict above is the anchor — your convictionDelta and horizon view should ADJUST within reason, not overrule it, unless the intangible story is genuinely decisive.`;
}

function sanitizeGamePlan(o) {
  if (!o || typeof o !== "object") return null;
  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  const str = (v, max = 600) => (typeof v === "string" ? v.slice(0, max) : "");
  const arr = (v, max = 6) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max) : []);
  const STRENGTH = ["strong", "moderate", "weak", "none"];
  // X-factors: structured breakdown of the intangible case (moat/monopoly, TAM,
  // management, brand, regulatory). Drop "none"/blank rows so the UI only shows
  // factors that actually apply, and cap the list.
  const xFactors = (Array.isArray(o.xFactors) ? o.xFactors : [])
    .map((x) => ({
      factor: str(x?.factor, 60),
      strength: STRENGTH.includes(x?.strength) ? x.strength : "moderate",
      note: str(x?.note, 160),
    }))
    .filter((x) => x.factor && x.strength !== "none")
    .slice(0, 6);
  const RISK = ["low", "moderate", "high", "speculative"];
  const HOR = ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"];
  return {
    bottomLine: str(o.bottomLine, 400),
    intangiblesScore: clampInt(o.intangiblesScore, 0, 100, 50),
    intangiblesRationale: str(o.intangiblesRationale),
    xFactors,
    futurePotential: str(o.futurePotential),
    keyFactors: arr(o.keyFactors),
    macroTailwinds: arr(o.macroTailwinds),
    macroHeadwinds: arr(o.macroHeadwinds),
    bullCase: str(o.bullCase),
    bearCase: str(o.bearCase),
    whatWouldChangeMyMind: str(o.whatWouldChangeMyMind),
    riskLevel: RISK.includes(o.riskLevel) ? o.riskLevel : "high",
    horizonView: HOR.includes(o.horizonView) ? o.horizonView : null,
    actionView: str(o.actionView, 80),
    convictionDelta: clampInt(o.convictionDelta, -20, 20, 0),
  };
}

router.post("/stocks/game-plan/:symbol", aiDetailLimiter, async (req, res) => {
  const symbol = validSymbol(req.params.symbol);
  if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
  if (!hasOriAccess(req.userId)) {
    return res.status(402).json({ error: "Ori's Game Plan is a Pro feature. Upgrade for $10/month.", code: "upgrade_required" });
  }
  try {
    const force = req.query.refresh === "1" || req.query.refresh === "true";
    // A manual retry (the "Try again" button, after a failed first load) skips
    // the scarce frontier model and leads with the least-busy tier (lite → value)
    // — retry is "just get me an answer", so go to the most available path, not
    // the busiest. The first/auto load and Re-gather still lead with frontier.
    const retry = req.query.retry === "1" || req.query.retry === "true";
    const ladder = retry
      ? { models: [liteModel(), valueModel()] }
      : { leadModel: frontierModel(), models: [valueModel(), liteModel()] };
    const stats = req.body?.stats && typeof req.body.stats === "object" ? req.body.stats : {};
    const verdict = req.body?.verdict && typeof req.body.verdict === "object" ? req.body.verdict : {};

    // Serve a fresh lite review instantly when frontier hasn't run yet — saves a
    // frontier Gemini call on first Deep Research open for popular names.
    if (!force && !retry) {
      const frontierHit = detailCache.get(`gameplan:${symbol}`);
      const frontierFresh = frontierHit && Date.now() - frontierHit.at < 24 * 60 * 60 * 1000;
      if (!frontierFresh) {
        const lite = kvGet(`gameplan-lite:${symbol}`);
        if (lite?.data && Date.now() - lite.updatedAt < 24 * 60 * 60 * 1000) {
          return res.json({ symbol, ori: lite.data, tier: "lite" });
        }
      }
    }

    const data = await cachedDetail(`gameplan:${symbol}`, 24 * 60 * 60 * 1000, async () => {
      // Profile/news are enrichment for the prompt, not hard requirements — a
      // transient fetch failure shouldn't sink the whole Game Plan, so degrade
      // to null and let Ori reason from the stats it already has.
      const [profile, news] = await Promise.all([
        cachedDetail(`profile:${symbol}`, 24 * 60 * 60 * 1000, () => fetchProfile(symbol)).catch(() => null),
        cachedDetail(`stocknews:${symbol}`, 30 * 60 * 1000, () => fetchStockNews(symbol, { limit: 20 })).catch(() => null),
      ]);
      // Model ladder per the request mode. Because this whole block is cached 24h
      // per symbol, the frontier model is hit at most once per stock per 24h, and
      // it appears only on the primary key so a single generation never spends the
      // scarce frontier quota twice.
      const { data: raw, model } = await geminiGenerateJson({
        system: GAME_PLAN_SYSTEM,
        prompt: buildGamePlanPrompt({ symbol, profile, news, stats, verdict }),
        schema: GAME_PLAN_SCHEMA,
        ...ladder,
      });
      const sane = sanitizeGamePlan(raw);
      if (sane) { sane.model = model; sane.modelTier = modelTier(model); }
      return sane;
    }, force);
    res.json({ symbol, ori: data });
  } catch (e) {
    if (e.code === "no_key") return res.status(503).json({ error: "Ori is not configured on this server." });
    if (e.code === "overloaded") return res.status(503).json({ error: "Ori is busy right now — try again in a moment." });
    if (e.code === "bad_json") return res.status(502).json({ error: "Ori couldn't produce a Game Plan — try again." });
    res.status(502).json({ error: "Could not generate Ori's Game Plan." });
  }
});

// ── Screener intangibles (lite) ────────────────────────────────────────────
// Cheap intangibles + X-Factors for the screener, generated on the LITE tier
// only (A:lite → B:lite via geminiGenerateJson's per-key iteration) and cached
// under `gameplan-lite:` — a DIFFERENT key from Deep Research's `gameplan:`, so
// these never clobber DR's premium frontier review (db.getAllStocks prefers the
// frontier review when both exist). Shared by the on-demand route below and the
// background "leaders" trickle in index.js.
//
// Cap-1 lane: a lite generation never occupies more than one of geminiJson's two
// global structured slots, so a DR frontier call always keeps a slot. It also
// serializes the background trickle and any client sweeps so they can't double up.
let liteActive = 0;
const liteWaiters = [];
function acquireLiteLane() {
  if (liteActive < 1) { liteActive++; return Promise.resolve(); }
  return new Promise((resolve) => liteWaiters.push(resolve));
}
function releaseLiteLane() {
  const next = liteWaiters.shift();
  if (next) next();
  else liteActive--;
}

export async function generateLiteIntangibles(symbol, { stats = {}, verdict = {} } = {}) {
  return cachedDetail(`gameplan-lite:${symbol}`, 24 * 60 * 60 * 1000, async () => {
    await acquireLiteLane();
    try {
      const [profile, news] = await Promise.all([
        cachedDetail(`profile:${symbol}`, 24 * 60 * 60 * 1000, () => fetchProfile(symbol)).catch(() => null),
        cachedDetail(`stocknews:${symbol}`, 30 * 60 * 1000, () => fetchStockNews(symbol, { limit: 20 })).catch(() => null),
      ]);
      const { data: raw, model } = await geminiGenerateJson({
        system: GAME_PLAN_SYSTEM,
        prompt: buildGamePlanPrompt({ symbol, profile, news, stats, verdict }),
        schema: GAME_PLAN_SCHEMA,
        models: [liteModel()], // lite ONLY — never value/frontier
      });
      const sane = sanitizeGamePlan(raw);
      if (sane) { sane.model = model; sane.modelTier = modelTier(model); }
      return sane;
    } finally {
      releaseLiteLane();
    }
  });
}

// ── POST /api/stocks/intangibles/:symbol ───────────────────────────────────
// On-demand lite intangibles for a screener leader. Pro/admin gated + rate
// limited; result is cached 24h and shared (company-level).
router.post("/stocks/intangibles/:symbol", aiDetailLimiter, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  if (!hasOriAccess(req.userId)) {
    return res.status(402).json({ error: "Ori intangibles is a Pro feature. Upgrade for $10/month.", code: "upgrade_required" });
  }
  try {
    const stats = req.body?.stats && typeof req.body.stats === "object" ? req.body.stats : {};
    const verdict = req.body?.verdict && typeof req.body.verdict === "object" ? req.body.verdict : {};
    const ori = await generateLiteIntangibles(symbol, { stats, verdict });
    res.json({ symbol, ori });
  } catch (e) {
    if (e.code === "no_key") return res.status(503).json({ error: "Ori is not configured on this server." });
    if (e.code === "overloaded") return res.status(503).json({ error: "Ori is busy right now — try again in a moment." });
    if (e.code === "bad_json") return res.status(502).json({ error: "Ori couldn't produce intangibles — try again." });
    res.status(502).json({ error: "Could not generate intangibles." });
  }
});

// ── GET /api/stocks/earnings/:symbol ───────────────────────────────────────
// Next earnings date + recent EPS/revenue beat-or-miss history. Cached ~12h.
router.get("/stocks/earnings/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const earnings = await cachedDetail(`earnings:${symbol}`, 12 * 60 * 60 * 1000, () =>
      fetchEarnings(symbol, { limit: 10 }), force
    );
    res.json({ symbol, earnings: earnings || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/ratings/:symbol ────────────────────────────────────────
// Ratings snapshot (letter grade + 1–5 sub-scores) for the detail pane.
router.get("/stocks/ratings/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const ratings = await cachedDetail(`ratings:${symbol}`, 6 * 60 * 60 * 1000, () =>
      fetchRatingsSnapshot(symbol), force
    );
    if (!ratings) return res.status(404).json({ error: "No ratings available" });
    res.json({ ratings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/grades/:symbol ─────────────────────────────────────────
// Recent analyst grading actions (upgrades / downgrades / maintains).
router.get("/stocks/grades/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const grades = await cachedDetail(`grades:${symbol}`, 6 * 60 * 60 * 1000, () =>
      fetchGrades(symbol), force
    );
    res.json({ symbol, grades });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/profile/:symbol ────────────────────────────────────────
// Full company profile from FMP (description, CEO, website, employees, etc.)
// for the detail overview modal.
router.get("/stocks/profile/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const profile = await cachedDetail(`profile:${symbol}`, 24 * 60 * 60 * 1000, () =>
      fetchProfile(symbol), force
    );
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json({ profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/insider/:symbol ────────────────────────────────────────
// Recent insider trading activity (Form 4 buys/sells). Cached 6h like the
// other per-symbol detail lookups.
router.get("/stocks/insider/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const trades = await cachedDetail(`insider:${symbol}`, 6 * 60 * 60 * 1000, () =>
      fetchInsiderTrades(symbol, { limit: 80 }), force
    );
    res.json({ symbol, trades });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/intraday/:symbol ───────────────────────────────────────
// Intraday 5-min price series for the chart's "1D" timeframe. Cached ~5m.
router.get("/stocks/intraday/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const prices = await cachedDetail(`intraday:${symbol}`, 5 * 60 * 1000, () =>
      fetchIntraday(symbol), force
    );
    res.json({ symbol, prices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/news/:symbol ───────────────────────────────────────────
// Latest news for a single company (the News tab in the overview). Cached 30m.
router.get("/stocks/news/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const news = await cachedDetail(`stocknews:${symbol}`, 30 * 60 * 1000, () =>
      fetchStockNews(symbol, { limit: 20 }), force
    );
    res.json({ symbol, news });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/news ──────────────────────────────────────────────────────────
// Latest general market news for the footer ticker + Ori context. Cached 10m.
router.get("/news", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 60);
    const force = req.query.force === '1' || req.query.force === 'true';
    const news = await cachedDetail(`news:general:${limit}`, 10 * 60 * 1000, () =>
      fetchGeneralNews({ limit }), force
    );
    res.json({ news });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Deep Research endpoints ────────────────────────────────────────────────
// Financial statements (income + balance + cash flow), SEC filings, executive
// compensation, peers, and multi-year growth. All cached through the two-level
// detail cache (memory + SQLite) so reopening a stock costs zero FMP calls.

// GET /api/stocks/statements/:symbol?period=annual|quarter
router.get("/stocks/statements/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const period = req.query.period === "quarter" ? "quarter" : "annual";
  const force = req.query.force === '1' || req.query.force === 'true';
  const TTL = 24 * 60 * 60 * 1000; // statements change quarterly at most
  try {
    const [income, balance, cashflow] = await Promise.all([
      cachedDetail(`stmt-inc:${symbol}:${period}`, TTL, () => fetchIncomeStatements(symbol, { period }), force),
      cachedDetail(`stmt-bal:${symbol}:${period}`, TTL, () => fetchBalanceSheets(symbol, { period }), force),
      cachedDetail(`stmt-cf:${symbol}:${period}`, TTL, () => fetchCashFlows(symbol, { period }), force),
    ]);
    res.json({ symbol, period, income, balance, cashflow });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stocks/filings/:symbol — recent SEC filings with links. Cached 12h.
router.get("/stocks/filings/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const filings = await cachedDetail(`filings:${symbol}`, 12 * 60 * 60 * 1000, () =>
      fetchSecFilings(symbol, { limit: 20 }), force
    );
    res.json({ symbol, filings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stocks/exec-comp/:symbol — named-executive pay. Cached 7d (annual data).
router.get("/stocks/exec-comp/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const compensation = await cachedDetail(`execcomp:${symbol}`, 7 * 24 * 60 * 60 * 1000, () =>
      fetchExecutiveCompensation(symbol), force
    );
    res.json({ symbol, compensation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stocks/peers/:symbol — peer list enriched with local screener
// metrics (P/E, mcap, sector) when the peer is in our universe. Peer list
// cached 7d; the metric join is a free local read so it's always current.
router.get("/stocks/peers/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const peers = await cachedDetail(`peers:${symbol}`, 7 * 24 * 60 * 60 * 1000, () =>
      fetchStockPeers(symbol), force
    );
    const enriched = (peers || []).map((p) => {
      const row = getStock(p.symbol);
      return row
        ? {
            ...p,
            inUniverse: true,
            mcap: row.mcap ?? p.mcap,
            price: row.price ?? p.price,
            sector: row.sector ?? null,
            pe: row.pe ?? null,
            ev_ebitda: row.ev_ebitda ?? null,
            roic: row.roic ?? null,
            gross_margin: row.gross_margin ?? null,
            revenue_growth: row.revenue_growth ?? null,
          }
        : { ...p, inUniverse: false };
    });
    res.json({ symbol, peers: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stocks/growth-history/:symbol — multi-year growth table. Cached 24h.
router.get("/stocks/growth-history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const growth = await cachedDetail(`growthhist:${symbol}`, 24 * 60 * 60 * 1000, () =>
      fetchGrowthHistory(symbol), force
    );
    res.json({ symbol, growth });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/ai/:symbol ─────────────────────────────────────────────
// Lazy per-symbol valuation enrichment for the open stock: DCF fair value,
// analyst price targets, and owner earnings. Cached 24h in SQLite so reopening
// a stock is free and we don't hammer FMP. Degrades gracefully if any single
// FMP endpoint isn't available on the current plan.
router.get("/stocks/ai/:symbol", aiDetailLimiter, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const cached = getAiEnrichment(symbol);
    if (!force && cached && Date.now() - cached.updated_at < 24 * 60 * 60 * 1000) {
      return res.json({ data: cached });
    }

    const settled = await Promise.allSettled([
      fetchDCF(symbol),
      fetchPriceTarget(symbol),
      fetchFinancialGrowth(symbol),
      fetchOwnerEarnings(symbol),
    ]);
    const val = (s) => (s.status === "fulfilled" ? s.value : null);
    const [d, t, g, o] = settled.map(val);

    const row = {
      dcf: d?.dcf ?? null,
      stock_price: d?.stock_price ?? null,
      dcf_date: d?.dcf_date ?? null,
      target_high: t?.target_high ?? null,
      target_low: t?.target_low ?? null,
      target_consensus: t?.target_consensus ?? null,
      target_median: t?.target_median ?? null,
      revenue_growth: g?.revenue_growth ?? null,
      net_income_growth: g?.net_income_growth ?? null,
      eps_growth: g?.eps_growth ?? null,
      fcf_growth: g?.fcf_growth ?? null,
      op_income_growth: g?.op_income_growth ?? null,
      owner_earnings: o?.owner_earnings ?? null,
      owner_eps: o?.owner_eps ?? null,
      growth_capex: o?.growth_capex ?? null,
      estimates_json: null,
    };
    saveAiEnrichment(symbol, row);
    res.json({ data: { symbol, ...row, updated_at: Date.now() } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stocks/:symbol ────────────────────────────────────────────────
router.get("/stocks/:symbol", (req, res) => {
  const row = getStock(req.params.symbol.toUpperCase());
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ── GET /api/stocks/sparkline/:symbol ──────────────────────────────────────
// Dynamic loading is still driven by the frontend (visibility in virtualized table).
// We just make sure that once we have fetched a symbol's sparkline data, we
// persist it in SQLite so we don't hammer FMP on every page load.
router.get("/stocks/sparkline/:symbol", sparklineLimiter, async (req, res) => {
  const symbol = validSymbol(req.params.symbol);
  if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
  const days = Math.min(1825, Math.max(5, parseInt(req.query.days, 10) || 45));
  const force = req.query.force === '1' || req.query.force === 'true';

  try {
    const prices = await resolveSparklinePrices(symbol, days, force);
    res.json({ symbol, prices });
  } catch (e) {
    console.error(`[Sparkline] Unexpected error for ${symbol}:`, e.message);
    res.status(502).json({ error: "Could not load sparkline" });
  }
});

// ── GET /api/status ────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  const lastFetch = getMeta("last_screener_fetch");
  const payload = {
    stockCount: getStockCount(),
    enrichedCount: getEnrichedCount(),
    universeTarget: 8000,
    lastFetch: lastFetch ? Number(lastFetch) : null,
  };
  // Key configuration is admin-only — don't leak integration status to every user.
  const adminUser = getUserByUsername(req.userId);
  if (adminUser?.is_admin) {
    payload.apiKeySet =
      !!process.env.FMP_API_KEY && process.env.FMP_API_KEY !== "your_fmp_api_key_here";
    payload.chatKeySet =
      !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here";
  }
  res.json(payload);
});

export default router;
