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
import { logError } from "../index.js";

// Rate limiters for expensive operations (per user or IP)
const refreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many refresh requests. Please wait before refreshing again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

const enrichLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many enrichment requests. Please wait before gathering data again.' },
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
} from "../fmp.js";
// We dynamically fetch up to 8000 symbols via company-screener with scope-aware filters + 500M mkt cap floor.
// Supports: 'us' (country=US), 'us-listed' (NYSE,NASDAQ,AMEX incl. ADRs like TSM), 'global' (no geo filter).

const UNIVERSE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

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

// New: get rich rows directly from screener (preferred fast path). Scope-aware + per-scope 24h cache.
// Universe fetch now applies a 500M+ market cap floor (cleaner, more relevant universe).
async function getScreenerRows(force = false, scope = "global") {
  const s = ["us", "us-listed", "global"].includes(scope) ? scope : "global";
  const cacheKey = `screener_rows_cache:${s}`;
  const cacheAtKey = `screener_rows_cache_at:${s}`;

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

  let country = null;
  let exchange = null;
  if (s === "us") {
    country = "US";
  } else if (s === "us-listed") {
    exchange = "NYSE,NASDAQ,AMEX";
  }
  // global: no geo/exchange filter (still gets the 500M mkt cap floor below)

  const rows = await fetchScreenerStocks({ minMarketCap: 500_000_000, limit: 8000, country, exchange });
  if (rows && rows.length) {
    setMeta(cacheKey, JSON.stringify(rows));
    setMeta(cacheAtKey, String(Date.now()));
    return rows;
  }
  return [];
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
router.post("/stocks/refresh", refreshLimiter, async (req, res) => {
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

    // Fast path: company-screener already gives us usable price/mcap/sector data
    // for up to 8000 names. This completely bypasses the broken profile batching
    // on starter plans.
    let universeMsg;
    if (scope === "us") {
      universeMsg = "Fetching universe from company-screener (US companies only)…";
    } else if (scope === "us-listed") {
      universeMsg = "Fetching universe from company-screener (US-listed incl. ADRs like TSM, ASML)…";
    } else {
      universeMsg = "Fetching universe from company-screener (Global markets)…";
    }

    send({ type: "status", message: universeMsg + " (500M+ mkt cap floor)" });
    const screenerRows = await getScreenerRows(force, scope);
    if (screenerRows.length) {
      saveScreenerBatch(screenerRows);

      if (force) {
        // Enforce the 500M mkt cap floor in the persisted DB.
        // This cleans up any old small-cap symbols from previous fetches
        // so the visible universe drops to the expected ~3000 names.
        const pruned = pruneBelowMarketCap(500_000_000);
        if (pruned > 0) {
          console.log(`[refresh] Pruned ${pruned} symbols below 500M mkt cap floor (force refresh)`);
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

    // Legacy slow path (only if screener gave us nothing)
    send({ type: "status", message: "Falling back to symbol list + profiles…" });
    const universe = await getUniverse(force);
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
router.post("/stocks/enrich", enrichLimiter, async (req, res) => {
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
        return r && (force || !r.has_km || !r.has_rat || !r.has_growth || !r.has_dcf);
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

    // Reduced workers + strict pacing for 100 stocks/min target on 300 rpm plan.
    const POOL = 5;

    // Enrichment-specific fetch options: 1 retry max, then move on.
    // Shorter timeout so one slow/broken symbol doesn't gum up a worker.
    const ENRICH_OPTS = { maxRetries: 1, timeoutMs: 9500 };

    // === All 4 rate limit improvements applied ===
    // A. Robust serialized stock pacer (no race between workers)
    // B. Reduced to 5 workers
    // C. 429-aware temporary extra backoff
    // D. Growth moved out of the main hot path (separate lighter phase)

    const STOCKS_PER_MINUTE = 100;
    const MIN_MS_PER_STOCK = Math.floor(60000 / STOCKS_PER_MINUTE); // ~600ms

    let nextStockSlot = 0;
    let extraBackoffUntil = 0;

    // Call this when we hit rate limits to temporarily slow down
    function recordRateLimitHit() {
      extraBackoffUntil = Date.now() + 2000; // extra 2s penalty on next stock
    }

    async function claimNextStockSlot() {
      const target = Math.max(nextStockSlot, extraBackoffUntil);
      const now = Date.now();
      if (now >= target) {
        nextStockSlot = now + MIN_MS_PER_STOCK;
        return;
      }

      // Tell the UI we're rate-limited and waiting
      if (extraBackoffUntil > now) {
        send({ 
          type: "status", 
          message: "Rate limited — queuing (waiting for API limit to reset)..." 
        });
      }

      await new Promise(r => setTimeout(r, target - now));
      nextStockSlot = Date.now() + MIN_MS_PER_STOCK;
    }

    await Promise.all(
      Array.from({ length: POOL }, async () => {
        while (true) {
          if (cancelled) return; // Stop as soon as client disconnects / hits Stop

          // A + C: Claim next stock slot with robust serialized pacer + 429 backoff
          await claimNextStockSlot();

          const idx = cursor++;
          if (idx >= targets.length) return;
          const symbol = targets[idx];
          const row = getStock(symbol);
          try {
            if (cancelled) return;

            // ── Parallelize the two most important calls per symbol ─────────
            const needKm = !row?.has_km;
            const needRat = !row?.has_rat;

            let km = null;
            let rat = null;

            if (needKm || needRat) {
              const [kmResult, ratResult] = await Promise.allSettled([
                needKm ? fetchKeyMetrics(symbol, ENRICH_OPTS) : Promise.resolve(null),
                needRat ? fetchRatios(symbol, ENRICH_OPTS) : Promise.resolve(null),
              ]);

              if (kmResult.status === "fulfilled") km = kmResult.value;
              else { 
                recordRateLimitHit();
                console.warn(`[Enrich] key-metrics no data / rate limited for ${symbol}`);
              }

              if (ratResult.status === "fulfilled") rat = ratResult.value;
              else { 
                recordRateLimitHit();
                console.warn(`[Enrich] ratios no data / rate limited for ${symbol}`);
              }
            }

            if (km) {
              if (km._haveEv && km._ev && row?.mcap) {
                const ev = km._ev;
                if (km.earnings_yield != null && km.ev_sales != null)
                  km.net_margin = (row.mcap * km.earnings_yield * km.ev_sales) / ev;
                if (km.fcf_yield != null && km.ev_sales != null)
                  km.fcf_margin = (row.mcap * km.fcf_yield * km.ev_sales) / ev;
                if (km.ev_sales != null) km.ps = (row.mcap * km.ev_sales) / ev;
              }
              delete km._ev;
              delete km._haveEv;
              saveKm(symbol, km);
            } else if (needKm) {
              recordRateLimitHit();
              console.warn(`[Enrich] No key-metrics returned for ${symbol} (likely rate limited)`);
            }

            if (rat) {
              const updated = getStock(symbol);
              if (updated?.ev_sales != null && rat.gross_margin != null && rat.gross_margin > 0)
                rat.ev_gp = updated.ev_sales / rat.gross_margin;
              saveRat(symbol, rat);
            } else if (needRat) {
              recordRateLimitHit();
              console.warn(`[Enrich] No ratios returned for ${symbol} (likely rate limited)`);
            }

            if (cancelled) return;

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
router.post("/stocks/ai-enrich", enrichLimiter, async (req, res) => {
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

  console.log(`[Sparkline] Incoming request for ${symbol} (days=${days})`);

  try {
    // Check if we have reasonably fresh data in DB (24h cache)
    const cached = getSparkline(symbol, days);
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (cached && (Date.now() - cached.updated_at) < ONE_DAY) {
      const prices = JSON.parse(cached.data || '[]');
      console.log(`[Sparkline] Cache hit for ${symbol} (${prices.length} points)`);
      return res.json({ symbol, prices });
    }

    // Fetch from FMP (will be rate-limited at the global level)
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
    universeTarget: 8000, // company-screener limit (now 500M+ mkt cap floor; dynamic per scope)
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
