import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchUserSettings, patchUserSettings } from "../lib/userStore.js";
import {
  buildTargetAllocations,
  calculateIndicators,
  evaluateAllocationBranches,
  evaluateStock,
  explainRule,
  formatStrategyMetricValue,
  makeActivity,
  nextRunDate,
  normalizeStrategy,
  paperAccountValue,
  rebalancePaperAccount,
  selectCandidates,
  STRATEGY_SYMBOL_CONTEXT,
  STRATEGY_METRICS,
  strategyDataRequirements,
} from "../lib/strategies.js";

function localKey(user) {
  return `strategies:${user || "default"}`;
}

function activeKey(user) {
  return `activeStrategy:${user || "default"}`;
}

function readLocal(user) {
  try {
    const value = JSON.parse(localStorage.getItem(localKey(user)) || "[]");
    return Array.isArray(value) ? value.map(normalizeStrategy).slice(0, 20) : [];
  } catch {
    return [];
  }
}

const LEGACY_TECHNICAL_METRICS = new Set(["current_price", "rsi14", "momentum90", "price_above_sma200"]);
const PRICE_HISTORY_TTL_MS = 15 * 60 * 1000;
const CURRENT_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const priceHistoryCache = new Map();
const priceHistoryInflight = new Map();

function freshStockPrice(stock) {
  const price = Number(stock?.price);
  const updatedAt = Number(stock?.price_updated_at);
  return price > 0 && Number.isFinite(updatedAt) && Date.now() - updatedAt <= CURRENT_PRICE_MAX_AGE_MS ? price : undefined;
}

async function fetchIndicators(symbol, lookbacks = [], days = 365) {
  try {
    const cacheKey = `${symbol}:${days}`;
    const cached = priceHistoryCache.get(cacheKey);
    let prices;
    if (cached && Date.now() - cached.at < PRICE_HISTORY_TTL_MS) {
      prices = cached.prices;
    } else {
      let request = priceHistoryInflight.get(cacheKey);
      if (!request) {
        request = fetch(`/api/stocks/sparkline/${encodeURIComponent(symbol)}?days=${days}&maxAgeHours=24`)
          .then(async (response) => response.ok ? (await response.json()).prices || [] : [])
          .finally(() => priceHistoryInflight.delete(cacheKey));
        priceHistoryInflight.set(cacheKey, request);
      }
      prices = await request;
      if (prices.length) {
        priceHistoryCache.set(cacheKey, { at: Date.now(), prices });
        if (priceHistoryCache.size > 100) priceHistoryCache.delete(priceHistoryCache.keys().next().value);
      }
    }
    return calculateIndicators(prices, { lookbacks });
  } catch {
    return {};
  }
}

export async function mapWithConcurrency(items, limit, mapper) {
  const rows = Array.from(items || []);
  if (!rows.length) return [];
  const results = new Array(rows.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await mapper(rows[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), rows.length) }, worker));
  return results;
}

async function fetchMarketSignals(universe, families) {
  if (!families.length) return {};
  try {
    const response = await fetch("/api/strategies/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        families,
        sectors: [...new Set(universe.map((stock) => stock.sector).filter(Boolean))],
        industries: [...new Set(universe.map((stock) => stock.industry).filter(Boolean))],
      }),
    });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

function signalStatus(context) {
  const rows = [];
  for (const [family, entries] of Object.entries({
    sectorPerformance: context.sectorPerformance,
    sectorPe: context.sectorPe,
    industryPerformance: context.industryPerformance,
    industryPe: context.industryPe,
  })) {
    for (const [name, summary] of Object.entries(entries || {})) {
      rows.push({ family, name, asOf: summary.asOf, usable: summary.usable, ageDays: summary.ageDays });
    }
  }
  if (context.movers) rows.push({
    family: "movers",
    name: "Biggest gainers and losers",
    asOf: Number.isFinite(Number(context.movers.fetchedAt)) ? new Date(context.movers.fetchedAt).toISOString() : null,
    usable: Boolean(context.movers.usable),
    ageDays: Number.isFinite(Number(context.movers.ageMinutes)) ? context.movers.ageMinutes / (24 * 60) : null,
  });
  return rows.slice(0, 30);
}

function allocationPolicyReason(candidate) {
  const checks = candidate.strategyAllocationPolicy?.checks || [];
  return checks
    .filter((check) => check.passed)
    .map((check) => `${check.rule.label || explainRule(check.rule)} (actual ${formatStrategyMetricValue(check.rule.metric, check.value)})`)
    .join("; ");
}

export function useStrategies(currentUser, stocks = [], canUseOri = false) {
  const user = currentUser || "default";
  const [strategies, setStrategies] = useState(() => readLocal(user));
  const [activeStrategyId, setActiveStrategyIdRaw] = useState(() => {
    try { return localStorage.getItem(activeKey(user)); } catch { return null; }
  });
  const [hydrated, setHydrated] = useState(false);
  const [runningIds, setRunningIds] = useState(() => new Set());
  const runningIdsRef = useRef(new Map());
  const userRef = useRef(user);
  const strategiesRef = useRef(strategies);

  useEffect(() => { strategiesRef.current = strategies; }, [strategies]);
  useEffect(() => {
    const runningLocks = runningIdsRef.current;
    userRef.current = user;
    return () => {
      if (userRef.current === user) userRef.current = null;
      runningLocks.clear();
    };
  }, [user]);

  useEffect(() => {
    let mounted = true;
    const localStrategies = readLocal(user);
    let localActiveId = null;
    try { localActiveId = localStorage.getItem(activeKey(user)); } catch {}
    setHydrated(false);
    setStrategies(localStrategies);
    strategiesRef.current = localStrategies;
    setActiveStrategyIdRaw(localActiveId);
    runningIdsRef.current.clear();
    setRunningIds(new Set());
    fetchUserSettings().then((settings) => {
      if (!mounted) return;
      if (Array.isArray(settings.strategies)) {
        const next = settings.strategies.map(normalizeStrategy).slice(0, 20);
        setStrategies(next);
        strategiesRef.current = next;
        try { localStorage.setItem(localKey(user), JSON.stringify(next)); } catch {}
      }
      if (typeof settings.activeStrategyId === "string") {
        setActiveStrategyIdRaw(settings.activeStrategyId);
        try { localStorage.setItem(activeKey(user), settings.activeStrategyId); } catch {}
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { mounted = false; };
  }, [user]);

  const persist = useCallback((next) => {
    const normalized = next.map(normalizeStrategy).slice(0, 20);
    strategiesRef.current = normalized;
    setStrategies(normalized);
    try { localStorage.setItem(localKey(user), JSON.stringify(normalized)); } catch {}
    patchUserSettings({ strategies: normalized });
    return normalized;
  }, [user]);

  const setActiveStrategyId = useCallback((strategyId) => {
    const value = strategyId || "";
    setActiveStrategyIdRaw(value || null);
    try {
      if (value) localStorage.setItem(activeKey(user), value);
      else localStorage.removeItem(activeKey(user));
    } catch {}
    patchUserSettings({ activeStrategyId: value });
  }, [user]);

  const addStrategy = useCallback((strategy) => {
    const normalized = normalizeStrategy(strategy);
    if (!strategiesRef.current.some((item) => item.id === normalized.id) && strategiesRef.current.length >= 20) return null;
    persist([normalized, ...strategiesRef.current.filter((item) => item.id !== normalized.id)]);
    setActiveStrategyId(normalized.id);
    return normalized.id;
  }, [persist, setActiveStrategyId]);

  const updateStrategy = useCallback((strategyId, updates) => {
    const next = strategiesRef.current.map((strategy) => {
      if (strategy.id !== strategyId) return strategy;
      const patch = typeof updates === "function" ? updates(strategy) : updates;
      return normalizeStrategy({ ...strategy, ...patch, updatedAt: new Date().toISOString() });
    });
    persist(next);
  }, [persist]);

  const replaceStrategy = useCallback((strategy) => {
    const existing = strategiesRef.current.find((item) => item.id === strategy.id);
    const scheduleChanged = existing?.limits?.rebalance !== strategy?.limits?.rebalance;
    const monitoring = strategy.status === "monitoring";
    const normalized = normalizeStrategy({
      ...strategy,
      updatedAt: new Date().toISOString(),
      nextRunAt: monitoring
        ? (scheduleChanged || !strategy.nextRunAt ? nextRunDate(strategy.limits?.rebalance) : strategy.nextRunAt)
        : null,
    });
    persist(strategiesRef.current.map((item) => item.id === normalized.id ? normalized : item));
  }, [persist]);

  const deleteStrategy = useCallback((strategyId) => {
    const next = strategiesRef.current.filter((strategy) => strategy.id !== strategyId);
    persist(next);
    if (activeStrategyId === strategyId) setActiveStrategyId(next[0]?.id || null);
  }, [activeStrategyId, persist, setActiveStrategyId]);

  const runStrategy = useCallback(async (strategyId, { trigger = "manual" } = {}) => {
    const strategy = strategiesRef.current.find((item) => item.id === strategyId);
    if (!strategy || runningIdsRef.current.has(strategyId)) return null;
    const runToken = Symbol(strategyId);
    const runUser = user;
    runningIdsRef.current.set(strategyId, runToken);
    setRunningIds(new Set(runningIdsRef.current.keys()));

    try {
      const stockBySymbol = new Map((stocks || []).map((stock) => [stock.symbol, stock]));
      const trackedUniverseUnavailable = strategy.universe?.type !== "symbols" && !(stocks || []).length;
      let universe = strategy.universe?.type === "symbols"
        ? (strategy.universe.symbols || []).map((symbol) => {
            const stock = stockBySymbol.get(symbol) || { symbol, name: symbol, is_etf: 1 };
            const fallback = STRATEGY_SYMBOL_CONTEXT[symbol] || {};
            return { ...stock, sector: stock.sector && stock.sector !== "—" ? stock.sector : fallback.sector, industry: stock.industry && stock.industry !== "—" ? stock.industry : fallback.industry };
          })
        : (stocks || []);
      const universeOnlyStrategy = { ...strategy, rules: [] };
      const startingUniverse = universe.filter((stock) => evaluateStock(stock, universeOnlyStrategy).eligible);
      universe = startingUniverse;

      const requirements = strategyDataRequirements(strategy);
      const heldSymbols = new Set((strategy.paper?.holdings || []).filter((holding) => Number(holding.shares) > 0).map((holding) => holding.symbol));
      const fixedRules = (strategy.rules || []).filter((rule) => {
        const metric = STRATEGY_METRICS[rule.metric];
        return metric && !metric.supportsLookback && !metric.signalFamily && !LEGACY_TECHNICAL_METRICS.has(rule.metric);
      });
      let allFixedDataMissing = false;
      let heldRuleDataMissing = false;
      if (fixedRules.length) {
        const fixedStrategy = { ...strategy, rules: fixedRules };
        const fixedEvaluations = startingUniverse.map((stock) => ({ stock, result: evaluateStock(stock, fixedStrategy) }));
        allFixedDataMissing = fixedEvaluations.length > 0 && fixedEvaluations.every(({ result }) => result.checks.some((check) => check.missing));
        heldRuleDataMissing = fixedEvaluations.some(({ stock, result }) =>
          heldSymbols.has(stock.symbol)
          && result.checks.some((check) => check.missing)
          && result.checks.every((check) => check.passed || check.missing),
        );
        universe = fixedEvaluations.filter(({ result }) => result.eligible).map(({ stock }) => stock);
      } else {
        universe = startingUniverse;
      }

      const primaryMetric = STRATEGY_METRICS[strategy.ranking?.primary];
      universe = [...universe]
        .sort((a, b) => {
          const canReadPrimaryEarly = primaryMetric && !primaryMetric.supportsLookback && !primaryMetric.signalFamily && !LEGACY_TECHNICAL_METRICS.has(strategy.ranking?.primary);
          const av = (canReadPrimaryEarly ? primaryMetric.read(a, {}, strategy.ranking, {}) : null) ?? a.conviction;
          const bv = (canReadPrimaryEarly ? primaryMetric.read(b, {}, strategy.ranking, {}) : null) ?? b.conviction;
          return (Number.isFinite(Number(bv)) ? Number(bv) : -Infinity) - (Number.isFinite(Number(av)) ? Number(av) : -Infinity);
        })
        .slice(0, strategy.universe?.type === "symbols" ? 50 : 30);

      const indicatorRequest = requirements.needsPriceHistory
        ? mapWithConcurrency(universe, 6, async (stock) => [stock.symbol, await fetchIndicators(stock.symbol, requirements.lookbacks)])
        : Promise.resolve([]);
      const [indicatorEntries, marketContext] = await Promise.all([
        indicatorRequest,
        fetchMarketSignals(universe, requirements.signalFamilies),
      ]);
      const indicatorMap = Object.fromEntries(indicatorEntries);
      for (const stock of universe) {
        indicatorMap[stock.symbol] = {
          price: freshStockPrice(stock),
          momentum90: Number.isFinite(stock.mom) ? stock.mom : undefined,
          sma200: Number.isFinite(stock.sma200) ? stock.sma200 : undefined,
          ...(indicatorMap[stock.symbol] || {}),
        };
      }

      const finalEvaluations = universe.map((stock) => evaluateStock(stock, strategy, indicatorMap[stock.symbol] || {}, marketContext));
      const allFinalDataMissing = finalEvaluations.length > 0 && finalEvaluations.every((result) => result.checks.some((check) => check.missing));
      heldRuleDataMissing ||= finalEvaluations.some((result, index) =>
        heldSymbols.has(universe[index]?.symbol)
        && result.checks.some((check) => check.missing)
        && result.checks.every((check) => check.passed || check.missing),
      );
      const dataUnavailable = allFixedDataMissing || allFinalDataMissing || heldRuleDataMissing;
      const eligibleCandidates = selectCandidates(universe, strategy, indicatorMap, marketContext);
      const branchEvaluation = evaluateAllocationBranches(eligibleCandidates, strategy, marketContext);
      const candidates = branchEvaluation.included;
      const branchExclusions = branchEvaluation.excluded;
      let oriDecision = null;
      let oriEvent = null;
      if (strategy.limits?.allowOri && canUseOri && candidates.length) {
        try {
          const response = await fetch("/api/strategies/ori/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              maxPositions: strategy.limits.maxPositions,
              minConfidence: strategy.limits.minOriConfidence,
              brief: strategy.oriBrief,
              candidates: candidates.slice(0, 15).map((candidate) => ({
                symbol: candidate.symbol,
                name: candidate.name,
                sector: candidate.sector,
                conviction: candidate.conviction,
                rsi14: candidate.strategyIndicators?.rsi14,
                momentum90: candidate.strategyIndicators?.momentum90,
                roic: candidate.roic,
                revenueGrowth: candidate.revenue_growth,
                fcfYield: candidate.fcf_yield,
                beta: candidate.beta,
                averageReturn: candidate.strategyIndicators?.windows?.[20]?.averageReturn,
                returnStdDev: candidate.strategyIndicators?.windows?.[63]?.returnStdDev,
                annualizedVolatility: candidate.strategyIndicators?.windows?.[63]?.annualizedVolatility,
                maxDrawdown: candidate.strategyIndicators?.windows?.[126]?.maxDrawdown,
                allocationBranch: candidate.strategyAllocationPolicy?.branch?.name || null,
              })),
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Ori evaluation failed");
          if (data.decision?.metConfidenceFloor) {
            oriDecision = data.decision;
            oriEvent = makeActivity(
              "ori",
              `Ori ranked ${data.decision.picks?.length || 0} finalist${data.decision.picks?.length === 1 ? "" : "s"}`,
              `${data.decision.explanation || "Ori ranked only candidates that passed every fixed rule."}${data.decision.uncertainty ? ` Uncertainty: ${data.decision.uncertainty}` : ""}`,
              { confidence: data.decision.confidence, modelTier: data.tier },
            );
          } else {
            oriEvent = makeActivity(
              "ori",
              "Ori stood aside",
              `Confidence was ${data.decision?.confidence || 0}%, below the ${strategy.limits.minOriConfidence}% floor. Fixed ranking remained in control.`,
              { confidence: data.decision?.confidence || 0, modelTier: data.tier },
            );
          }
        } catch (error) {
          oriEvent = makeActivity(
            "system",
            "Ori unavailable; rules stayed in control",
            `${error.message}. The check continued using only the fixed ranking and limits.`,
          );
        }
      } else if (strategy.limits?.allowOri && !canUseOri) {
        oriEvent = makeActivity(
          "system",
          "Ori was not used",
          "Ori is not available on the current plan, so fixed rules and ranking kept full control of this paper check.",
        );
      }

      const allocations = buildTargetAllocations(candidates, strategy, oriDecision);
      const priceMap = {};
      for (const stock of universe) {
        priceMap[stock.symbol] = indicatorMap[stock.symbol]?.price;
      }
      const executionSymbols = [...new Set([
        ...allocations.map((allocation) => allocation.symbol),
        ...(strategy.paper?.holdings || []).filter((holding) => Number(holding.shares) > 0).map((holding) => holding.symbol),
      ])];
      for (const symbol of executionSymbols) {
        if (!(Number(priceMap[symbol]) > 0)) priceMap[symbol] = freshStockPrice(stockBySymbol.get(symbol));
      }
      const pricesToLoad = dataUnavailable || trackedUniverseUnavailable
        ? []
        : executionSymbols.filter((symbol) => !(Number(priceMap[symbol]) > 0));
      const supplementalPrices = await mapWithConcurrency(pricesToLoad, 6, async (symbol) => [symbol, (await fetchIndicators(symbol, [], 45)).price]);
      for (const [symbol, price] of supplementalPrices) {
        if (Number(price) > 0) priceMap[symbol] = price;
      }
      const missingExecutionPrices = executionSymbols.filter((symbol) => !(Number(priceMap[symbol]) > 0));
      const executionDataUnavailable = dataUnavailable || trackedUniverseUnavailable || missingExecutionPrices.length > 0;
      const unavailableExplanation = trackedUniverseUnavailable
        ? "The tracked stock universe had not loaded, so existing paper positions were left unchanged."
        : missingExecutionPrices.length
          ? `Current prices were unavailable for ${missingExecutionPrices.join(", ")}, so existing paper positions were left unchanged.`
          : "Required market or fundamental data was unavailable across the reviewed universe. Existing paper positions were left unchanged; missing data never counts as a sell signal.";
      const rebalanced = executionDataUnavailable
        ? { paper: strategy.paper, trades: [], totalValue: paperAccountValue(strategy.paper, priceMap) }
        : rebalancePaperAccount(strategy, allocations, priceMap);
      const ruleEvent = makeActivity(
        "rule",
        `${candidates.length} of ${universe.length} reviewed assets reached allocation`,
        executionDataUnavailable
          ? unavailableExplanation
          : candidates.length
          ? `Every selected asset passed all ${strategy.rules?.length || 0} eligibility filters. ${eligibleCandidates.length - candidates.length} asset${eligibleCandidates.length - candidates.length === 1 ? " was" : "s were"} excluded by ordered allocation branches. Limits then capped the portfolio at ${strategy.limits.maxPositions} positions and ${strategy.limits.maxPositionPct}% per position.`
          : branchExclusions.length
          ? `All ${branchExclusions.length} asset${branchExclusions.length === 1 ? "" : "s"} that passed the eligibility filters matched a fixed THEN exclude branch, so the strategy held simulated cash. Ori cannot override a branch exclusion.`
          : `No asset passed every fixed rule, so the strategy held simulated cash and Ori was not allowed to override the result.`,
        { eligibleCount: candidates.length, reviewedCount: universe.length, branchExcludedCount: branchExclusions.length },
      );
      const tradeEvents = rebalanced.trades.slice(0, 40).map((trade) => makeActivity(
        trade.source === "ori" ? "ori" : "rule",
        `${trade.side} ${trade.symbol} (simulated)`,
        `${trade.side} ${Number(trade.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })} paper share${trade.shares === 1 ? "" : "s"} at $${Number(trade.price).toFixed(2)} to move toward the approved target.${trade.branch ? ` Fixed branch "${trade.branch}" set its rule-based weight because ${trade.branchReason || "its conditions matched"}.` : ""} No real order was sent.`,
        { symbol: trade.symbol, side: trade.side, shares: trade.shares, price: trade.price, branch: trade.branch, branchReason: trade.branchReason },
      ));
      const checkedAt = new Date().toISOString();
      const checkEvent = makeActivity(
        "system",
        trigger === "scheduled" ? "Scheduled paper check completed" : "Paper check completed",
        executionDataUnavailable
          ? `The simulated account was reviewed, but no holdings changed. ${unavailableExplanation}`
          : allocations.length
          ? `The simulated account was reviewed and ${rebalanced.trades.length} paper trade${rebalanced.trades.length === 1 ? " was" : "s were"} recorded.`
          : "The simulated account was reviewed. No target positions qualified.",
      );

      const latest = strategiesRef.current.find((item) => item.id === strategyId) || strategy;
      if (userRef.current !== runUser) return null;
      if (latest.updatedAt && strategy.updatedAt && latest.updatedAt !== strategy.updatedAt) {
        const changed = normalizeStrategy({
          ...latest,
          activity: [makeActivity("system", "Older check result discarded", "The strategy changed while this check was running, so its simulated trades were not applied. Run another check to use the updated plan."), ...(latest.activity || [])],
        });
        persist(strategiesRef.current.map((item) => item.id === strategyId ? changed : item));
        return changed;
      }
      const updated = normalizeStrategy({
        ...latest,
        paper: rebalanced.paper,
        lastRunAt: checkedAt,
        nextRunAt: latest.status === "monitoring" ? nextRunDate(latest.limits.rebalance, new Date(checkedAt)) : null,
        lastDecision: {
          at: checkedAt,
          reviewedCount: universe.length,
          eligibleCount: candidates.length,
          allocations: executionDataUnavailable ? (latest.lastDecision?.allocations || []) : allocations,
          oriDecision,
          candidates: candidates.slice(0, 15).map((candidate) => ({
            symbol: candidate.symbol,
            name: candidate.name,
            sector: candidate.sector,
            conviction: candidate.conviction,
            rsi14: candidate.strategyIndicators?.rsi14 ?? null,
            momentum90: candidate.strategyIndicators?.momentum90 ?? null,
            averageReturn: candidate.strategyIndicators?.windows?.[20]?.averageReturn ?? null,
            annualizedVolatility: candidate.strategyIndicators?.windows?.[63]?.annualizedVolatility ?? null,
            maxDrawdown: candidate.strategyIndicators?.windows?.[126]?.maxDrawdown ?? null,
            allocationBranch: candidate.strategyAllocationPolicy?.branch?.name || null,
            branchReason: allocationPolicyReason(candidate) || null,
            weightMultiplier: candidate.strategyWeightMultiplier ?? 1,
          })),
          branchExclusions: branchExclusions.slice(0, 20).map((candidate) => ({
            symbol: candidate.symbol,
            name: candidate.name,
            sector: candidate.sector,
            allocationBranch: candidate.strategyAllocationPolicy?.branch?.name || "Exclude",
            branchReason: allocationPolicyReason(candidate) || "The branch conditions matched.",
          })),
          signalStatus: signalStatus(marketContext),
        },
        activity: [checkEvent, ...tradeEvents, ...(oriEvent ? [oriEvent] : []), ruleEvent, ...(latest.activity || [])].slice(0, 100),
      });
      persist(strategiesRef.current.map((item) => item.id === strategyId ? updated : item));
      return updated;
    } catch (error) {
      if (userRef.current !== runUser) return null;
      const latest = strategiesRef.current.find((item) => item.id === strategyId);
      if (latest) {
        const failedAt = new Date().toISOString();
        const updated = normalizeStrategy({
          ...latest,
          lastRunAt: failedAt,
          nextRunAt: latest.status === "monitoring" ? nextRunDate(latest.limits.rebalance, new Date(failedAt)) : null,
          activity: [makeActivity("system", "Paper check could not finish", `${error.message}. No simulated holdings were changed.`), ...(latest.activity || [])],
        });
        persist(strategiesRef.current.map((item) => item.id === strategyId ? updated : item));
      }
      return null;
    } finally {
      if (runningIdsRef.current.get(strategyId) === runToken) {
        runningIdsRef.current.delete(strategyId);
        setRunningIds(new Set(runningIdsRef.current.keys()));
      }
    }
  }, [canUseOri, persist, stocks, user]);

  const runStrategyRef = useRef(runStrategy);
  useEffect(() => { runStrategyRef.current = runStrategy; }, [runStrategy]);

  useEffect(() => {
    if (!hydrated) return undefined;
    const checkDue = () => {
      const due = strategiesRef.current.find((strategy) =>
        strategy.status === "monitoring"
        && strategy.nextRunAt
        && new Date(strategy.nextRunAt).getTime() <= Date.now()
        && (strategy.universe?.type === "symbols" || stocks.length > 0),
      );
      if (due) runStrategyRef.current(due.id, { trigger: "scheduled" });
    };
    checkDue();
    const timer = setInterval(checkDue, 60 * 1000);
    return () => clearInterval(timer);
  }, [hydrated, stocks.length]);

  const activeStrategy = strategies.find((strategy) => strategy.id === activeStrategyId) || null;
  const runningStrategyIds = useMemo(() => [...runningIds], [runningIds]);

  return {
    strategies,
    activeStrategy,
    activeStrategyId,
    hydrated,
    setActiveStrategyId,
    addStrategy,
    updateStrategy,
    replaceStrategy,
    deleteStrategy,
    runStrategy,
    runningStrategyIds,
  };
}
