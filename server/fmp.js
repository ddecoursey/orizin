// Use Node 22's built-in fetch (undici). node-fetch v3 emits an 'error'
// on its response PassThrough when aborted, which crashes the process if
// nothing listens — native fetch propagates AbortError cleanly.
import { logError } from "./logger.js";
import { execCompAllowed, markExecCompUnavailable } from "./fmpPlanLimits.js";

const BASE = "https://financialmodelingprep.com/stable";
const KEY = () => process.env.FMP_API_KEY || "";

// ── Simple, concurrency-safe rate limiter ─────────────────────────────────
// Guarantees we never exceed the configured rate on average, even with high
// concurrency (enrichment workers + many sparklines). Prevents 429 storms.
//
// FMP_MAX_RPM caps THIS process. When two environments share one FMP key
// (e.g. QA + prod), set it per env so the SUM stays under your plan's limit —
// e.g. prod=250, QA=40. Defaults to ~292 rpm (just under a 300-rpm plan).
const FMP_MAX_RPM = Math.max(10, parseInt(process.env.FMP_MAX_RPM || '292', 10) || 292);
const MIN_INTERVAL_MS = Math.ceil(60000 / FMP_MAX_RPM); // 292 rpm → ~206ms
let _nextSlot = 0;

// Slot reservation: each caller atomically claims the next free slot BEFORE
// sleeping. The old version read a shared "last call" timestamp and slept,
// which let any number of concurrent callers (enrich workers + sparklines +
// background job) wake at the same instant and burst far past 300 rpm.
async function rateGate() {
  const now = Date.now();
  const target = Math.max(now, _nextSlot);
  _nextSlot = target + MIN_INTERVAL_MS;
  const wait = target - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

// MCP-backed Ori calls share the same Starter-plan rate budget as direct REST
// calls. Export the slot reservation without exposing limiter internals.
export async function waitForFmpRateSlot() {
  await rateGate();
}

// ── FMP call instrumentation ───────────────────────────────────────────────
// Counts every network attempt against the FMP quota, per endpoint and per
// minute, so the debug page can show real usage, 429 pressure, and pace.
const fmpStats = {
  startedAt: Date.now(),
  total: { calls: 0, ok: 0, errors: 0, http429: 0, totalMs: 0 },
  byEndpoint: new Map(), // endpoint -> { calls, ok, errors, http429, totalMs }
  minuteBuckets: [],     // [{ minute, calls, ok, errors, http429 }], newest last
};
const MAX_MINUTE_BUCKETS = 120;

function endpointOf(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/stable\//, "").replace(/^\//, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function recordCall(endpoint, { ok, is429, ms }) {
  const t = fmpStats.total;
  t.calls++;
  t.totalMs += ms;
  if (is429) t.http429++;
  else if (ok) t.ok++;
  else t.errors++;

  let e = fmpStats.byEndpoint.get(endpoint);
  if (!e) {
    e = { calls: 0, ok: 0, errors: 0, http429: 0, totalMs: 0 };
    fmpStats.byEndpoint.set(endpoint, e);
  }
  e.calls++;
  e.totalMs += ms;
  if (is429) e.http429++;
  else if (ok) e.ok++;
  else e.errors++;

  const minute = Math.floor(Date.now() / 60000);
  let b = fmpStats.minuteBuckets[fmpStats.minuteBuckets.length - 1];
  if (!b || b.minute !== minute) {
    b = { minute, calls: 0, ok: 0, errors: 0, http429: 0 };
    fmpStats.minuteBuckets.push(b);
    if (fmpStats.minuteBuckets.length > MAX_MINUTE_BUCKETS) {
      fmpStats.minuteBuckets.splice(0, fmpStats.minuteBuckets.length - MAX_MINUTE_BUCKETS);
    }
  }
  b.calls++;
  if (is429) b.http429++;
  else if (ok) b.ok++;
  else b.errors++;
}

// Keep MCP calls visible in the existing admin FMP statistics.
export function recordExternalFmpCall(endpoint, result) {
  recordCall(`mcp/${endpoint || "unknown"}`, result);
}

export function getFmpStats() {
  const nowMin = Math.floor(Date.now() / 60000);
  const window = (mins) => {
    const cutoff = nowMin - mins;
    let calls = 0, http429 = 0, errors = 0;
    for (const b of fmpStats.minuteBuckets) {
      if (b.minute > cutoff) {
        calls += b.calls;
        http429 += b.http429;
        errors += b.errors;
      }
    }
    return { calls, http429, errors };
  };
  const last1 = window(1);
  const last15 = window(15);
  const last60 = window(60);
  return {
    startedAt: fmpStats.startedAt,
    total: { ...fmpStats.total },
    avgMs: fmpStats.total.calls ? Math.round(fmpStats.total.totalMs / fmpStats.total.calls) : 0,
    rpmNow: last1.calls,
    last15min: last15,
    last60min: last60,
    byEndpoint: [...fmpStats.byEndpoint.entries()]
      .map(([endpoint, s]) => ({
        endpoint,
        ...s,
        avgMs: s.calls ? Math.round(s.totalMs / s.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls),
  };
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
  const endpoint = endpointOf(url);

  // Fail fast when no key is configured — every call would 401 anyway, and
  // this keeps tests/dev-without-keys hermetic (no pointless network round
  // trips, no retry storms).
  if (!KEY()) {
    throw new Error("FMP_API_KEY not configured");
  }

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

      // Read once as text and parse once — the previous clone().json() +
      // res.json() fallback parsed large payloads twice on cache misses.
      const bodyText = await res.text();
      let responseData = null;
      try {
        responseData = JSON.parse(bodyText);
      } catch {
        responseData = null; // non-JSON body — callers treat null as "no data"
      }

      const elapsedMs = Date.now() - requestStarted;
      recordCall(endpoint, { ok: res.ok, is429: res.status === 429, ms: elapsedMs });

      // Only log non-OK responses to the error log. Successful calls would
      // spam Railway's log rate limit (each ratios-ttm response is huge,
      // multiplied by thousands of enrich requests).
      if (!res.ok && res.status !== 429) {
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

      return responseData;

    } catch (e) {
      const msg = e.message || "";
      const aborted = e.name === "AbortError";
      const elapsedMs = Date.now() - requestStarted;
      // HTTP-level failures were already recorded above; only count transport
      // errors (timeout / reset / DNS) here so attempts aren't double-counted.
      if (!msg.startsWith("FMP ")) {
        recordCall(endpoint, { ok: false, is429: false, ms: elapsedMs });
        logError(`[FMP CALL] ${sanitizedUrl}${attemptInfo} FAILED`, {
          error: aborted ? `timeout after ${Math.round(timeoutMs / 1000)}s` : msg,
          ms: elapsedMs,
          attempt: attempt + 1,
        });
      }

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

function screenerPageSize(totalLimit) {
  const configured = parseInt(process.env.FMP_SCREENER_PAGE_SIZE || "1000", 10);
  const pageSize = Number.isFinite(configured) && configured > 0 ? configured : 1000;
  return Math.max(1, Math.min(totalLimit, pageSize, 5000));
}

async function fetchScreenerPages(baseParams, totalLimit, label) {
  const wanted = Math.max(1, Math.floor(Number(totalLimit) || 1));
  const perPage = screenerPageSize(wanted);
  const rows = [];
  const seen = new Set();

  for (let page = 0; rows.length < wanted; page++) {
    const params = new URLSearchParams(baseParams);
    // FMP calculates the page offset from `page * limit`, so the page size must
    // stay constant. Shrinking the final request would overlap earlier rows.
    params.set("limit", String(perPage));
    params.set("page", String(page));
    params.set("apikey", KEY());
    const data = await fetchWithRetry(`${BASE}/company-screener?${params.toString()}`, 3, 90000);
    if (!Array.isArray(data) || !data.length) break;

    let added = 0;
    for (const item of data) {
      const identity = item?.symbol || JSON.stringify(item);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      rows.push(item);
      added++;
      if (rows.length >= wanted) break;
    }

    // A short page is the natural end. A duplicate page means the upstream
    // ignored pagination, so stop instead of looping over the same results.
    if (data.length < perPage || added === 0) break;
  }

  console.log(`[FMP] ${label}: ${rows.length} rows across paged company-screener`);
  return rows;
}

// ── Fetch stocks via company-screener (paged for predictable response sizes) ─
export async function fetchScreenerStocks({
  minMarketCap = 0,
  limit = 8000,
  country = null,           // e.g. "US" for US-headquartered
  exchange = null,          // e.g. "NYSE,NASDAQ,AMEX" for US-listed (incl ADRs)
  isActivelyTrading = true,
  includeEtfsAndFunds = false,  // set true to also pull ETFs/funds (e.g. SPY, QQQ). Many lack full fundamentals.
} = {}) {
  const params = new URLSearchParams();
  if (minMarketCap > 0) params.set("marketCapMoreThan", String(minMarketCap));
  if (country) params.set("country", country);
  if (exchange) params.set("exchange", exchange);
  if (isActivelyTrading) params.set("isActivelyTrading", "true");
  if (!includeEtfsAndFunds) {
    params.set("isEtf", "false");
    params.set("isFund", "false");
  }

  try {
    const data = await fetchScreenerPages(params, limit, "stock screener");
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
    console.warn("[FMP] full universe from stable lists failed, trying screener fallback:", e.message);
  }

  // Last-resort fallback. The old stable/stock/list path is undocumented and
  // now returns 404; use the supported paged screener instead.
  try {
    const rows = await fetchScreenerStocks({
      limit: 8000,
      isActivelyTrading: true,
      includeEtfsAndFunds: false,
    });
    return rows.length ? rows.map((row) => row.symbol).filter(Boolean) : null;
  } catch (e) {
    console.warn("[FMP] company-screener fallback:", e.message);
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
export async function fetchUniverseRows() {
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
    const params = new URLSearchParams();
    params.set(kindParam, "true");
    params.set("isActivelyTrading", "true");
    if (country) params.set("country", country);
    if (exchange) params.set("exchange", exchange);
    try {
      return await fetchScreenerPages(params, limit, `${kindParam}=true`);
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

function mapGrowthRow(d) {
  return {
    date: d.date ?? null,
    fiscalYear: d.fiscalYear ?? d.calendarYear ?? null,
    revenue_growth: n(d.revenueGrowth),
    eps_growth: n(d.epsgrowth ?? d.epsGrowth),
    fcf_growth: n(d.freeCashFlowGrowth),
    op_income_growth: n(d.operatingIncomeGrowth),
    net_income_growth: n(d.netIncomeGrowth),
    gross_profit_growth: n(d.grossProfitGrowth),
  };
}

// Single FMP pull for financial-growth; higher limits subsume limit=1 TTM fields.
export async function fetchFinancialGrowthRows(symbol, { limit = 6 } = {}, opts = {}) {
  const url = `${BASE}/financial-growth?symbol=${symbol}&period=annual&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 2, opts.timeoutMs ?? 12000);
    if (!Array.isArray(data)) return [];
    return data.map(mapGrowthRow);
  } catch (e) {
    console.warn(`[FMP] financial-growth ${symbol}:`, e.message);
    if (!e.message?.includes('429')) {
      logError(`[FMP] financial-growth ${symbol}: ${e.message}`, { symbol, endpoint: 'financial-growth' });
    }
    return [];
  }
}

export async function fetchFinancialGrowth(symbol, opts = {}) {
  const rows = await fetchFinancialGrowthRows(symbol, { limit: 1 }, opts);
  const d = rows[0];
  if (!d) return null;
  return {
    revenue_growth: d.revenue_growth,
    net_income_growth: d.net_income_growth,
    eps_growth: d.eps_growth,
    fcf_growth: d.fcf_growth,
    op_income_growth: d.op_income_growth,
    gross_profit_growth: d.gross_profit_growth,
  };
}

// Lightweight historical EOD prices for sparklines
export async function fetchHistoricalPricesLight(symbol, days = 45) {
  const url = `${BASE}/historical-price-eod/light?symbol=${symbol}&apikey=${KEY()}`;

  try {
    const data = await fetchWithRetry(url);
    if (!Array.isArray(data)) return [];

    // FMP light returns newest first usually
    const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
    const recent = sorted.slice(-days);

    return recent
      .map((d) => ({ date: d.date, price: n(d.price) }))
      .filter((d) => d.price != null);
  } catch (e) {
    console.warn(`[FMP] historical light ${symbol}:`, e.message);
    return [];
  }
}

// Lightweight real-time quote — 1 small call per symbol. Used by the
// market-hours price refresher to keep price/volume/mcap current through the
// trading day without re-pulling the whole profile.
export async function fetchQuote(symbol, opts = {}) {
  const url = `${BASE}/quote?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, opts.maxRetries ?? 1, opts.timeoutMs ?? 9000);
    const q = Array.isArray(data) ? data[0] : data;
    if (!q || typeof q !== "object" || !q.symbol) return null;
    return {
      symbol: q.symbol,
      price: n(q.price),
      volume: n(q.volume),
      mcap: n(q.marketCap),
      change_pct: n(q.changePercentage ?? q.changesPercentage),
    };
  } catch (e) {
    console.warn(`[FMP] quote ${symbol}:`, e.message);
    return null;
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

// Latest value of any technical indicator: sma, ema, wma, dema, tema, rsi, adx,
// williams, standarddeviation. Returns { value, close, date } or null. The value
// field is named after the indicator (standarddeviation → "standardDeviation").
export async function fetchIndicatorLatest(symbol, indicator, periodLength, timeframe = "1day") {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `${BASE}/technical-indicators/${indicator}?symbol=${encodeURIComponent(symbol)}&periodLength=${periodLength}&timeframe=${timeframe}&from=${from}&to=${to}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data) || !data.length) return null;
    const key = indicator === "standarddeviation" ? "standardDeviation" : indicator;
    // FMP order isn't guaranteed; take the most recent date without sorting.
    const latest = data.reduce((best, row) =>
      !best || new Date(row?.date) > new Date(best?.date) ? row : best, null);
    const value = n(latest?.[key]);
    if (value == null) return null;
    return {
      value,
      close: n(latest.close),
      date: typeof latest.date === "string" ? latest.date.split(" ")[0] : latest.date,
    };
  } catch (e) {
    console.warn(`[FMP] ${indicator} ${symbol}:`, e.message);
    return null;
  }
}

// Earnings calendar for a symbol: the upcoming report date (null actuals) plus
// recent quarters with EPS/revenue actual vs estimate. Newest first.
export async function fetchEarnings(symbol, { limit = 10 } = {}) {
  const url = `${BASE}/earnings?symbol=${encodeURIComponent(symbol)}&limit=${limit}&includeReportTimes=true&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data
      .map((d) => ({
        date: typeof d.date === "string" ? d.date.split(" ")[0] : d.date,
        epsActual: n(d.epsActual),
        epsEstimated: n(d.epsEstimated),
        revenueActual: n(d.revenueActual),
        revenueEstimated: n(d.revenueEstimated),
        time: d.time ?? null,
        periodEnding: typeof d.periodEnding === "string" ? d.periodEnding.split(" ")[0] : d.periodEnding ?? null,
        fiscalPeriod: d.fiscalPeriod ?? null,
        fiscalYear: n(d.fiscalYear),
        confirmed: typeof d.confirmed === "boolean" ? d.confirmed : null,
        lastUpdated: typeof d.lastUpdated === "string" ? d.lastUpdated.split(" ")[0] : d.lastUpdated ?? null,
      }))
      .filter((d) => d.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (e) {
    console.warn(`[FMP] earnings ${symbol}:`, e.message);
    return [];
  }
}

// Congressional trades for a symbol. chamber = 'senate' | 'house'.
export async function fetchCongressTrades(chamber, symbol, { limit = 80 } = {}) {
  const url = `${BASE}/${chamber}-trades?symbol=${encodeURIComponent(symbol)}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map((d) => ({
      chamber,
      transactionDate: typeof d.transactionDate === "string" ? d.transactionDate.split(" ")[0] : d.transactionDate,
      name: `${d.firstName || ""} ${d.lastName || ""}`.trim() || d.office || "—",
      district: d.district || null,
      type: d.type || null,
      amount: d.amount || null,
      senateId: d.senateID ?? null,
      houseId: d.houseID ?? null,
    }));
  } catch (e) {
    console.warn(`[FMP] ${chamber}-trades ${symbol}:`, e.message);
    return [];
  }
}

// Shared insider-trading/search fetch — one call serves both route formats.
async function fetchInsiderRaw(symbol, { limit = 80 } = {}) {
  const url = `${BASE}/insider-trading/search?symbol=${encodeURIComponent(symbol)}&page=0&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`[FMP] insider ${symbol}:`, e.message);
    return [];
  }
}

// Insider (Form 4) trades for a symbol — smart-money rollup format.
export async function fetchInsiderBySymbol(symbol, { limit = 80 } = {}) {
  const data = await fetchInsiderRaw(symbol, { limit });
  return data.map((d) => ({
    transactionDate: typeof d.transactionDate === "string" ? d.transactionDate.split(" ")[0] : d.transactionDate,
    name: d.reportingName || "—",
    role: d.typeOfOwner || null,
    transactionType: d.transactionType || null,
    shares: n(d.securitiesTransacted),
    price: n(d.price),
  }));
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

// ── Deep Research fetchers (statements, filings, comp, peers, growth) ──────
// All trimmed to the fields the Deep Research page renders, with `??`
// fallbacks for FMP's occasional field-name drift, and [] on any failure so
// the page degrades to its placeholder instead of erroring.

export async function fetchIncomeStatements(symbol, { period = "annual", limit = 5 } = {}) {
  const url = `${BASE}/income-statement?symbol=${symbol}&period=${period}&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data.map((d) => ({
      date: d.date ?? null,
      fiscalYear: d.fiscalYear ?? d.calendarYear ?? null,
      revenue: n(d.revenue),
      gross_profit: n(d.grossProfit),
      operating_income: n(d.operatingIncome),
      net_income: n(d.netIncome),
      eps: n(d.epsDiluted ?? d.epsdiluted ?? d.eps),
      ebitda: n(d.ebitda),
    }));
  } catch (e) {
    console.warn(`[FMP] income-statement ${symbol}:`, e.message);
    return [];
  }
}

export async function fetchBalanceSheets(symbol, { period = "annual", limit = 5 } = {}) {
  const url = `${BASE}/balance-sheet-statement?symbol=${symbol}&period=${period}&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data.map((d) => ({
      date: d.date ?? null,
      fiscalYear: d.fiscalYear ?? d.calendarYear ?? null,
      cash_and_st_investments: n(d.cashAndShortTermInvestments ?? d.cashAndCashEquivalents),
      total_assets: n(d.totalAssets),
      total_debt: n(d.totalDebt),
      net_debt: n(d.netDebt),
      total_liabilities: n(d.totalLiabilities),
      total_equity: n(d.totalStockholdersEquity ?? d.totalEquity),
    }));
  } catch (e) {
    console.warn(`[FMP] balance-sheet ${symbol}:`, e.message);
    return [];
  }
}

export async function fetchCashFlows(symbol, { period = "annual", limit = 5 } = {}) {
  const url = `${BASE}/cash-flow-statement?symbol=${symbol}&period=${period}&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data.map((d) => ({
      date: d.date ?? null,
      fiscalYear: d.fiscalYear ?? d.calendarYear ?? null,
      operating_cash_flow: n(d.operatingCashFlow ?? d.netCashProvidedByOperatingActivities),
      capex: n(d.capitalExpenditure),
      free_cash_flow: n(d.freeCashFlow),
      dividends_paid: n(d.commonDividendsPaid ?? d.dividendsPaid),
      net_change_in_cash: n(d.netChangeInCash),
    }));
  } catch (e) {
    console.warn(`[FMP] cash-flow ${symbol}:`, e.message);
    return [];
  }
}

// Recent SEC filings (10-K / 10-Q / 8-K / …) with links to the documents.
export async function fetchSecFilings(symbol, { limit = 20 } = {}) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 548 * 24 * 3600 * 1000).toISOString().slice(0, 10); // ~18 months
  const url = `${BASE}/sec-filings-search/symbol?symbol=${symbol}&from=${from}&to=${to}&page=0&limit=${limit}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map((f) => ({
      date: (f.filingDate ?? f.filedDate ?? f.acceptedDate ?? "").slice(0, 10) || null,
      form: f.formType ?? f.type ?? null,
      link: f.finalLink ?? f.link ?? null,
    })).filter((f) => f.form);
  } catch (e) {
    console.warn(`[FMP] sec-filings ${symbol}:`, e.message);
    return [];
  }
}

// Named-executive compensation (latest reported years).
export async function fetchExecutiveCompensation(symbol, { limit = 12 } = {}) {
  const sym = String(symbol || "").toUpperCase();
  if (!execCompAllowed(sym)) return [];

  const url = `${BASE}/governance-executive-compensation?symbol=${sym}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data
      .map((c) => ({
        name: c.nameAndPosition ?? c.name ?? null,
        year: n(c.year),
        salary: n(c.salary),
        bonus: n(c.bonus),
        stock_awards: n(c.stockAward ?? c.stock_awards),
        total: n(c.total),
      }))
      .filter((c) => c.name)
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, limit);
  } catch (e) {
    // 402 = plan doesn't include this symbol/endpoint — expected on gated plans.
    if (String(e.message || "").includes("402")) {
      markExecCompUnavailable(sym);
    } else {
      console.warn(`[FMP] exec-comp ${sym}:`, e.message);
    }
    return [];
  }
}

// Closest sector/size peers, for the side-by-side comparison panel.
export async function fetchStockPeers(symbol) {
  const url = `${BASE}/stock-peers?symbol=${symbol}&apikey=${KEY()}`;
  try {
    const data = await fetchWithRetry(url, 2, 12000);
    if (!Array.isArray(data)) return [];
    return data
      .map((p) => ({
        symbol: p.symbol ?? null,
        name: p.companyName ?? p.name ?? null,
        price: n(p.price),
        mcap: n(p.mktCap ?? p.marketCap),
      }))
      .filter((p) => p.symbol && p.symbol !== symbol)
      .slice(0, 12);
  } catch (e) {
    console.warn(`[FMP] stock-peers ${symbol}:`, e.message);
    return [];
  }
}

// Multi-year growth rates (revenue / EPS / FCF / op income), newest first.
export async function fetchGrowthHistory(symbol, { limit = 6 } = {}) {
  return fetchFinancialGrowthRows(symbol, { limit });
}

// Insider trading activity for a symbol (Form 4 buys/sells by executives/directors).
export async function fetchInsiderTrades(symbol, { limit = 40 } = {}) {
  const data = await fetchInsiderRaw(symbol, { limit: Math.max(limit, 80) });
  return data.slice(0, limit).map((t) => ({
    filingDate: t.filingDate ?? null,
    transactionDate: t.transactionDate ?? null,
    reportingName: t.reportingName ?? null,
    typeOfOwner: t.typeOfOwner ?? null,
    transactionType: t.transactionType ?? null,
    acquisitionOrDisposition: t.acquisitionOrDisposition ?? null,
    securitiesTransacted: n(t.securitiesTransacted),
    price: n(t.price),
    securitiesOwned: n(t.securitiesOwned),
    securityName: t.securityName ?? null,
    url: t.url ?? null,
  }));
}

// ── Market context for Strategies ──────────────────────────────────────────
// Starter currently exposes the historical sector/industry and mover endpoints,
// but not dated snapshots. Keep these wrappers narrow and normalized so callers
// never depend on FMP response drift or leak the API key into browser requests.

async function fetchMarketArray(endpoint, params = {}, label = endpoint) {
  const query = new URLSearchParams({ ...params, apikey: KEY() });
  const url = `${BASE}/${endpoint}?${query.toString()}`;
  try {
    const data = await fetchWithRetry(url, 1, 12000);
    if (!Array.isArray(data)) return [];
    return data;
  } catch (e) {
    console.warn(`[FMP] ${label}:`, e.message);
    return [];
  }
}

export async function fetchHistoricalSectorPerformance(sector) {
  const data = await fetchMarketArray("historical-sector-performance", { sector }, `sector-performance ${sector}`);
  return data.map((row) => ({
    date: row.date ?? null,
    sector: row.sector ?? sector,
    exchange: row.exchange ?? null,
    averageChange: n(row.averageChange),
  })).filter((row) => row.date && row.averageChange != null);
}

export async function fetchHistoricalIndustryPerformance(industry) {
  const data = await fetchMarketArray("historical-industry-performance", { industry }, `industry-performance ${industry}`);
  return data.map((row) => ({
    date: row.date ?? null,
    industry: row.industry ?? industry,
    exchange: row.exchange ?? null,
    averageChange: n(row.averageChange),
  })).filter((row) => row.date && row.averageChange != null);
}

export async function fetchHistoricalSectorPe(sector) {
  const data = await fetchMarketArray("historical-sector-pe", { sector }, `sector-pe ${sector}`);
  return data.map((row) => ({
    date: row.date ?? null,
    sector: row.sector ?? sector,
    exchange: row.exchange ?? null,
    pe: n(row.pe),
  })).filter((row) => row.date && row.pe != null);
}

export async function fetchHistoricalIndustryPe(industry) {
  const data = await fetchMarketArray("historical-industry-pe", { industry }, `industry-pe ${industry}`);
  return data.map((row) => ({
    date: row.date ?? null,
    industry: row.industry ?? industry,
    exchange: row.exchange ?? null,
    pe: n(row.pe),
  })).filter((row) => row.date && row.pe != null);
}

function normalizeMover(row) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return null;
  return {
    symbol,
    name: String(row.name || symbol).slice(0, 160),
    price: n(row.price),
    change: n(row.change),
    changesPercentage: n(row.changesPercentage),
    exchange: row.exchange ?? null,
  };
}

export async function fetchBiggestGainers() {
  const data = await fetchMarketArray("biggest-gainers", {}, "biggest-gainers");
  return data.map(normalizeMover).filter(Boolean).slice(0, 50);
}

export async function fetchBiggestLosers() {
  const data = await fetchMarketArray("biggest-losers", {}, "biggest-losers");
  return data.map(normalizeMover).filter(Boolean).slice(0, 50);
}
