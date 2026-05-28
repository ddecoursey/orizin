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
// UNIVERSE import removed — we now dynamically fetch up to 5000 symbols via company-screener
// The old static list (S&P500+400+600) is no longer used for data population.

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

// New: get rich rows directly from screener (preferred fast path)
async function getScreenerRows(force = false) {
  const cachedAt = getMeta("screener_rows_cache_at");
  const cached = getMeta("screener_rows_cache");
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
  const rows = await fetchScreenerStocks({ minMarketCap: 0, limit: 5000 });
  if (rows && rows.length) {
    setMeta("screener_rows_cache", JSON.stringify(rows));
    setMeta("screener_rows_cache_at", String(Date.now()));
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

    // Fast path: company-screener already gives us usable price/mcap/sector data
    // for up to 5000 names. This completely bypasses the broken profile batching
    // on starter plans.
    send({ type: "status", message: "Fetching universe from company-screener (up to 5000)…" });
    const screenerRows = await getScreenerRows(force);
    if (screenerRows.length) {
      saveScreenerBatch(screenerRows);
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
    const POOL = 4; // worker pool; rateGate in fmp.js still enforces per-request pacing

    await Promise.all(
      Array.from({ length: POOL }, async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= targets.length) return;
          const symbol = targets[idx];
          const row = getStock(symbol);
          try {
            // Fetch key-metrics-ttm
            if (!row?.has_km) {
              const km = await fetchKeyMetrics(symbol);
              if (km) {
                if (km._haveEv && km._ev && row?.mcap) {
                  const ev = km._ev;
                  if (km.earnings_yield != null && km.ev_sales != null)
                    km.net_margin =
                      (row.mcap * km.earnings_yield * km.ev_sales) / ev;
                  if (km.fcf_yield != null && km.ev_sales != null)
                    km.fcf_margin =
                      (row.mcap * km.fcf_yield * km.ev_sales) / ev;
                  if (km.ev_sales != null)
                    km.ps = (row.mcap * km.ev_sales) / ev;
                }
                delete km._ev;
                delete km._haveEv;
                saveKm(symbol, km);
              } else {
                errors++;
                logError(`[Enrich] No key-metrics returned for ${symbol}`);
              }
            }
            // Fetch ratios-ttm
            if (!row?.has_rat) {
              const rat = await fetchRatios(symbol);
              if (rat) {
                const updated = getStock(symbol);
                if (
                  updated?.ev_sales != null &&
                  rat.gross_margin != null &&
                  rat.gross_margin > 0
                )
                  rat.ev_gp = updated.ev_sales / rat.gross_margin;
                saveRat(symbol, rat);
              } else {
                errors++;
                logError(`[Enrich] No ratios returned for ${symbol}`);
              }
            }
            // Fetch DCF (Phase 2 scoring input)
            if (!row?.has_dcf) {
              const dcf = await fetchDCF(symbol);
              if (dcf) saveDcf(symbol, dcf);
              else markDcfChecked(symbol); // mark attempted so we don't retry forever
            }
            // Fetch financial-growth (Rule of 40 + growth pillar)
            if (!row?.has_growth) {
              const growth = await fetchFinancialGrowth(symbol);
              if (growth) saveGrowth(symbol, growth);
              else markGrowthChecked(symbol);
            }
          } catch (err) {
            errors++;
            const msg = `[Enrich] Failed for ${symbol}: ${err.message || err}`;
            console.warn(msg);
            logError(msg, { symbol, stack: err.stack });
          }
          done++;
          const now = Date.now();
          if (now - lastEmit > 400 || done === total) {
            lastEmit = now;
            send({ type: "progress", done, total, errors });
          }
        }
      }),
    );
    send({ type: "done", done, total, errors });
  } catch (e) {
    send({ type: "error", message: e.message });
  }
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
router.get("/stocks/sparkline/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const days = parseInt(req.query.days) || 45;

  console.log(`[Sparkline] Incoming request for ${symbol} (days=${days})`);

  try {
    const prices = await fetchHistoricalPricesLight(symbol, days);
    console.log(`[Sparkline] Responding for ${symbol} with ${prices.length} prices`);
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
    universeTarget: 5000, // company-screener limit (dynamic, filtered to active US names)
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
