// Use Node 22's built-in fetch (undici). node-fetch v3 emits an 'error'
// on its response PassThrough when aborted, which crashes the process if
// nothing listens — native fetch propagates AbortError cleanly.
import { logError } from "./index.js";

const BASE = "https://financialmodelingprep.com/stable";
const KEY = () => process.env.FMP_API_KEY || "";

// ── Token-bucket rate limiter (~5 req/sec for starter plan) ───────────────
const RATE_MS = 210; // min ms between requests
let _lastCall = 0;
async function rateGate() {
  const now = Date.now();
  const wait = _lastCall + RATE_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastCall = Date.now();
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return isFinite(x) ? x : null;
}

// ── Build stock row directly from company-screener response ────────────────
export function screenerToRow(s) {
  const price = n(s.price);
  const mcap = n(s.marketCap || s.mktCap);
  const lastDiv = n(s.lastAnnualDividend ?? s.dividend);
  const divYield = price && lastDiv ? lastDiv / price : null;
  return {
    symbol: s.symbol,
    name: s.companyName || s.name || s.symbol,
    sector: s.sector || "—",
    industry: s.industry || "—",
    exchange: s.exchange || s.exchangeShortName || "",
    price,
    mcap,
    volume: n(s.volume || s.volAvg),
    beta: n(s.beta),
    div_yield: divYield,
    updated_at: Date.now(),
  };
}

async function fetchWithRetry(url, maxRetries = 6, timeoutMs = 15000) {
  const sanitizedUrl = url.replace(/apikey=[^&]+/, 'apikey=***');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateGate();

    const attemptInfo = attempt > 0 ? ` (attempt ${attempt + 1})` : '';

    // node-fetch v3 removed the `timeout` option, so use AbortController.
    // Without this, a non-responding FMP endpoint would hang the request forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestStarted = Date.now();
    try {
      const res = await fetch(url, { signal: controller.signal });

      let responseData = null;
      if (res.ok) {
        try {
          responseData = await res.clone().json(); // clone so we can still return it
        } catch {
          // Body wasn't valid JSON — fine, we'll return null below.
        }
      }

      const elapsedMs = Date.now() - requestStarted;
      // Only log non-OK responses to the error log. Successful calls would
      // spam Railway's log rate limit (each ratios-ttm response is huge,
      // multiplied by thousands of enrich requests).
      if (!res.ok) {
        logError(`[FMP CALL] ${sanitizedUrl}${attemptInfo}`, {
          status: res.status,
          ok: false,
          ms: elapsedMs,
          attempt: attempt + 1,
        });
      }

      if (res.status === 429 && attempt < maxRetries) {
        const delay =
          Math.min(500 * Math.pow(2, attempt), 16000) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok)
        throw new Error(`FMP ${res.status}: ${res.statusText} (${sanitizedUrl})`);

      return responseData ?? await res.json();

    } catch (e) {
      const msg = e.message || "";
      const aborted = e.name === "AbortError";
      const elapsedMs = Date.now() - requestStarted;
      logError(`[FMP CALL] ${sanitizedUrl}${attemptInfo} FAILED`, {
        error: aborted ? `timeout after ${Math.round(timeoutMs / 1000)}s` : msg,
        ms: elapsedMs,
        attempt: attempt + 1,
      });

      const retryable =
        aborted ||
        msg.includes("429") ||
        msg.includes("ECONNRESET") ||
        msg.includes("timeout") ||
        msg.includes("ETIMEDOUT");

      if (retryable && attempt < maxRetries) {
        const delay =
          Math.min(500 * Math.pow(2, attempt), 16000) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  logError(`[FMP CALL] ${sanitizedUrl} EXHAUSTED RETRIES`);
  return null;
}

// ── Fetch stocks via company-screener (preferred for 5k limit) ─────────────
export async function fetchScreenerStocks({
  minMarketCap = 0,
  limit = 5000,
  country = "US",
  isActivelyTrading = true,
  includeEtfsAndFunds = false,
} = {}) {
  const params = new URLSearchParams({ limit: String(limit), apikey: KEY() });
  if (minMarketCap > 0) params.set("marketCapMoreThan", String(minMarketCap));
  if (country) params.set("country", country);
  if (isActivelyTrading) params.set("isActivelyTrading", "true");
  if (!includeEtfsAndFunds) {
    params.set("isEtf", "false");
    params.set("isFund", "false");
  }

  const url = `${BASE}/company-screener?${params.toString()}`;
  try {
    // company-screener with high limit can take 30–60s on FMP's side.
    // Use a 90s per-attempt timeout instead of the 15s default.
    const data = await fetchWithRetry(url, 3, 90000);
    if (!Array.isArray(data) || !data.length) {
      console.warn("[FMP] company-screener returned no data");
      return [];
    }
    let rows = data.map(screenerToRow);
    if (!includeEtfsAndFunds) {
      rows = rows.filter((r, i) => {
        const s = data[i];
        return !s?.isEtf && !s?.isFund;
      });
    }
    console.log(
      `[FMP] company-screener gave ${data.length} raw → ${rows.length} after filters (minMcap=${minMarketCap || "none"})`,
    );
    return rows;
  } catch (e) {
    console.warn("[FMP] company-screener failed:", e.message);
    return [];
  }
}

// ── Fetch full US stock list (symbols only, for backward compat) ───────────
export async function fetchStockList() {
  // Use the rich screener (limit 5000) and return just symbols.
  // This avoids the broken comma-batch /profile behavior on starter plans.
  const rows = await fetchScreenerStocks({ minMarketCap: 0, limit: 5000 });
  if (rows.length) return rows.map((r) => r.symbol);

  // Last-resort fallback (very broad, will be slow to profile)
  const url = `${BASE}/stock/list?apikey=${KEY()}`;
  try {
    await rateGate();
    const res = await fetch(url, { timeout: 30000 });
    if (!res.ok) throw new Error(`FMP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const cand = data
      .filter((s) => s.symbol && s.type === "stock")
      .map((s) => s.symbol);
    // Note: fetchProfiles now forces batchSize=1 (starter plans ignore comma batches)
    const profRows = await fetchProfiles(cand, { concurrency: 4, batchSize: 1 });
    const filtered = profRows.filter(
      (r) =>
        r.mcap != null &&
        ["NYSE", "NASDAQ", "AMEX"].includes(r.exchange),
    );
    return filtered.map((r) => r.symbol);
  } catch (e) {
    console.warn("[FMP] stock/list fallback:", e.message);
    return null;
  }
}

// ── Company profile (price, mcap, sector, industry, beta) ──────────────────
export async function fetchProfile(symbol) {
  const url = `${BASE}/profile?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const prof = Array.isArray(data) ? data[0] : data;
    if (!prof || typeof prof !== "object" || !prof.symbol) return null;
    return prof;
  } catch (e) {
    console.warn(`[FMP] profile ${symbol}:`, e.message);
    return null;
  }
}

// ── Build screener row from profile data ────────────────────────────────────
export function profileToRow(prof) {
  const divYield =
    prof.lastDividend && prof.price && prof.price > 0
      ? prof.lastDividend / prof.price
      : null;
  return {
    symbol: prof.symbol,
    name: prof.companyName || prof.symbol,
    sector: prof.sector || "—",
    industry: prof.industry || "—",
    exchange: prof.exchange || prof.exchangeShortName || "",
    price: n(prof.price),
    mcap: n(prof.marketCap || prof.mktCap),
    volume: n(prof.volAvg || prof.volume),
    beta: n(prof.beta),
    div_yield: divYield,
    updated_at: Date.now(),
  };
}

// ── Fetch profiles for a batch of symbols (concurrent pool) ────────────────
export async function fetchProfiles(
  symbols,
  { concurrency = 4, batchSize = 1, onProgress } = {},
) {
  // On many starter plans the comma-batch syntax (?symbol=AAPL,MSFT) returns
  // empty results even though single-symbol calls work. Default to batchSize=1.
  const useBatch = batchSize > 1;
  const results = [];
  let done = 0;
  const batches = [];
  for (let i = 0; i < symbols.length; i += batchSize)
    batches.push(symbols.slice(i, i + batchSize));

  const workers = Array.from(
    { length: Math.min(concurrency, batches.length) },
    async () => {
      while (batches.length) {
        const batch = batches.shift();
        try {
          const url = useBatch
            ? `${BASE}/profile?symbol=${batch.join(",")}&apikey=${KEY()}`
            : `${BASE}/profile?symbol=${batch[0]}&apikey=${KEY()}`;
          const data = await fetchWithRetry(url);
          if (Array.isArray(data)) {
            for (const prof of data) {
              if (prof && prof.symbol) results.push(profileToRow(prof));
              done++;
              if (onProgress) onProgress(done, symbols.length);
            }
          } else if (data && data.symbol) {
            results.push(profileToRow(data));
            done++;
            if (onProgress) onProgress(done, symbols.length);
          } else if (!useBatch) {
            // single call returned nothing usable
            done++;
            if (onProgress) onProgress(done, symbols.length);
          }
        } catch (e) {
          done += batch.length;
          if (onProgress) onProgress(done, symbols.length);
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}

// ── Key metrics TTM (fast, 1 call/stock) ───────────────────────────────────
export async function fetchKeyMetrics(symbol) {
  const url = `${BASE}/key-metrics-ttm?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const km = Array.isArray(data) ? data[0] : data;
    if (!km || typeof km !== "object") return null;

    const evEb = n(km.evToEBITDATTM);
    const evS = n(km.evToSalesTTM);
    const fcfY = n(km.freeCashFlowYieldTTM);
    const ey = n(km.earningsYieldTTM);
    const ev = n(km.enterpriseValueTTM);
    const haveEv = ev !== null && ev !== 0;

    // Math-derive EBITDA margin from EV ratios
    let ebitdaMargin = null;
    if (evS !== null && evEb !== null && evEb !== 0) ebitdaMargin = evS / evEb;

    return {
      roic: n(km.returnOnInvestedCapitalTTM),
      roe: n(km.returnOnEquityTTM),
      roa: n(km.returnOnAssetsTTM),
      ev_ebitda: evEb,
      ev_sales: evS,
      fcf_yield: fcfY,
      earnings_yield: ey,
      net_debt_ebitda: n(km.netDebtToEBITDATTM),
      current_ratio: n(km.currentRatioTTM),
      div_yield: n(km.dividendYieldTTM) ?? n(km.dividendYielTTM),
      pe: n(km.peRatioTTM),
      pb: n(km.pbRatioTTM),
      ps: null, // derived server-side using mcap + ev
      ebitda_margin: ebitdaMargin,
      net_margin: null, // derived server-side
      fcf_margin: null, // derived server-side
      _ev: ev,
      _haveEv: haveEv,
    };
  } catch (e) {
    const msg = `[FMP] key-metrics-ttm ${symbol}: ${e.message}`;
    console.warn(msg);
    logError(msg, { symbol, endpoint: 'key-metrics-ttm' });
    return null;
  }
}

// ── Ratios TTM (gross/op margin, D/E, EV/GP) ─────────────────────────────
export async function fetchRatios(symbol) {
  const url = `${BASE}/ratios-ttm?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const rat = Array.isArray(data) ? data[0] : data;
    if (!rat || typeof rat !== "object") return null;

    return {
      gross_margin: n(rat.grossProfitMarginTTM),
      op_margin: n(rat.operatingProfitMarginTTM),
      pe: n(rat.priceToEarningsRatioTTM),
      pb: n(rat.priceToBookRatioTTM),
      ps: n(rat.priceToSalesRatioTTM),
      debt_equity: n(rat.debtToEquityRatioTTM),
      payout: n(rat.dividendPayoutRatioTTM),
      div_yield: n(rat.dividendYieldTTM),
      roe: n(rat.returnOnEquityTTM),
      current_ratio: n(rat.currentRatioTTM),
      ev_gp: null,
    };
  } catch (e) {
    const msg = `[FMP] ratios-ttm ${symbol}: ${e.message}`;
    console.warn(msg);
    logError(msg, { symbol, endpoint: 'ratios-ttm' });
    return null;
  }
}

// ── AI enrichment fetchers (on-demand, not bulk) ──────────────────────────

export async function fetchDCF(symbol) {
  const url = `${BASE}/discounted-cash-flow?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return null;
    return {
      dcf: n(d.dcf),
      stock_price: n(d["Stock Price"]),
      dcf_date: d.date || null,
    };
  } catch (e) {
    console.warn(`[FMP] dcf ${symbol}:`, e.message);
    return null;
  }
}

export async function fetchPriceTarget(symbol) {
  const url = `${BASE}/price-target-consensus?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return null;
    return {
      target_high: n(d.targetHigh),
      target_low: n(d.targetLow),
      target_consensus: n(d.targetConsensus),
      target_median: n(d.targetMedian),
    };
  } catch (e) {
    console.warn(`[FMP] price-target ${symbol}:`, e.message);
    return null;
  }
}

export async function fetchFinancialGrowth(symbol) {
  const url = `${BASE}/financial-growth?symbol=${symbol}&limit=1&period=annual&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return null;
    return {
      revenue_growth: n(d.revenueGrowth),
      net_income_growth: n(d.netIncomeGrowth),
      eps_growth: n(d.epsgrowth),
      fcf_growth: n(d.freeCashFlowGrowth),
      op_income_growth: n(d.operatingIncomeGrowth),
      gross_profit_growth: n(d.grossProfitGrowth),
    };
  } catch (e) {
    console.warn(`[FMP] financial-growth ${symbol}:`, e.message);
    return null;
  }
}

// Lightweight historical EOD prices for sparklines
export async function fetchHistoricalPricesLight(symbol, days = 45) {
  const url = `${BASE}/historical-price-eod/light?symbol=${symbol}&apikey=${KEY()}`;
  console.log(`[FMP] Fetching historical light for ${symbol} (last ${days} days)`);

  try {
    const data = await fetchWithRetry(url);

    console.log(`[FMP] Raw response type for ${symbol}:`, typeof data, Array.isArray(data) ? '(array)' : '(not array)');

    if (!Array.isArray(data)) {
      console.warn(`[FMP] Unexpected response shape for ${symbol}:`, data);
      return [];
    }

    // FMP light returns newest first usually
    const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    const recent = sorted.slice(-days);

    const result = recent.map(d => ({
      date: d.date,
      price: n(d.price),
    })).filter(d => d.price != null);

    console.log(`[FMP] ${symbol} → ${result.length} valid prices returned`);
    return result;

  } catch (e) {
    console.error(`[FMP] Failed to fetch historical light for ${symbol}:`, e.message);
    if (e.response) {
      console.error(`[FMP] Response status:`, e.response.status);
    }
    return [];
  }
}

export async function fetchAnalystEstimates(symbol) {
  const url = `${BASE}/analyst-estimates?symbol=${symbol}&period=annual&limit=2&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data) || !data.length) return null;
    return data.map((d) => ({
      date: d.date,
      revenue_avg: n(d.revenueAvg),
      eps_avg: n(d.epsAvg),
      revenue_high: n(d.revenueHigh),
      eps_high: n(d.epsHigh),
      revenue_low: n(d.revenueLow),
      eps_low: n(d.epsLow),
      num_analysts: n(d.numAnalystsEps),
    }));
  } catch (e) {
    console.warn(`[FMP] analyst-estimates ${symbol}:`, e.message);
    return null;
  }
}

export async function fetchOwnerEarnings(symbol) {
  const url = `${BASE}/owner-earnings?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return null;
    return {
      owner_earnings: n(d.ownersEarnings),
      owner_eps: n(d.ownersEarningsPerShare),
      growth_capex: n(d.growthCapex),
      maintenance_capex: n(d.maintenanceCapex),
    };
  } catch (e) {
    console.warn(`[FMP] owner-earnings ${symbol}:`, e.message);
    return null;
  }
}
