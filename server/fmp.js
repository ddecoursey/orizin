// Use Node 22's built-in fetch (undici). node-fetch v3 emits an 'error'
// on its response PassThrough when aborted, which crashes the process if
// nothing listens — native fetch propagates AbortError cleanly.
import { logError } from "./logger.js";

const BASE = "https://financialmodelingprep.com/stable";
const KEY = () => process.env.FMP_API_KEY || "";

// ── Simple, concurrency-safe rate limiter for 300 rpm plan ────────────────
// Guarantees we never exceed ~5 calls/sec on average, even with high
// concurrency (10 enrichment workers + many sparklines). Prevents 429 storms.
// Tuned just under the limit for safety margin.
const MIN_INTERVAL_MS = 205; // ~292 rpm max — safe headroom under 300
let _lastCall = 0;

async function rateGate() {
  const now = Date.now();
  const wait = _lastCall + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  _lastCall = Date.now();
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return isFinite(x) ? x : null;
}

// ── Global abort controller for admin "kill all / stop all fetches" ────────
// Allows the debug admin page to abort in-flight FMP calls across background
// enrichment, universe refresh, and user-triggered gathers.
let _masterAbort = new AbortController();

export function abortAllOngoingFetches() {
  try {
    _masterAbort.abort(new DOMException('Admin kill-all', 'AbortError'));
  } catch {}
  _masterAbort = new AbortController();
  console.log('[FMP] Admin kill-all: aborted all ongoing fetches (and background stopped via caller).');
}

function getMasterSignal() {
  return _masterAbort.signal;
}

function combineSignals(...sigs) {
  const signals = sigs.filter(Boolean);
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  const c = new AbortController();
  const doAbort = (reason) => { if (!c.signal.aborted) c.abort(reason); };
  for (const s of signals) {
    if (s.aborted) {
      doAbort(s.reason);
      return c.signal;
    }
    s.addEventListener('abort', () => doAbort(s.reason), { once: true });
  }
  return c.signal;
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
    country: s.country || "",
    price,
    mcap,
    volume: n(s.volume || s.volAvg),
    beta: n(s.beta),
    div_yield: divYield,
    is_etf: s.isEtf || s.isFund ? 1 : 0,
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
    // Also combine with master global abort so admin "kill all" can cancel in-flight work.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const masterSig = getMasterSignal();
    const fetchSignal = combineSignals(timeoutController.signal, masterSig);
    const requestStarted = Date.now();
    try {
      const res = await fetch(url, { signal: fetchSignal });

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
        // Much gentler backoff when doing "retry once then move on" for bulk work
        const base = maxRetries <= 1 ? 150 : 500;
        const delay = Math.min(base * Math.pow(2, attempt), 4000) + Math.random() * 300;
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
        const base = maxRetries <= 1 ? 200 : 500;
        const delay = Math.min(base * Math.pow(2, attempt), 5000) + Math.random() * 400;
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

// ── Fetch stocks via company-screener (preferred for ~8k limit) ────────────
export async function fetchScreenerStocks({
  minMarketCap = 0,
  limit = 8000,
  country = null,           // e.g. "US" for US-headquartered
  exchange = null,          // e.g. "NYSE,NASDAQ,AMEX" for US-listed (incl ADRs)
  isActivelyTrading = true,
  includeEtfsAndFunds = false,  // set true to also pull ETFs/funds (e.g. SPY, QQQ). Many lack full fundamentals.
} = {}) {
  const params = new URLSearchParams({ limit: String(limit), apikey: KEY() });
  if (minMarketCap > 0) params.set("marketCapMoreThan", String(minMarketCap));
  if (country) params.set("country", country);
  if (exchange) params.set("exchange", exchange);
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
      `[FMP] company-screener gave ${data.length} raw → ${rows.length} after filters (minMcap=${minMarketCap || "none"}${country ? `,country=${country}` : ""}${exchange ? `,exchange=${exchange}` : ""})`,
    );
    return rows;
  } catch (e) {
    console.warn("[FMP] company-screener failed:", e.message);
    return [];
  }
}

// ── Stable list endpoints (preferred for complete universe: all stocks + all ETFs, no mcap floor) ─
export async function fetchStockListStable() {
  const url = `${BASE}/stock-list?apikey=${KEY()}`;
  // Use fetchWithRetry for built-in rateGate, 429 backoff, proper abort timeouts, and logging.
  // Bulk list endpoints can transiently 429/ fail under dev load (bg job + sparklines); retries make
  // Universe Refresh reliable instead of immediately falling back to the old 8k screener.
  const data = await fetchWithRetry(url, 3, 60000);
  if (!data) {
    throw new Error("FMP stock-list: exhausted retries (no data)");
  }
  if (data && data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }
  if (!Array.isArray(data)) {
    console.warn("[FMP] stable/stock-list unexpected non-array response");
    throw new Error("Unexpected response from stock-list");
  }
  return data
    .filter((s) => s && s.symbol)
    .map((s) => ({ symbol: s.symbol, name: s.companyName || s.name || s.symbol }));
}

export async function fetchETFListStable() {
  const url = `${BASE}/etf-list?apikey=${KEY()}`;
  const data = await fetchWithRetry(url, 3, 60000);
  if (!data) {
    throw new Error("FMP etf-list: exhausted retries (no data)");
  }
  if (data && data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }
  if (!Array.isArray(data)) {
    console.warn("[FMP] stable/etf-list unexpected non-array response");
    throw new Error("Unexpected response from etf-list");
  }
  return data
    .filter((s) => s && s.symbol)
    .map((s) => ({ symbol: s.symbol, name: s.name || s.companyName || s.symbol }));
}

export async function fetchFullUniverseList() {
  const [stocks, etfs] = await Promise.all([
    fetchStockListStable(),
    fetchETFListStable(),
  ]);
  const merged = new Map();
  for (const item of stocks) {
    if (item.symbol && !merged.has(item.symbol)) {
      merged.set(item.symbol, { symbol: item.symbol, name: item.name, is_etf: 0 });
    }
  }
  for (const item of etfs) {
    if (item.symbol && !merged.has(item.symbol)) {
      merged.set(item.symbol, { symbol: item.symbol, name: item.name, is_etf: 1 });
    }
  }
  const list = Array.from(merged.values());
  console.log(`[FMP] stable lists: ${stocks.length} stocks + ${etfs.length} etfs → ${list.length} unique`);
  return list;
}

// ── Fetch broad stock list (symbols only, for backward compat) ──────────────
// Now uses stable stock+etf lists (full universe, no floor).
export async function fetchStockList() {
  try {
    const items = await fetchFullUniverseList();
    if (items && items.length) return items.map((r) => r.symbol);
  } catch (e) {
    console.warn("[FMP] full universe from stable lists failed, trying old fallback:", e.message);
  }

  // Last-resort fallback (old /stock/list)
  const url = `${BASE}/stock/list?apikey=${KEY()}`;
  try {
    // Use fetchWithRetry so it respects rateGate, retries, and global admin abort signal.
    const data = await fetchWithRetry(url, 2, 30000);
    if (!data) throw new Error('FMP stock/list: no data');
    if (!Array.isArray(data)) return null;
    const cand = data
      .filter((s) => s.symbol && s.type === "stock")
      .map((s) => s.symbol);
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
export async function fetchProfile(symbol, opts = {}) {
  const url = `${BASE}/profile?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 6, opts.timeoutMs ?? 15000);
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
    country: prof.country || "",
    price: n(prof.price),
    mcap: n(prof.marketCap || prof.mktCap),
    volume: n(prof.volAvg || prof.volume),
    beta: n(prof.beta),
    div_yield: divYield,
    is_etf: prof.isEtf || prof.isFund ? 1 : 0,
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

// ── Fetch full universe rows using stable lists (for refresh) ──────────────
// Tries BOTH stock-list and etf-list (under /stable base), merges unique symbols.
// Returns basic rows with symbol+name (no expensive per-symbol profiles to avoid
// rate limits). price/mcap/sector/industry etc. are populated later by gather
// (force path) and the continuous background job.
export async function fetchUniverseRows(onProgress) {
  const listItems = await fetchFullUniverseList();
  if (!listItems.length) return [];

  // Return basic rows from the lists (symbol + name).
  console.log(`[FMP] universe from stable lists: ${listItems.length} symbols (basics only)`);
  return listItems.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    sector: "—",
    industry: "—",
    exchange: "",
    country: "",
    price: null,
    mcap: null,
    volume: null,
    beta: null,
    div_yield: null,
    is_etf: item.is_etf ? 1 : 0,
    updated_at: Date.now(),
  }));
}

// ── Fetch ETFs + funds via company-screener (for the "keep ETFs, don't enrich" mode) ─
// Two calls (isEtf=true, isFund=true) merged. Returns screener rows tagged is_etf=1
// with whatever price/mcap FMP provides — they're listed for reference but never
// run through key-metrics/ratios enrichment.
export async function fetchEtfsFunds({ country = null, exchange = null, limit = 12000 } = {}) {
  async function call(kindParam) {
    const params = new URLSearchParams({ limit: String(limit), apikey: KEY() });
    params.set(kindParam, "true");
    params.set("isActivelyTrading", "true");
    if (country) params.set("country", country);
    if (exchange) params.set("exchange", exchange);
    const url = `${BASE}/company-screener?${params.toString()}`;
    try {
      const data = await fetchWithRetry(url, 3, 90000);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn(`[FMP] company-screener ${kindParam}=true failed:`, e.message);
      return [];
    }
  }
  const [etfs, funds] = await Promise.all([call("isEtf"), call("isFund")]);
  const seen = new Set();
  const rows = [];
  for (const s of [...etfs, ...funds]) {
    if (!s?.symbol || seen.has(s.symbol)) continue;
    seen.add(s.symbol);
    // Force is_etf=1 — these came from the ETF/fund screener regardless of whether
    // the row echoes the flag back.
    rows.push({ ...screenerToRow(s), is_etf: 1 });
  }
  console.log(`[FMP] screener ETFs+funds: ${etfs.length}+${funds.length} raw → ${rows.length} unique`);
  return rows;
}

// ── Key metrics TTM (fast, 1 call/stock) ───────────────────────────────────
export async function fetchKeyMetrics(symbol, opts = {}) {
  const url = `${BASE}/key-metrics-ttm?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 6, opts.timeoutMs ?? 15000);
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

    const result = {
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

    // FMP sometimes returns a row with every fundamental null (ETFs, funds, and
    // other non-operating instruments). Treat that as "no data" rather than saving
    // it — otherwise the caller sets has_km=1 and the UI shows an "enriched" dot on
    // a stock whose metrics are all blank.
    const meaningfulKm = [
      result.roic, result.roe, result.roa, result.ev_ebitda, result.ev_sales,
      result.fcf_yield, result.earnings_yield, result.net_debt_ebitda,
      result.current_ratio, result.pe, result.pb,
    ];
    if (meaningfulKm.every((v) => v == null)) return null;

    return result;
  } catch (e) {
    const msg = `[FMP] key-metrics-ttm ${symbol}: ${e.message}`;
    console.warn(msg);
    // Don't pollute the debug error log with expected rate-limit noise during bulk work
    if (!e.message?.includes('429')) {
      logError(msg, { symbol, endpoint: 'key-metrics-ttm' });
    }
    return null;
  }
}

// ── Ratios TTM (gross/op margin, D/E, EV/GP) ─────────────────────────────
export async function fetchRatios(symbol, opts = {}) {
  const url = `${BASE}/ratios-ttm?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 6, opts.timeoutMs ?? 15000);
    const rat = Array.isArray(data) ? data[0] : data;
    if (!rat || typeof rat !== "object") return null;

    const result = {
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

    // Same guard as key-metrics: an all-null ratios row means "no fundamentals",
    // so don't let it flip has_rat=1 with nothing to show.
    const meaningfulRat = [
      result.gross_margin, result.op_margin, result.pe, result.pb, result.ps,
      result.debt_equity, result.roe,
    ];
    if (meaningfulRat.every((v) => v == null)) return null;

    return result;
  } catch (e) {
    const msg = `[FMP] ratios-ttm ${symbol}: ${e.message}`;
    console.warn(msg);
    if (!e.message?.includes('429')) {
      logError(msg, { symbol, endpoint: 'ratios-ttm' });
    }
    return null;
  }
}

// ── AI enrichment fetchers (on-demand, not bulk) ──────────────────────────

export async function fetchDCF(symbol, opts = {}) {
  const url = `${BASE}/discounted-cash-flow?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 6, opts.timeoutMs ?? 15000);
    const d = Array.isArray(data) ? data[0] : data;
    if (!d) return null;
    return {
      dcf: n(d.dcf),
      stock_price: n(d["Stock Price"]),
      dcf_date: d.date || null,
    };
  } catch (e) {
    console.warn(`[FMP] dcf ${symbol}:`, e.message);
    if (!e.message?.includes('429')) {
      logError(`[FMP] dcf ${symbol}: ${e.message}`, { symbol, endpoint: 'dcf' });
    }
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

export async function fetchFinancialGrowth(symbol, opts = {}) {
  const url = `${BASE}/financial-growth?symbol=${symbol}&limit=1&period=annual&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 6, opts.timeoutMs ?? 15000);
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
    if (!e.message?.includes('429')) {
      logError(`[FMP] financial-growth ${symbol}: ${e.message}`, { symbol, endpoint: 'financial-growth' });
    }
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

// RSI technical indicator (momentum oscillator, 0–100) for the detail chart.
// Returns [{ date: 'YYYY-MM-DD', rsi }] sorted oldest → newest.
export async function fetchRSI(symbol, { periodLength = 14, timeframe = "1day" } = {}) {
  const url = `${BASE}/technical-indicators/rsi?symbol=${symbol}&periodLength=${periodLength}&timeframe=${timeframe}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data)) return [];
    return data
      .map((d) => ({
        date: typeof d.date === "string" ? d.date.split(" ")[0] : d.date,
        rsi: n(d.rsi),
      }))
      .filter((d) => d.rsi != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  } catch (e) {
    console.warn(`[FMP] rsi ${symbol}:`, e.message);
    return [];
  }
}

// Ratings snapshot: letter grade + 1–5 sub-scores across key ratios.
export async function fetchRatingsSnapshot(symbol, opts = {}) {
  const url = `${BASE}/ratings-snapshot?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 3, opts.timeoutMs ?? 12000);
    const r = Array.isArray(data) ? data[0] : data;
    if (!r || typeof r !== "object" || !r.symbol) return null;
    return {
      symbol: r.symbol,
      rating: r.rating ?? null,
      overall_score: n(r.overallScore),
      dcf_score: n(r.discountedCashFlowScore),
      roe_score: n(r.returnOnEquityScore),
      roa_score: n(r.returnOnAssetsScore),
      de_score: n(r.debtToEquityScore),
      pe_score: n(r.priceToEarningsScore),
      pb_score: n(r.priceToBookScore),
    };
  } catch (e) {
    console.warn(`[FMP] ratings-snapshot ${symbol}:`, e.message);
    return null;
  }
}

// Stock grades: recent analyst grading actions (upgrade/downgrade/maintain).
export async function fetchGrades(symbol, { limit = 15 } = {}) {
  const url = `${BASE}/grades?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map((g) => ({
      date: g.date ?? null,
      company: g.gradingCompany ?? null,
      previous_grade: g.previousGrade ?? null,
      new_grade: g.newGrade ?? null,
      action: g.action ?? null,
    }));
  } catch (e) {
    console.warn(`[FMP] grades ${symbol}:`, e.message);
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

// Latest general market news (for the footer ticker + Ori context).
export async function fetchGeneralNews({ limit = 30 } = {}) {
  const url = `${BASE}/news/general-latest?page=0&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 10000);
    if (!Array.isArray(data)) return [];
    return data
      .map((a) => ({
        title: a.title ?? null,
        publisher: a.publisher ?? a.site ?? null,
        site: a.site ?? null,
        url: a.url ?? null,
        image: a.image ?? null,
        symbol: a.symbol ?? null,
        publishedDate: a.publishedDate ?? null,
      }))
      .filter((a) => a.title && a.url);
  } catch (e) {
    console.warn(`[FMP] general-news:`, e.message);
    return [];
  }
}

// Intraday 5-minute price series for the "1D" chart timeframe.
// Returns [{ date, price }] oldest→newest (most-recent session).
export async function fetchIntraday(symbol) {
  const url = `${BASE}/historical-chart/5min?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 10000);
    if (!Array.isArray(data)) return [];
    const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    // Keep only the most recent trading day present in the series.
    const lastDay = sorted.length ? String(sorted[sorted.length - 1].date).slice(0, 10) : null;
    const recent = lastDay ? sorted.filter((d) => String(d.date).slice(0, 10) === lastDay) : sorted;
    return recent
      .map((d) => ({ date: d.date, price: n(d.close ?? d.price) }))
      .filter((d) => d.price != null);
  } catch (e) {
    console.warn(`[FMP] intraday ${symbol}:`, e.message);
    return [];
  }
}

// Latest news for a specific symbol (company news tab).
export async function fetchStockNews(symbol, { limit = 20 } = {}) {
  const url = `${BASE}/news/stock?symbols=${symbol}&page=0&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 10000);
    if (!Array.isArray(data)) return [];
    return data
      .map((a) => ({
        title: a.title ?? null,
        publisher: a.publisher ?? a.site ?? null,
        site: a.site ?? null,
        url: a.url ?? null,
        image: a.image ?? null,
        symbol: a.symbol ?? null,
        text: a.text ?? null,
        publishedDate: a.publishedDate ?? null,
      }))
      .filter((a) => a.title && a.url);
  } catch (e) {
    console.warn(`[FMP] stock-news ${symbol}:`, e.message);
    return [];
  }
}

// Insider trading activity for a symbol (Form 4 buys/sells by executives/directors).
export async function fetchInsiderTrades(symbol, { limit = 40 } = {}) {
  const url = `${BASE}/insider-trading/search?symbol=${symbol}&page=0&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 3, 12000);
    if (!Array.isArray(data)) return [];
    return data.map((t) => ({
      filingDate: t.filingDate ?? null,
      transactionDate: t.transactionDate ?? null,
      reportingName: t.reportingName ?? null,
      typeOfOwner: t.typeOfOwner ?? null,
      transactionType: t.transactionType ?? null,
      // 'A' = acquisition (buy), 'D' = disposition (sell)
      acquisitionOrDisposition: t.acquisitionOrDisposition ?? null,
      securitiesTransacted: n(t.securitiesTransacted),
      price: n(t.price),
      securitiesOwned: n(t.securitiesOwned),
      securityName: t.securityName ?? null,
      url: t.url ?? null,
    }));
  } catch (e) {
    console.warn(`[FMP] insider-trading ${symbol}:`, e.message);
    return [];
  }
}
