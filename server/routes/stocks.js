import { Router } from "express";
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  getAllStocks,
  getStock,
  saveScreenerBatch,
  saveKm,
  saveRat,
  saveDcf,
  saveGrowth,
  markDcfChecked,
  markGrowthChecked,
  getMissingEnrich,
  setMeta,
  getMeta,
  getStockCount,
  getEnrichedCount,
  saveAiEnrichment,
  getAiEnrichment,
  getAiEnrichmentBatch,
  getSparkline,
  saveSparkline,
  pruneBelowMarketCap,
} from "../db.js";
import { logError } from "../logger.js";
import { requireAdmin } from "../auth.js";

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

import {
  fetchProfiles,
  fetchKeyMetrics,
  fetchRatios,
  fetchProfile,
  profileToRow,
  screenerToRow,
  fetchScreenerStocks,
  fetchDCF,
  fetchPriceTarget,
  fetchFinancialGrowth,
  fetchAnalystEstimates,
  fetchOwnerEarnings,
  fetchStockList,
  fetchHistoricalPricesLight,
  fetchRSI,
  fetchRatingsSnapshot,
  fetchGrades,
  fetchGeneralNews,
  fetchInsiderTrades,
  fetchStockNews,
  fetchIntraday,
  fetchUniverseRows,
} from "../fmp.js";
// Universe refresh now uses BOTH FMP stable endpoints: /stock-list and /etf-list.
// Merged for complete list of global stocks + ETFs (no mcap floor), then /profile
// calls for details. Scope filters applied post-fetch. Old company-screener kept
// only as last-resort fallback inside getUniverseRows.
const DEFAULT_MIN_MARKET_CAP = 300_000_000; // still used for optional prune / legacy fallback logic

const UNIVERSE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// In-memory TTL cache for per-symbol detail lookups (profile / ratings / grades
// / rsi). These power the stock detail pane and don't change intraday, so a
// short-lived cache makes reopening a stock instant and spares FMP round-trips.
// Only meaningful results are cached (non-null object / non-empty array), so a
// transient failure isn't pinned for the whole TTL.
const detailCache = new Map(); // key -> { at, data }
// Cap the detail cache so a long-running server doesn't grow it without bound
// (6 keys × thousands of symbols would otherwise accumulate forever). Map iterates
// in insertion order, so evicting the first key drops the oldest entry.
const DETAIL_CACHE_MAX = 3000;
function setDetailCache(key, data) {
  if (detailCache.has(key)) {
    detailCache.delete(key); // re-insert so updates move to the tail (newest)
  } else if (detailCache.size >= DETAIL_CACHE_MAX) {
    const oldest = detailCache.keys().next().value;
    if (oldest !== undefined) detailCache.delete(oldest);
  }
  detailCache.set(key, { at: Date.now(), data });
}
async function cachedDetail(key, ttlMs, fn, force = false) {
  if (!force) {
    const hit = detailCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  }
  const data = await fn();
  const useful = Array.isArray(data) ? data.length > 0 : data != null;
  if (useful) setDetailCache(key, data);
  return data;
}

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

// Get universe rows using stable stock-list + etf-list (for refresh).
// Fetches both, merges for full global stocks+ETFs (no floor). Returns basic rows (symbol+name).
// Basics like price/mcap/sector are backfilled by enrich (force) and background job.
// Scope-aware cache + filtering. Client mcap etc still apply to view. Screener as fallback on error.
async function getUniverseRows(force = false, scope = "global", { minMarketCap = 0 } = {}) {
  const s = ["us", "us-listed", "global"].includes(scope) ? scope : "global";
  // cache per scope only (lists give everything; mcap handled in UI)
  const cacheKey = `universe_rows_cache:${s}`;
  const cacheAtKey = `universe_rows_cache_at:${s}`;

  const cachedAt = getMeta(cacheAtKey);
  const cached = getMeta(cacheKey);
  if (
    !force &&
    cachedAt &&
    cached &&
    Date.now() - Number(cachedAt) < UNIVERSE_CACHE_TTL
  ) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  // Fetch using both stable lists + profile enrichment (this is the new path for universe refresh)
  let rows;
  let listErr;
  try {
    rows = await fetchUniverseRows();
  } catch (e) {
    listErr = e;
    console.warn("[universe] stable lists failed, trying screener fallback:", e.message);
    rows = null;
  }

  if (!rows || !rows.length) {
    // ultimate fallback to old screener if lists failed
    let country = null;
    let exchange = null;
    if (s === "us") {
      country = "US";
    } else if (s === "us-listed") {
      exchange = "NYSE,NASDAQ,AMEX";
    }
    try {
      rows = await fetchScreenerStocks({ minMarketCap: 0, limit: 8000, country, exchange, includeEtfsAndFunds: true });
    } catch (e) {
      console.warn("[universe] screener fallback also failed:", e.message);
      rows = [];
    }
  }

  if (!rows || !rows.length) {
    if (listErr) throw listErr;
    return [];
  }

  // apply scope filter (lists are always global)
  if (s === "us-listed") {
    rows = rows.filter((r) => {
      const ex = String(r.exchange || "").toUpperCase();
      return ["NYSE", "NASDAQ", "AMEX"].includes(ex);
    });
  } else if (s === "us") {
    rows = rows.filter((r) => {
      const c = String(r.country || "").toUpperCase();
      return c === "US";
    });
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

    // New primary path: use stable /stock-list + /etf-list (both) to get full universe.
    // Then enrich with profiles. This gives complete list (no 8000 cap or mcap floor).
    // Scope (us / us-listed) filtering applied to the resulting rows.
    send({ type: "status", message: `Fetching universe via FMP stable stock-list + etf-list (${scope})…` });

    const universeRows = await getUniverseRows(force, scope, { minMarketCap: minMcap });
    if (universeRows.length) {
      saveScreenerBatch(universeRows);

      // No automatic prune (we want the full list from the lists). If a minMcap was
      // explicitly passed we could prune, but for universe refresh we keep everything.
      if (force && minMcap > 0) {
        const pruned = pruneBelowMarketCap(minMcap);
        if (pruned > 0) {
          console.log(`[refresh] Pruned ${pruned} symbols below ${minMcap} (force)`);
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
    let targets;
    if (symbols?.length) {
      targets = symbols.filter((s) => {
        const r = getStock(s);
        return r && (force || !r.has_km || !r.has_rat);
      });
    } else if (force) {
      targets = getAllStocks().map((r) => r.symbol);
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
            if (needsBasic) {
              try {
                const prof = await fetchProfile(symbol, ENRICH_OPTS);
                if (prof) {
                  const profRow = profileToRow(prof);
                  saveScreenerBatch([profRow]);
                  if (profRow.mcap != null) mcap = profRow.mcap;
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
                const settled = await Promise.allSettled([
                  fetchDCF(symbol),
                  fetchPriceTarget(symbol),
                  fetchFinancialGrowth(symbol),
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

              // Profile (description, CEO, employees, etc.)
              try {
                const prof = await fetchProfile(symbol);
                if (prof) {
                  // Update in-memory detail cache so the panel sees it immediately
                  setDetailCache(`profile:${symbol}`, prof);
                  // Also persist basic fields (price, mcap, sector, industry, exchange, country)
                  // to the main stocks table so the screener shows them (was broken after switching
                  // to list-based universe which only provides symbol+name).
                  saveScreenerBatch([profileToRow(prof)]);
                }
              } catch (e) {
                console.warn(`[Enrich][force] Profile failed for ${symbol}:`, e.message);
              }

              // Insider trades
              try {
                const trades = await fetchInsiderTrades(symbol, { limit: 40 });
                if (Array.isArray(trades)) {
                  setDetailCache(`insider:${symbol}`, trades);
                }
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

              // 365-day sparkline (full history for the detail chart)
              try {
                const fullSpark = await fetchHistoricalPricesLight(symbol, 365);
                if (fullSpark && fullSpark.length > 0) {
                  saveSparkline(symbol, 365, fullSpark);
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
router.post("/stocks/add", async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const sym = symbol.trim().toUpperCase();
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
      fetchInsiderTrades(symbol, { limit: 40 }), force
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
    const prices = await cachedDetail(`intraday:${symbol}`, 5 * 60 * 1000, () =>
      fetchIntraday(symbol),
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
router.get("/stocks/sparkline/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const days = parseInt(req.query.days) || 45;
  const force = req.query.force === '1' || req.query.force === 'true';

  console.log(`[Sparkline] Incoming request for ${symbol} (days=${days}, force=${force})`);

  try {
    if (!force) {
      // Serve from SQLite if we have any data at all for this (symbol, days).
      // Sparklines are historical and relatively stable — we only re-fetch
      // when the user explicitly uses the Force Re-gather button.
      const cached = getSparkline(symbol, days);
      if (cached) {
        const prices = JSON.parse(cached.data || '[]');
        console.log(`[Sparkline] Cache hit for ${symbol} (${prices.length} points)`);
        return res.json({ symbol, prices });
      }
    }

    // The individual endpoint is now mostly a fallback / convenience.
    // Primary population happens inside the main /enrich flow (so sparklines
    // behave exactly like key-metrics and ratios: gathered via the button,
    // served from DB on refresh, only re-fetched on explicit Force).
    console.log(`[Sparkline] ${force ? 'Force' : 'No cache'} — fetching from FMP for ${symbol} (standalone request)`);
    const prices = await fetchHistoricalPricesLight(symbol, days);

    if (prices && prices.length > 0) {
      saveSparkline(symbol, days, prices);
      console.log(`[Sparkline] Cached sparkline for ${symbol} (${prices.length} points)`);
    }

    res.json({ symbol, prices });
  } catch (e) {
    console.error(`[Sparkline] Unexpected error for ${symbol}:`, e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/status ────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  const lastFetch = getMeta("last_screener_fetch");
  res.json({
    stockCount: getStockCount(),
    enrichedCount: getEnrichedCount(),
    universeTarget: 8000, // company-screener limit (300M+ floor by default, stocks + ETFs included)
    lastFetch: lastFetch ? Number(lastFetch) : null,
    apiKeySet:
      !!process.env.FMP_API_KEY &&
      process.env.FMP_API_KEY !== "your_fmp_api_key_here",
    chatKeySet:
      !!process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== "your_gemini_api_key_here",
  });
});

export default router;
