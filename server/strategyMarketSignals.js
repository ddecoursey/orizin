import {
  fetchBiggestGainers,
  fetchBiggestLosers,
  fetchHistoricalIndustryPe,
  fetchHistoricalIndustryPerformance,
  fetchHistoricalSectorPe,
  fetchHistoricalSectorPerformance,
} from "./fmp.js";
import { createHash } from "node:crypto";
import { getStockClassifications, kvGet, kvSet } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_TTL_MS = DAY_MS;
const MOVERS_TTL_MS = 10 * 60 * 1000;
const MAX_SIGNAL_AGE_MS = 7 * DAY_MS;
const STALE_SOURCE_RETRY_MS = 7 * DAY_MS;
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const inflight = new Map();
const negativeCache = new Map();

function deferRetry(key, ttlMs) {
  negativeCache.set(key, Date.now() + ttlMs);
  if (negativeCache.size > 500) negativeCache.delete(negativeCache.keys().next().value);
}

function rawSeriesIsStale(data) {
  if (!Array.isArray(data) || !data.length) return false;
  const latest = data.reduce((max, row) => {
    const at = row?.date ? new Date(`${row.date}T23:59:59Z`).getTime() : NaN;
    return Number.isFinite(at) ? Math.max(max, at) : max;
  }, 0);
  return latest > 0 && Date.now() - latest > MAX_SIGNAL_AGE_MS;
}

async function cached(key, ttlMs, loader) {
  const hit = kvGet(key);
  const effectiveTtl = hit && rawSeriesIsStale(hit.data) ? Math.max(ttlMs, STALE_SOURCE_RETRY_MS) : ttlMs;
  if (hit && Date.now() - hit.updatedAt < effectiveTtl) return { data: hit.data, fetchedAt: hit.updatedAt, cache: "hit" };
  if ((negativeCache.get(key) || 0) > Date.now()) {
    return hit
      ? { data: hit.data, fetchedAt: hit.updatedAt, cache: "stale" }
      : { data: [], fetchedAt: Date.now(), cache: "negative" };
  }
  if (inflight.has(key)) return inflight.get(key);
  const request = (async () => {
    const data = await loader();
    if (data?.length || (data && typeof data === "object" && Object.keys(data).length)) {
      negativeCache.delete(key);
      kvSet(key, data);
      return { data, fetchedAt: Date.now(), cache: "miss" };
    }
    deferRetry(key, hit && rawSeriesIsStale(hit.data) ? STALE_SOURCE_RETRY_MS : NEGATIVE_CACHE_TTL_MS);
    if (hit) return { data: hit.data, fetchedAt: hit.updatedAt, cache: "stale" };
    return { data: data || [], fetchedAt: Date.now(), cache: "miss" };
  })().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

function safeKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9.-]+/g, "_").slice(0, 72);
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${slug}:${hash}`;
}

function standardDeviation(values) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function maxDrawdownFromReturns(returns) {
  let value = 1;
  let peak = 1;
  let worst = 0;
  for (const dailyReturn of returns) {
    value *= 1 + dailyReturn;
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

export function summarizePerformanceRows(rows, nowMs = Date.now()) {
  const sorted = (rows || [])
    .filter((row) => row?.date && Number.isFinite(Number(row.averageChange)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!sorted.length) return null;
  const returns = sorted.map((row) => Number(row.averageChange) / 100);
  const latestDate = sorted.at(-1).date;
  const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();
  const ageDays = Number.isFinite(latestMs) ? Math.max(0, (nowMs - latestMs) / DAY_MS) : null;
  return {
    asOf: latestDate,
    observations: returns.length,
    latestReturn: returns.at(-1),
    cumulativeReturn: returns.reduce((value, dailyReturn) => value * (1 + dailyReturn), 1) - 1,
    averageReturn: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    returnStdDev: standardDeviation(returns),
    maxDrawdown: maxDrawdownFromReturns(returns),
    ageDays,
    usable: ageDays != null && ageDays <= MAX_SIGNAL_AGE_MS / DAY_MS,
  };
}

export function summarizePeRows(rows, nowMs = Date.now()) {
  const sorted = (rows || [])
    .filter((row) => row?.date && Number.isFinite(Number(row.pe)) && Number(row.pe) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!sorted.length) return null;
  const values = sorted.map((row) => Number(row.pe));
  const latestDate = sorted.at(-1).date;
  const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();
  const ageDays = Number.isFinite(latestMs) ? Math.max(0, (nowMs - latestMs) / DAY_MS) : null;
  const averagePe = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    asOf: latestDate,
    observations: values.length,
    pe: values.at(-1),
    averagePe,
    peVsAverage: averagePe > 0 ? values.at(-1) / averagePe - 1 : null,
    ageDays,
    usable: ageDays != null && ageDays <= MAX_SIGNAL_AGE_MS / DAY_MS,
  };
}

function addBucket(map, name, side, change) {
  if (!name || name === "—") return;
  const bucket = map[name] || { gainers: 0, losers: 0, gainerChanges: [], loserChanges: [] };
  bucket[side === "gainer" ? "gainers" : "losers"]++;
  bucket[side === "gainer" ? "gainerChanges" : "loserChanges"].push(change);
  map[name] = bucket;
}

function finalizeBuckets(map) {
  return Object.fromEntries(Object.entries(map).map(([name, bucket]) => {
    const total = bucket.gainers + bucket.losers;
    const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return [name, {
      gainerCount: bucket.gainers,
      loserCount: bucket.losers,
      extremeMoverBalance: total ? (bucket.gainers - bucket.losers) / total : 0,
      averageGainerReturn: avg(bucket.gainerChanges),
      averageLoserReturn: avg(bucket.loserChanges),
    }];
  }));
}

export function summarizeMovers(gainers, losers, classifications = []) {
  const classificationMap = new Map(classifications.map((row) => [row.symbol, row]));
  const bySymbol = {};
  const sectors = {};
  const industries = {};
  const consume = (rows, side) => {
    for (const row of rows || []) {
      const classification = classificationMap.get(row.symbol) || {};
      const change = Number(row.changesPercentage) / 100;
      bySymbol[row.symbol] = {
        side,
        return: Number.isFinite(change) ? change : null,
        sector: classification.sector || null,
        industry: classification.industry || null,
      };
      if (Number.isFinite(change)) {
        addBucket(sectors, classification.sector, side, change);
        addBucket(industries, classification.industry, side, change);
      }
    }
  };
  consume(gainers, "gainer");
  consume(losers, "loser");
  return {
    bySymbol,
    sectors: finalizeBuckets(sectors),
    industries: finalizeBuckets(industries),
    counts: { gainers: gainers?.length || 0, losers: losers?.length || 0 },
  };
}

async function loadMovers() {
  const cachedMovers = await cached("market:movers", MOVERS_TTL_MS, async () => {
    const [gainers, losers] = await Promise.all([fetchBiggestGainers(), fetchBiggestLosers()]);
    return gainers.length || losers.length ? { gainers, losers } : null;
  });
  const rows = [...(cachedMovers.data?.gainers || []), ...(cachedMovers.data?.losers || [])];
  const classifications = getStockClassifications(rows.map((row) => row.symbol));
  const summary = summarizeMovers(cachedMovers.data?.gainers || [], cachedMovers.data?.losers || [], classifications);
  const ageMs = Math.max(0, Date.now() - cachedMovers.fetchedAt);
  return {
    ...summary,
    fetchedAt: cachedMovers.fetchedAt,
    cache: cachedMovers.cache,
    ageMinutes: ageMs / (60 * 1000),
    usable: summary.counts.gainers + summary.counts.losers > 0 && ageMs <= DAY_MS,
  };
}

async function loadNamedSeries(kind, names, fetcher, summarizer) {
  const entries = await Promise.all(names.map(async (name) => {
    const result = await cached(`market:${kind}:${safeKey(name)}`, HISTORY_TTL_MS, () => fetcher(name));
    const summary = summarizer(result.data) || { asOf: null, observations: 0, ageDays: null, usable: false };
    return [name, { ...summary, fetchedAt: result.fetchedAt, cache: result.cache }];
  }));
  return Object.fromEntries(entries);
}

export async function getStrategyMarketSignals({ sectors = [], industries = [], families = [] } = {}) {
  const wanted = new Set(families);
  const sectorNames = [...new Set(sectors)].slice(0, 12);
  const industryNames = [...new Set(industries)].slice(0, 8);
  const [sectorPerformance, sectorPe, industryPerformance, industryPe, movers] = await Promise.all([
    wanted.has("sectorPerformance") ? loadNamedSeries("sector-performance", sectorNames, fetchHistoricalSectorPerformance, summarizePerformanceRows) : {},
    wanted.has("sectorPe") ? loadNamedSeries("sector-pe", sectorNames, fetchHistoricalSectorPe, summarizePeRows) : {},
    wanted.has("industryPerformance") ? loadNamedSeries("industry-performance", industryNames, fetchHistoricalIndustryPerformance, summarizePerformanceRows) : {},
    wanted.has("industryPe") ? loadNamedSeries("industry-pe", industryNames, fetchHistoricalIndustryPe, summarizePeRows) : {},
    wanted.has("movers") ? loadMovers() : null,
  ]);
  return {
    generatedAt: Date.now(),
    sectorPerformance,
    sectorPe,
    industryPerformance,
    industryPe,
    movers,
  };
}
