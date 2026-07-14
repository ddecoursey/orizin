import { useState, useEffect, useRef, useMemo } from "react";
import { scoreRows } from "../lib/scoring.js";
import { quickConviction } from "../lib/verdict.js";
import { buildFitContext, computeFit } from "../lib/fitScore.js";
import { fetchUserSettings, patchUserSettings, flushUserSettings } from "../lib/userStore.js";
import {
  resolvePillarWeights,
  sanitizePersona, sanitizeHorizon, sanitizeGoal,
  DEFAULT_PERSONA, DEFAULT_HORIZON, DEFAULT_GOAL,
} from "../lib/personas.js";

// localStorage keys are namespaced per logged-in user so two people sharing
// the same browser (or admins switching accounts) don't see each other's
// pins, tabs, or active selection.
function pinsKey(user) {
  return `screener_pins_v2:${user}`;
}
function tabsKey(user) {
  return `screener_tabs_v2:${user}`;
}
function activeKey(user) {
  return `screener_active_tab_v2:${user}`;
}
function sortStorageKey(user) {
  return `screener_sort_v1:${user}`;
}

// Table column sort — global per user (not per screener tab). Persisted like weights.
const DEFAULT_SORT = { key: "mcap", dir: -1 };
const SORTABLE_KEYS = new Set([
  "symbol", "sector", "mcap", "price", "conviction", "durabilityProxy", "beta",
  "pe", "pb", "ps", "ev_ebitda", "ev_sales", "ev_gp", "fcf_yield", "earnings_yield",
  "gross_margin", "op_margin", "net_margin", "fcf_margin", "roic", "roe", "roa",
  "revenue_growth", "eps_growth", "fcf_growth", "op_income_growth", "rule_of_40",
  "net_debt_ebitda", "current_ratio", "debt_equity", "div_yield",
]);
function sanitizeSort(s) {
  const key = s?.key && SORTABLE_KEYS.has(s.key) ? s.key : DEFAULT_SORT.key;
  const dir = s?.dir === 1 || s?.dir === -1 ? s.dir : DEFAULT_SORT.dir;
  return { key, dir };
}
function loadSort(user) {
  try {
    const raw = localStorage.getItem(sortStorageKey(user));
    if (!raw) return { ...DEFAULT_SORT };
    return sanitizeSort(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SORT };
  }
}
function saveSort(user, sort) {
  try {
    localStorage.setItem(sortStorageKey(user), JSON.stringify(sort));
  } catch {}
}

// Risk tolerance — a personal preference that tilts Conviction (conservative
// punishes speculative microcaps/high-beta/unprofitable names; aggressive is
// lenient). Persisted per-user like weights.
const RISK_VALUES = ["conservative", "balanced", "aggressive"];
const DEFAULT_RISK = "balanced";
function riskKey(user) {
  return `screener_risk_v1:${user}`;
}
function sanitizeRisk(v) {
  return RISK_VALUES.includes(v) ? v : DEFAULT_RISK;
}
function loadRisk(user) {
  try {
    return sanitizeRisk(localStorage.getItem(riskKey(user)));
  } catch {
    return DEFAULT_RISK;
  }
}

// Investor persona + horizon + goal — the personalization levers that (with risk)
// resolve the 7-category conviction weights (lib/personas.js). Persisted per-user
// like risk: localStorage mirror now, server settings once hydrated.
function personaKey(user) { return `screener_persona_v1:${user}`; }
function horizonKey(user) { return `screener_horizon_v1:${user}`; }
function goalKey(user) { return `screener_goal_v1:${user}`; }
function loadPersona(user) {
  try { return sanitizePersona(localStorage.getItem(personaKey(user))); } catch { return DEFAULT_PERSONA; }
}
function loadHorizon(user) {
  try { return sanitizeHorizon(localStorage.getItem(horizonKey(user))); } catch { return DEFAULT_HORIZON; }
}
function loadGoal(user) {
  try { return sanitizeGoal(localStorage.getItem(goalKey(user))); } catch { return DEFAULT_GOAL; }
}

// One-time migration: copy pre-multiuser keys to the current user's
// namespace, so existing single-user installs don't lose their data on
// upgrade. Runs lazily — only if the new-format key is missing.
function migrateLegacyIfNeeded(user) {
  const moves = [
    ["screener_pins_v2", pinsKey(user)],
    ["screener_tabs_v2", tabsKey(user)],
    ["screener_active_tab_v2", activeKey(user)],
  ];
  for (const [oldK, newK] of moves) {
    if (localStorage.getItem(newK) == null && localStorage.getItem(oldK) != null) {
      localStorage.setItem(newK, localStorage.getItem(oldK));
      localStorage.removeItem(oldK);
    }
  }
}

function loadPins(user) {
  try {
    return new Set(JSON.parse(localStorage.getItem(pinsKey(user)) || "[]"));
  } catch {
    return new Set();
  }
}

function loadTabs(user) {
  try {
    let t = JSON.parse(localStorage.getItem(tabsKey(user)) || "[]");

    // One-time migration: move old global pins into the "All Stocks" (default) tab
    const oldPins = loadPins(user);

    if (!t.find((x) => x.id === "default")) {
      t.unshift({
        id: "default",
        name: "All Stocks",
        state: oldPins.size > 0 ? { pins: [...oldPins] } : null,
      });
    } else {
      const defTab = t.find((x) => x.id === "default");
      if (defTab && (!defTab.state || !Array.isArray(defTab.state.pins)) && oldPins.size > 0) {
        defTab.state = { ...(defTab.state || {}), pins: [...oldPins] };
        saveTabs(user, t); // persist migration once
      }
    }

    return t;
  } catch {
    const oldPins = loadPins(user);
    return [{
      id: "default",
      name: "All Stocks",
      state: oldPins.size > 0 ? { pins: [...oldPins] } : null,
    }];
  }
}
function saveTabs(user, tabs) {
  try {
    localStorage.setItem(tabsKey(user), JSON.stringify(tabs));
  } catch {}
}

export const DEFAULT_FILTERS = {
  // universe: 'us' | 'us-listed' | 'global' — controls both refresh scope and client-side filtering.
  // includeEtfs: toggle ETFs/funds in results (refresh always pulls full lists for complete universe).
  // Bulk refresh uses full stock+etf lists (no mcap floor). Use Size mcap / pinnedOnly / search to narrow.
  // Manual Add Ticker works for anything.
  universe: "global",
  includeEtfs: false,  // ETFs/funds hidden by default; toggle on in the filter pane (universe refresh still loads the full list)
  // Conviction (0-100) — the headline score. Applied AFTER scoring (it's computed
  // per-row post-filter), not in applyFilters. See convictionFiltered below.
  convictionMin: "",
  hasOriConviction: false,
  mcapMin: "",
  mcapMax: "",
  volMin: "",
  grossMin: "",
  opMin: "",
  netMin: "",
  ebitdaMin: "",
  fcfMargMin: "",
  roicMin: "",
  roeMin: "",
  roaMin: "",
  revGrowthMin: "",
  epsGrowthMin: "",
  fcfGrowthMin: "",
  r40Min: "",
  peMax: "",
  pbMax: "",
  psMax: "",
  evEbMax: "",
  evSMax: "",
  evGpMax: "",
  fcfMin: "",
  ndMax: "",
  crMin: "",
  deMax: "",
  divMin: "",
  payMax: "",
  betaMin: "",
  betaMax: "",
  priceMin: "",
  priceMax: "",
  earningsYieldMin: "",
  opIncGrowthMin: "",
  sectors: [],
  industries: [],
  search: "",
  pinnedOnly: false,
  rule40Only: false,
};

function normalizeUniverse(f = {}) {
  if (f.universe && ["us", "us-listed", "global"].includes(f.universe)) return f.universe;
  // Legacy migration for very old saved tabs that only had the boolean checkbox
  if (f.usOnly != null) return f.usOnly ? "us" : "us-listed";
  return "global";
}

// Strict numeric coercion for filter values. Sidebar inputs store strings, and
// a cleared input leaves "" behind — global isFinite("") is true (coerces to
// 0), which used to turn a *cleared* "P/E ≤" filter into "P/E ≤ 0" and empty
// the table. Number.isFinite after explicit conversion has no such trap.
function condNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Conviction (0-100) is computed AFTER the metric filters (it needs the scored
// rows), so its filter runs as a final pass. Mirrors numericMatch's operator
// semantics. An explicit Conviction filter excludes unscored rows (no number to
// judge). Returns true when no Conviction filter is set.
export function convictionPasses(conviction, cond) {
  if (cond == null || cond === "") return true;
  const c = typeof cond === "object" ? cond : { op: ">=", value: cond };
  const op = c.op || ">=";
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  if (op === "between" || op === "range") {
    const min = num(c.min);
    const max = num(c.max);
    if (min == null && max == null) return true; // empty between → no filter
    if (conviction == null || !Number.isFinite(conviction)) return false;
    if (min != null && conviction < min) return false;
    if (max != null && conviction > max) return false;
    return true;
  }
  const value = num(c.value);
  if (value == null) return true; // cleared input → filter off
  if (conviction == null || !Number.isFinite(conviction)) return false;
  switch (op) {
    case ">":  return conviction > value;
    case ">=": return conviction >= value;
    case "<":  return conviction < value;
    case "<=": return conviction <= value;
    case "=":
    case "==": return conviction == value;
    case "!=":
    case "<>": return conviction != value;
    default:   return true;
  }
}

export function hasOriConviction(row) {
  return Boolean(row?.ori) && row?.conviction != null && Number.isFinite(Number(row.conviction));
}

export function applyConvictionFilters(rows, convictionCondition, requireOriConviction = false) {
  const hasConvictionCondition = convictionCondition != null && convictionCondition !== "";
  if (!hasConvictionCondition && !requireOriConviction) return rows;
  const filtered = rows.filter((row) =>
    (!requireOriConviction || hasOriConviction(row))
    && (!hasConvictionCondition || convictionPasses(row.conviction, convictionCondition)),
  );
  return filtered.length === rows.length ? rows : filtered;
}

export function applyFilters(all, f, pins) {
  const g = (k) => condNum(f[k]);

  // New flexible numeric condition checker
  // Supports: { op: ">", value: 50 }, { op: "between", min: 10, max: 100 }, etc.
  // Empty/non-numeric bounds mean "no constraint" — never a phantom 0.
  function numericMatch(rowVal, cond) {
    if (!cond) return true;
    if (rowVal == null || !isFinite(rowVal)) return true;

    const op = cond.op || ">=";

    if (op === "between" || op === "range") {
      const min = condNum(cond.min);
      const max = condNum(cond.max);
      if (min != null && rowVal < min) return false;
      if (max != null && rowVal > max) return false;
      return true;
    }

    const value = condNum(cond.value);
    if (value == null) return true;

    switch (op) {
      case ">":  return rowVal > value;
      case ">=": return rowVal >= value;
      case "<":  return rowVal < value;
      case "<=": return rowVal <= value;
      case "=":
      case "==": return rowVal == value;
      case "!=":
      case "<>": return rowVal != value;
      default:   return true;
    }
  }

  const ok = (val, op, cmp) => {
    if (cmp === null) return true;
    if (val === null || !isFinite(val)) return true;
    return op === ">=" ? val >= cmp : val <= cmp;
  };
  const p = (v) => (v == null ? null : v * 100);

  // Helper: supports both legacy number (e.g. grossMin: 15) and new object style
  function getNumCond(f, key) {
    const v = f[key];
    if (v == null || v === "") return null;
    if (typeof v === "object") {
      const op = v.op || (key.endsWith("Max") ? "<=" : ">=");
      if (op === "between" || op === "range") {
        // A between with both sides empty is no filter at all.
        if (condNum(v.min) == null && condNum(v.max) == null) return null;
        return v;
      }
      // Cleared input ({ op, value: "" }) → filter is off.
      if (condNum(v.value) == null) return null;
      return v;
    }
    // Legacy flat number → operator. Default operator follows the key suffix so
    // a bare "peMax": 20 means "<= 20" (not ">= 20"); "roicMin": 15 means ">= 15".
    const n = condNum(v);
    if (n == null) return null;
    return { op: key.endsWith("Max") ? "<=" : ">=", value: n };
  }
  const sectorSet = f.sectors?.length ? new Set(f.sectors) : null;
  const industrySet = f.industries?.length ? new Set(f.industries) : null;
  const search = (f.search || "").trim().toLowerCase();

  return all.filter((r) => {
    if (f.pinnedOnly && !pins.has(r.symbol)) return false;

    // ETF/fund exclusion via filter pane toggle. Prefer the authoritative is_etf flag
    // from the server; fall back to a name heuristic for any older rows lacking it.
    if (!f.includeEtfs) {
      if (r.is_etf != null) {
        if (r.is_etf) return false;
      } else {
        const nm = `${r.name || ''} ${r.symbol || ''}`.toUpperCase();
        if (
          /\b(ETF|ETN)\b/.test(nm) ||
          nm.includes('ISHARES') || nm.includes('SPDR') || nm.includes('VANGUARD') ||
          nm.includes('INVESCO') || nm.includes('PROSHARES') ||
          / (FUND|INDEX|TRUST)\b/.test(nm)
        ) {
          return false;
        }
      }
    }

    // Universe scope filter (client-side; DB may contain stocks from any prior scope)
    const scope = normalizeUniverse(f);
    if (scope === "us-listed") {
      const ex = String(r.exchange || "").toUpperCase();
      if (ex && !["NYSE", "NASDAQ", "AMEX"].includes(ex)) return false;
    } else if (scope === "us") {
      const c = String(r.country || "").toUpperCase();
      if (c && c !== "US") return false;
    }
    // "global": no restriction

    if (f.rule40Only) {
      const margin = r.ebitda_margin ?? r.fcf_margin;
      if (r.revenue_growth == null || margin == null) return false;
      if ((r.revenue_growth + margin) * 100 < 40) return false;
    }
    if (
      search &&
      !(r.symbol + " " + (r.name || "")).toLowerCase().includes(search)
    )
      return false;
    if (sectorSet && !sectorSet.has(r.sector)) return false;
    if (industrySet && !industrySet.has(r.industry)) return false;
    // Market Cap - support both old and new flexible format
    const mcapCond = f.mcap;
    if (mcapCond && typeof mcapCond === "object") {
      const mcapVal = r.mcap ? r.mcap / 1e9 : null;
      if (!numericMatch(mcapVal, mcapCond)) return false;
    } else {
      if (!ok(r.mcap ? r.mcap / 1e9 : null, ">=", g("mcapMin"))) return false;
      if (g("mcapMax") != null && r.mcap != null && r.mcap / 1e9 > g("mcapMax"))
        return false;
    }
    if (!numericMatch(r.volume ? r.volume / 1e6 : null, getNumCond(f, "volMin"))) return false;
    // Price - support both old min/max and new flexible operator format
    const priceCond = f.price;
    if (priceCond && typeof priceCond === "object") {
      if (!numericMatch(r.price, priceCond)) return false;
    } else {
      if (!ok(r.price, ">=", g("priceMin"))) return false;
      if (!ok(r.price, "<=", g("priceMax"))) return false;
    }
    if (!numericMatch(p(r.gross_margin), getNumCond(f, "grossMin"))) return false;
    if (!numericMatch(p(r.op_margin), getNumCond(f, "opMin"))) return false;
    if (!numericMatch(p(r.net_margin), getNumCond(f, "netMin"))) return false;
    if (!numericMatch(p(r.ebitda_margin), getNumCond(f, "ebitdaMin"))) return false;
    if (!numericMatch(p(r.fcf_margin), getNumCond(f, "fcfMargMin"))) return false;
    if (!numericMatch(p(r.roic), getNumCond(f, "roicMin"))) return false;
    if (!numericMatch(p(r.roe), getNumCond(f, "roeMin"))) return false;
    if (!numericMatch(p(r.roa), getNumCond(f, "roaMin"))) return false;
    if (!numericMatch(p(r.revenue_growth), getNumCond(f, "revGrowthMin"))) return false;
    if (!numericMatch(p(r.eps_growth), getNumCond(f, "epsGrowthMin"))) return false;
    if (!numericMatch(p(r.fcf_growth), getNumCond(f, "fcfGrowthMin"))) return false;
    if (!numericMatch(p(r.op_income_growth), getNumCond(f, "opIncGrowthMin"))) return false;
    const r40Cond = getNumCond(f, "r40Min");
    if (r40Cond) {
      const margin = r.ebitda_margin ?? r.fcf_margin;
      if (r.revenue_growth == null || margin == null) return false;
      if (!numericMatch((r.revenue_growth + margin) * 100, r40Cond)) return false;
    }
    if (!numericMatch(r.pe, getNumCond(f, "peMax"))) return false;
    if (!numericMatch(r.pb, getNumCond(f, "pbMax"))) return false;
    if (!numericMatch(r.ps, getNumCond(f, "psMax"))) return false;
    if (!numericMatch(r.ev_ebitda, getNumCond(f, "evEbMax"))) return false;
    if (!numericMatch(r.ev_sales, getNumCond(f, "evSMax"))) return false;
    if (!numericMatch(r.ev_gp, getNumCond(f, "evGpMax"))) return false;
    if (!numericMatch(p(r.fcf_yield), getNumCond(f, "fcfMin"))) return false;
    if (!numericMatch(p(r.earnings_yield), getNumCond(f, "earningsYieldMin"))) return false;
    if (!numericMatch(r.net_debt_ebitda, getNumCond(f, "ndMax"))) return false;
    if (!numericMatch(r.current_ratio, getNumCond(f, "crMin"))) return false;
    if (!numericMatch(r.debt_equity, getNumCond(f, "deMax"))) return false;
    if (!numericMatch(p(r.div_yield), getNumCond(f, "divMin"))) return false;
    const payCond = getNumCond(f, "payMax");
    if (payCond && r.payout != null && isFinite(r.payout)) {
      if (!numericMatch(r.payout * 100, payCond)) return false;
    }
    // Beta - support both old min/max and new flexible operator format
    const betaCond = f.beta;
    if (betaCond && typeof betaCond === "object") {
      if (!numericMatch(r.beta, betaCond)) return false;
    } else {
      if (!ok(r.beta, ">=", g("betaMin"))) return false;
      if (!ok(r.beta, "<=", g("betaMax"))) return false;
    }
    return true;
  });
}

export function useScreener(currentUser, portfolioGoals = {}, canUseOri = false, currentView = "screener") {
  const user = currentUser || "default";
  // Run migration synchronously before any state init so loadPins/loadTabs
  // see the migrated values on first render.
  if (typeof window !== "undefined") migrateLegacyIfNeeded(user);

  const [stocks, setStocks] = useState([]);
  const [status, setStatus] = useState({ type: "loading", msg: "Connecting…" });
  const [lastFetch, setLastFetch] = useState(null);
  const [filters, setFiltersRaw] = useState({ ...DEFAULT_FILTERS });
  const [risk, setRiskRaw] = useState(() => loadRisk(user));
  const [persona, setPersonaRaw] = useState(() => loadPersona(user));
  const [horizon, setHorizonRaw] = useState(() => loadHorizon(user));
  const [goal, setGoalRaw] = useState(() => loadGoal(user));
  const [tabs, setTabsState] = useState(() => loadTabs(user));
  const [activeTab, setActiveTabState] = useState(
    () => localStorage.getItem(activeKey(user)) || "default",
  );
  const initialSort = loadSort(user);
  const [tableSortKey, setTableSortKey] = useState(initialSort.key);
  const [tableSortDir, setTableSortDir] = useState(initialSort.dir);

  // Pins are now per active tab/screener (not global)
  const initialActiveTab = localStorage.getItem(activeKey(user)) || "default";
  const initialTab = tabs.find((t) => t.id === initialActiveTab);
  const initialPins = initialTab?.state?.pins && Array.isArray(initialTab.state.pins)
    ? new Set(initialTab.state.pins)
    : new Set();

  const [pins, setPins] = useState(initialPins);
  const [enrichNotice, setEnrichNotice] = useState(null);
  const enrichNoticeAt = enrichNotice?.at;
  useEffect(() => {
    if (!enrichNoticeAt) return;
    const id = setTimeout(() => setEnrichNotice(null), 15_000);
    return () => clearTimeout(id);
  }, [enrichNoticeAt]);
  // True once we've reconciled local state with the server copy. Until then we
  // don't push writes up, so the initial local/default values can't clobber
  // settings that exist server-side before hydration finishes.
  const hydratedRef = useRef(false);


  // Risk-tolerance setter — mirrors weights (localStorage now, server once hydrated).
  function setRisk(value) {
    const next = sanitizeRisk(value);
    setRiskRaw(next);
    try { localStorage.setItem(riskKey(user), next); } catch {}
    if (hydratedRef.current) patchUserSettings({ risk: next });
  }

  // Persona / horizon / goal setters — same persistence pattern as risk.
  function setPersona(value) {
    const next = sanitizePersona(value);
    setPersonaRaw(next);
    try { localStorage.setItem(personaKey(user), next); } catch {}
    if (hydratedRef.current) patchUserSettings({ persona: next });
  }
  function setHorizon(value) {
    const next = sanitizeHorizon(value);
    setHorizonRaw(next);
    try { localStorage.setItem(horizonKey(user), next); } catch {}
    if (hydratedRef.current) patchUserSettings({ horizon: next });
  }
  function setGoal(value) {
    const next = sanitizeGoal(value);
    setGoalRaw(next);
    try { localStorage.setItem(goalKey(user), next); } catch {}
    if (hydratedRef.current) patchUserSettings({ goal: next });
  }

  function setTableSort(key, dir) {
    const next = sanitizeSort({ key, dir });
    setTableSortKey(next.key);
    setTableSortDir(next.dir);
    saveSort(user, next);
    if (hydratedRef.current) {
      patchUserSettings({ sort: next });
      flushUserSettings();
    }
  }

  // Re-read sort from localStorage when returning to the screener. The table
  // unmounts on other views; this also recovers if async server hydration
  // briefly clobbered in-memory state with a stale server copy.
  const prevViewRef = useRef(currentView);
  useEffect(() => {
    if (currentView === "screener" && prevViewRef.current !== "screener") {
      const local = loadSort(user);
      setTableSortKey(local.key);
      setTableSortDir(local.dir);
    }
    prevViewRef.current = currentView;
  }, [currentView, user]);

  // Session-only Conviction overrides: when a stock is deep-researched its
  // Conviction refines (live technicals/grades/insiders/Ori); we lift that
  // sharper number back onto the screener row for the rest of the session
  // (resets on reload — not persisted).
  const [convictionOverrides, setConvictionOverrides] = useState({});
  // Lift a Deep-Research result back onto the screener: the refined Conviction
  // (exact, session-only) AND the Ori review object. Attaching the review to
  // `oriData` is what makes the ✧ "Ori-rated" emblem show on the row — and it
  // keeps the row Ori-influenced even if the exact override is later dropped
  // (e.g. on a persona/goal change), since withOri re-folds the cached review.
  function setConvictionOverride(symbol, conviction, ori = null) {
    if (!symbol) return;
    if (Number.isFinite(conviction)) {
      setConvictionOverrides((prev) => (prev[symbol] === conviction ? prev : { ...prev, [symbol]: conviction }));
    }
    if (ori) {
      // DR's frontier review supersedes any lite trickle entry; same ref → no-op.
      setOriData((prev) => (prev[symbol] === ori ? prev : { ...prev, [symbol]: ori }));
    }
  }

  const [loadProgress, setLoadProg] = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [hasEnrichedOnce, setHasEnrichedOnce] = useState(false);
  const stocksRef = useRef([]);
  // Auto-enrich refs removed (feature disabled)
  const currentAbortRef = useRef(null); // for cancelling refresh or enrich
  const loadProgRef = useRef(null); // latest progress numbers for status messages

  // Derived - split heavy ranking from light weighting for better slider perf.
  // `pins` only affects the result when the "pinned only" filter is on, so gate the
  // dependency: otherwise pinning/unpinning a stock would needlessly re-run the whole
  // filter → rank → weight chain over the entire universe (the table still re-sorts
  // pinned rows to the top on its own).
  const EMPTY_PINS = useMemo(() => new Set(), []);
  const pinsForFilter = filters.pinnedOnly ? pins : EMPTY_PINS;
  const filteredRows = useMemo(
    () => applyFilters(stocks, filters, pinsForFilter),
    [stocks, filters, pinsForFilter]
  );

  // Free tier: conviction uses fundamentals only — no cached Gemini/Ori reviews.
  const scoringRows = useMemo(
    () => (canUseOri ? filteredRows : filteredRows.map((r) => (r.ori ? { ...r, ori: null } : r))),
    [filteredRows, canUseOri],
  );

  // Personalized Fit context + per-symbol Fit map. Built from the user's
  // portfolio/goals/theses; null when there's no context (so the screener stays
  // impersonal for users who haven't set anything up). Memoized over the whole
  // universe so weight/risk drags don't recompute Fit — only a portfolio change does.
  const fitCtx = useMemo(
    () =>
      buildFitContext({
        portfolios: portfolioGoals.portfolios,
        goals: portfolioGoals.goals,
        theses: portfolioGoals.theses,
        stocks,
      }),
    [portfolioGoals.portfolios, portfolioGoals.goals, portfolioGoals.theses, stocks],
  );
  const hasFitContext = !!fitCtx?.hasContext;
  const fitMap = useMemo(() => {
    if (!hasFitContext) return null;
    const m = Object.create(null);
    for (const s of stocks) if (s.symbol) m[s.symbol] = computeFit(s, fitCtx);
    return m;
  }, [stocks, fitCtx, hasFitContext]);

  // The 7-category conviction weights resolved from the user's investor persona +
  // risk + horizon + goal. Drives the whole-app Conviction blend.
  const pillarWeights = useMemo(
    () => resolvePillarWeights({ persona, risk, horizon, goal }),
    [persona, risk, horizon, goal],
  );

  // Attach the single Conviction (absolute) to every visible row. No cross-row
  // ranking anymore, so this is one cheap O(n) pass re-run when the lens changes.
  const filteredWeighted = useMemo(
    () => scoreRows(scoringRows, { risk, fitMap, pillarWeights }),
    [scoringRows, risk, fitMap, pillarWeights]
  );

  // Deep Research overrides are computed under the current personalization lens.
  // If the user changes their persona/risk/horizon/goal (→ pillarWeights) or
  // portfolio/goals Fit, those lifted convictions become stale; drop them so the
  // screener reflects the freshly personalized lean conviction again.
  useEffect(() => {
    setConvictionOverrides({});
  }, [pillarWeights, fitMap]);

  // Apply any session Conviction overrides from Deep Research. Returns the same
  // reference when there are none, so the common case adds zero churn.
  const filtered = useMemo(() => {
    const syms = Object.keys(convictionOverrides);
    if (!syms.length) return filteredWeighted;
    return filteredWeighted.map((r) =>
      convictionOverrides[r.symbol] != null ? { ...r, conviction: convictionOverrides[r.symbol] } : r,
    );
  }, [filteredWeighted, convictionOverrides]);

  // Lite intangibles for the *visible top* of the current list — the personalized
  // half of the screener enrichment (the shared server "leaders" trickle covers
  // broad names). Each leader issues a cache-only GET (no Gemini); background
  // trickle is the sole lite generator. Frugal by design:
  //   • only a handful of the highest-Conviction leaders,
  //   • Pro/admin only (free users get 402s — don't spend the quota),
  //   • debounced so changing the persona lens doesn't sweep per frame,
  //   • concurrency 1 (one lite call in flight) so chat/DR stay responsive,
  //   • in-memory for the session; server-side db.getAllStocks re-attaches the
  //     cached review on the next data load (persists for free, across users).
  const ORI_LEADER_COUNT = 15;
  const ORI_DEBOUNCE_MS = 800;
  const [oriData, setOriData] = useState({});
  const oriFetchedRef = useRef(new Set());
  useEffect(() => {
    if (!canUseOri) return;
    const leaders = [...filteredWeighted]
      .filter((r) => r.conviction != null && r.conviction >= 65 && !r.ori && !oriData[r.symbol])
      .sort((a, b) => (b.conviction || 0) - (a.conviction || 0))
      .slice(0, ORI_LEADER_COUNT)
      .filter((r) => !oriFetchedRef.current.has(r.symbol));
    if (!leaders.length) return;

    let cancelled = false;
    const inFlight = new Set();
    const fetchedSet = oriFetchedRef.current;
    const fetchOne = async (r) => {
      const sym = r.symbol;
      fetchedSet.add(sym);
      inFlight.add(sym);
      try {
        // Cache-only read — background trickle is the sole generator; no body needed.
        const res = await fetch(`/api/stocks/intangibles/${sym}`);
        if (res.ok) {
          const j = await res.json();
          if (j.ori && !cancelled) {
            setOriData((prev) => ({ ...prev, [sym]: j.ori }));
          } else {
            fetchedSet.delete(sym); // cache not warm yet — retry after trickle
          }
        } else if (res.status === 503 || res.status === 429) {
          fetchedSet.delete(sym); // transient — let a later sweep retry
        }
      } catch {
        fetchedSet.delete(sym);
      } finally {
        inFlight.delete(sym);
      }
    };

    // Debounce, then drain the leader queue one-at-a-time (concurrency 1).
    const timer = setTimeout(async () => {
      const queue = [...leaders];
      while (!cancelled && queue.length) await fetchOne(queue.shift());
    }, ORI_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const sym of inFlight) fetchedSet.delete(sym);
    };
    // NOTE: `oriData` is intentionally NOT a dependency. With it in, every fetch
    // bumped oriData → re-ran this effect → fetched the next 15 uncached leaders,
    // chaining through the entire conviction≥65 universe (a request storm). The
    // server endpoint is cache-only now, but we still cap the client to one
    // bounded pass per filter change. oriFetchedRef de-dupes within the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredWeighted, canUseOri]);

  // Fold any fetched lite review into the displayed Conviction, exactly the way
  // Deep Research's computeVerdict does on open: re-run the shared quickConviction
  // with the cached Ori attached (so the Intangibles pillar + Ori's ±20 nudge
  // apply), minus the same data-coverage penalty scoreRows used. A Deep
  // Research override is canonical and wins untouched (DR already folded Ori in) —
  // we only attach `ori` there for the ✧ badge/tooltip.
  const withOri = useMemo(() => {
    if (!Object.keys(oriData).length) return filtered;
    return filtered.map((r) => {
      const o = oriData[r.symbol];
      if (!o) return r;
      if (convictionOverrides[r.symbol] != null) return { ...r, ori: r.ori || o };
      const fit = fitMap ? fitMap[r.symbol] || null : null;
      const lean = quickConviction({ ...r, ori: o }, fit, risk, pillarWeights);
      if (lean == null) return { ...r, ori: o };
      const adj = Math.max(0, lean - (r.dataCoveragePenalty || 0));
      return { ...r, conviction: adj, ori: o };
    });
  }, [filtered, oriData, convictionOverrides, fitMap, risk, pillarWeights]);

  // Final pass: Conviction filters run after cached/DR Ori reviews have been
  // folded into each score, so "Has Ori conviction" cannot match a base score.
  const convictionFiltered = useMemo(() => {
    return applyConvictionFilters(withOri, filters.convictionMin, filters.hasOriConviction);
  }, [withOri, filters.convictionMin, filters.hasOriConviction]);

  // ── Data loading ─────────────────────────────────────────────────────────

  function isAbortError(e) {
    return e?.name === "AbortError" || e?.code === 20;
  }

  function cancelCurrentOperation() {
    if (currentAbortRef.current) {
      currentAbortRef.current.abort();
      currentAbortRef.current = null;
    }
    setLoadProg(null);
    loadProgRef.current = null;
    setEnrichLoading(false);
    setStatus({ type: "ready", msg: "Operation cancelled by user" });
  }

  function startLongOperation() {
    if (currentAbortRef.current) {
      currentAbortRef.current.abort();
    }
    const controller = new AbortController();
    currentAbortRef.current = controller;
    return controller;
  }

  // Retry helper available to all data loading functions.
  async function fetchWithRetry(url, options = {}, retries = 3, baseDelay = 220) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url, options);
        return res;
      } catch (e) {
        if (isAbortError(e)) throw e;
        lastError = e;
        if (attempt < retries - 1) {
          const delay = baseDelay * Math.pow(1.6, attempt) + Math.random() * 80;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  function streamRefresh(onDone, force = false) {
    const controller = startLongOperation();

    setStatus({ type: "loading", msg: "Fetching universe from FMP (stock-list + etf-list)…" });
    setLoadProg({ done: 0, total: null, errors: 0 });

    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };

    // Compute a load-time floor for the FMP screener call.
    // Base floor is 300M (global default for stocks + ETFs). If user has set a higher mcapMin/mcap filter
    // in the Size section, use the higher value for the fetch (narrows what gets stored).
    const BASE_FLOOR = 500_000_000;
    let loadMinMcap = BASE_FLOOR;
    const mcapCond = filters.mcap;
    if (mcapCond && typeof mcapCond === "object") {
      if (mcapCond.min != null) loadMinMcap = Math.max(BASE_FLOOR, Number(mcapCond.min) * 1e9);
      else if ((mcapCond.op === ">" || mcapCond.op === ">=") && mcapCond.value != null) loadMinMcap = Math.max(BASE_FLOOR, Number(mcapCond.value) * 1e9);
    } else {
      const flat = Number(filters.mcapMin);
      if (flat > 0) loadMinMcap = Math.max(BASE_FLOOR, flat * 1e9);
    }

    const refreshBody = {
      force: !!force,
      scope: normalizeUniverse(filters),
      minMarketCap: loadMinMcap,
    };
    opts.body = JSON.stringify(refreshBody);

    // Retry the start of the streaming refresh as well. This path is taken
    // on the first load after a refresh when the local cache is empty.
    fetchWithRetry("/api/stocks/refresh", opts, 2, 280)
      .then(async (res) => {
        if (!res.ok) {
          // Non-SSE failure (admin-only 403, rate-limit 429, …). Without this
          // check the reader below parsed a JSON error body as an empty stream
          // and the UI sat on "Fetching universe…" forever.
          let msg = `Refresh failed (HTTP ${res.status})`;
          try {
            const data = await res.json();
            if (data?.error) msg = data.error;
          } catch { /* non-JSON body — keep the status message */ }
          currentAbortRef.current = null;
          setLoadProg(null);
          setStatus({ type: stocksRef.current.length ? "ready" : "error", msg });
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) return;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.type === "progress") {
                  setLoadProg({ done: evt.done, total: evt.total, errors: 0 });
                  setStatus({
                    type: "loading",
                    msg: `Loading profiles: ${evt.done} / ${evt.total}`,
                  });
                } else if (evt.type === "done") {
                  currentAbortRef.current = null;
                  setLoadProg(null);
                  const rows = evt.stocks || [];
                  setStocks(rows);
                  stocksRef.current = rows;
                  const { count, enrichedCount, lastFetch } = evt.meta || {};
                  setLastFetch(lastFetch ? Number(lastFetch) : Date.now());
                  const age = lastFetch ? `, fetched just now` : "";
                  setStatus({
                    type: "ready",
                    msg: `${count} stocks · ${enrichedCount} enriched${age}`,
                  });
                  if (onDone) onDone(evt);
                } else if (evt.type === "error") {
                  currentAbortRef.current = null;
                  setLoadProg(null);
                  setStatus({ type: "error", msg: evt.message });
                }
              } catch {}
            }
            pump();
          }).catch((e) => {
            if (isAbortError(e)) {
              currentAbortRef.current = null;
              setLoadProg(null);
              return;
            }
            currentAbortRef.current = null;
            setLoadProg(null);
            setStatus({ type: "error", msg: e?.message || "Stream read failed" });
          });
        }
        pump();
      })
      .catch((e) => {
        if (!isAbortError(e)) {
          setLoadProg(null);
          setStatus({ type: "error", msg: e.message });
        }
        currentAbortRef.current = null;
      });
  }

  async function loadStocks(forceRefresh = false, silent = false) {
    const hasStocks = stocksRef.current.length > 0;
    if (!silent && !hasStocks) {
      setStatus({ type: "loading", msg: "Loading universe…" });
    }
    try {
      const res = await fetchWithRetry("/api/stocks", {}, 3, 200);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (!data.stocks?.length || forceRefresh) {
        // DB empty or forced — stream a fresh fetch
        streamRefresh(null, forceRefresh);
        return;
      }

      const rows = data.stocks || [];
      setStocks(rows);
      stocksRef.current = rows;
      const { count, enrichedCount, lastFetch } = data.meta || {};
      setLastFetch(lastFetch ? Number(lastFetch) : null);
      const age = lastFetch
        ? `, fetched ${Math.round((Date.now() - lastFetch) / 60000)}min ago`
        : "";
      setStatus({
        type: "ready",
        msg: `${count} stocks · ${enrichedCount} enriched${age}`,
      });
    } catch (e) {
      setStatus({ type: "error", msg: e.message });
    }
  }

  // Initial load with a small deliberate delay + automatic retry.
  // The delay helps on hard browser refreshes where the backend (or SQLite WAL)
  // may still be settling from the previous request. We then do one automatic
  // retry if the first attempt left us with no data.
  useEffect(() => {
    let cancelled = false;

    const runInitialLoad = async () => {
      // Light delay on hard refresh before the first attempt.
      // The real protection now comes from fetchWithRetry (multiple attempts + backoff).
      await new Promise((r) => setTimeout(r, 160));

      if (cancelled) return;

      await loadStocks();

      // One automatic retry if we still have zero stocks after the first attempt.
      setTimeout(() => {
        if (!cancelled && stocksRef.current.length === 0) {
          loadStocks();
        }
      }, 650);
    };

    runInitialLoad();
    return () => { cancelled = true; };
    // Mount-only by design — loadStocks is recreated each render but only the
    // initial invocation belongs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate screens/weights from the server so they follow the account across
  // devices. If the server has nothing yet (fresh account / first upgrade),
  // migrate the current local state up once. localStorage stays as the offline
  // mirror and instant-load source.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await fetchUserSettings();
      if (cancelled) return;

      const hasServerState =
        server && (Array.isArray(server.tabs) || server.activeTab || server.risk || server.sort || server.persona || server.horizon || server.goal);

      if (hasServerState) {
        let nextTabs = tabs;
        if (Array.isArray(server.tabs) && server.tabs.length) {
          nextTabs = server.tabs;
          setTabsState(nextTabs);
          saveTabs(user, nextTabs);
        }
        let nextActive = activeTab;
        if (server.activeTab) {
          nextActive = server.activeTab;
          setActiveTabState(nextActive);
          localStorage.setItem(activeKey(user), nextActive);
        }
        if (server.risk) {
          const cleanRisk = sanitizeRisk(server.risk);
          setRiskRaw(cleanRisk);
          try { localStorage.setItem(riskKey(user), cleanRisk); } catch {}
        }
        if (server.persona) {
          const p = sanitizePersona(server.persona);
          setPersonaRaw(p);
          try { localStorage.setItem(personaKey(user), p); } catch {}
        }
        if (server.horizon) {
          const h = sanitizeHorizon(server.horizon);
          setHorizonRaw(h);
          try { localStorage.setItem(horizonKey(user), h); } catch {}
        }
        if (server.goal) {
          const g = sanitizeGoal(server.goal);
          setGoalRaw(g);
          try { localStorage.setItem(goalKey(user), g); } catch {}
        }
        // Local sort wins on this device — it's updated synchronously on every
        // column click, while the server copy may still be the default from an
        // earlier migrate-up. Only adopt server sort when we have no local copy.
        const hasLocalSort = localStorage.getItem(sortStorageKey(user)) != null;
        if (server.sort && !hasLocalSort) {
          const cleanSort = sanitizeSort(server.sort);
          setTableSortKey(cleanSort.key);
          setTableSortDir(cleanSort.dir);
          saveSort(user, cleanSort);
        } else if (hasLocalSort) {
          const localSort = loadSort(user);
          setTableSortKey(localSort.key);
          setTableSortDir(localSort.dir);
        }
        // Re-derive pins from the adopted active tab (parity with mount init).
        const at = nextTabs.find((t) => t.id === nextActive);
        const tp = at?.state?.pins;
        setPins(Array.isArray(tp) ? new Set(tp) : new Set());
      } else {
        patchUserSettings({ tabs, activeTab, risk, persona, horizon, goal, sort: { key: tableSortKey, dir: tableSortDir } });
      }

      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: intentionally uses the initial local state for migrate-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh just a few specific rows in place (fetch each by symbol and swap it in)
  // instead of re-downloading the whole universe — used after a small/single-symbol
  // gather so the Deep Research re-gather doesn't pull ~10k rows to update one.
  async function mergeStocks(symbolList) {
    try {
      const results = await Promise.all(
        symbolList.map((s) =>
          fetch(`/api/stocks/${encodeURIComponent(s)}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      const fresh = new Map(
        results.filter((r) => r && r.symbol).map((r) => [r.symbol, r]),
      );
      if (!fresh.size) return;
      const apply = (arr) => arr.map((r) => fresh.get(r.symbol) || r);
      stocksRef.current = apply(stocksRef.current);
      setStocks((prev) => apply(prev));
    } catch {
      // Fall back to a full reload if the targeted merge fails.
      loadStocks(false, true);
    }
  }

  // Watchlist sync — one lightweight quote payload, not a full stock row per symbol.
  async function refreshWatchlistQuotes(symbolList) {
    if (!symbolList?.length) return;
    try {
      const res = await fetch("/api/watchlist/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: symbolList }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const quotes = data?.quotes;
      if (!Array.isArray(quotes) || !quotes.length) return;
      const fresh = new Map(quotes.filter((q) => q?.symbol).map((q) => [q.symbol, q]));
      const patch = (row) => {
        const q = fresh.get(row.symbol);
        if (!q) return row;
        return {
          ...row,
          price: q.price ?? row.price,
          volume: q.volume ?? row.volume,
          mcap: q.mcap ?? row.mcap,
          price_updated_at: q.price_updated_at ?? row.price_updated_at,
        };
      };
      stocksRef.current = stocksRef.current.map(patch);
      setStocks((prev) => prev.map(patch));
    } catch {
      // ignore transient network errors
    }
  }

  // ── Combined enrichment SSE loader ───────────────────────────────────────

  function enrichAll(symbols, force = false, onComplete = null) {
    if (enrichLoading) return;

    // Fire the completion callback exactly once, however the stream ends (done,
    // error, or network failure) — used by the per-symbol re-gather to know when
    // to reload the detail panes.
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      if (onComplete) onComplete();
    };

    const controller = startLongOperation();

    const payload = {};
    if (symbols) payload.symbols = symbols;
    if (force) payload.force = true;
    const body = JSON.stringify(payload);

    fetch("/api/stocks/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          // The request failed (e.g. rate limiter on the enrich endpoint itself)
          setEnrichLoading(false);
          setLoadProg(null);
          loadProgRef.current = null;
          console.error("Enrich request failed with status", res.status);
          finish();
          return;
        }

        // Only show the loading bar once we have a real response streaming
        setEnrichLoading(true);
        const initialProg = { done: 0, total: null, errors: 0 };
        setLoadProg(initialProg);
        loadProgRef.current = initialProg;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) {
              setEnrichLoading(false);
              setLoadProg(null);
              return;
            }
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6));

                if (evt.type === "progress") {
                  const prog = {
                    done: evt.done,
                    total: evt.total,
                    errors: evt.errors,
                  };
                  setLoadProg(prog);
                  loadProgRef.current = prog;

                  // Go back to normal "Enriching" message after rate limit status
                  setStatus({
                    type: "loading",
                    msg: `Enriching: ${evt.done} / ${evt.total}`,
                  });
                } else if (evt.type === "status") {
                  // Show rate limit / queued messages from the backend,
                  // including current progress numbers if available
                  let msg = evt.message || "Waiting...";
                  const currentProg = loadProgRef.current;
                  if (currentProg && currentProg.done != null && currentProg.total != null) {
                    msg = `${msg} (${currentProg.done} / ${currentProg.total})`;
                  }
                  setStatus({
                    type: "loading",
                    msg,
                  });
                } else if (evt.type === "done") {
                  currentAbortRef.current = null;
                  setLoadProg(null);
                  loadProgRef.current = null;
                  setEnrichLoading(false);
                  setHasEnrichedOnce(true);
                  // Small explicit gather (e.g. single-symbol re-gather) → patch just
                  // those rows; larger ones → full reload.
                  if (symbols && symbols.length > 0 && symbols.length <= 5) {
                    mergeStocks(symbols);
                    setEnrichNotice({ symbols: [...symbols], at: Date.now() });
                  } else {
                    loadStocks(false, true);
                  }
                  finish();
                } else if (evt.type === "error") {
                  currentAbortRef.current = null;
                  setEnrichLoading(false);
                  setLoadProg(null);
                  loadProgRef.current = null;
                  finish();
                }
              } catch {}
            }
            pump();
          }).catch((e) => {
            currentAbortRef.current = null;
            setEnrichLoading(false);
            setLoadProg(null);
            loadProgRef.current = null;
            if (!isAbortError(e)) {
              console.error("Enrich stream read failed:", e);
            }
            finish();
          });
        }
        pump();
      })
      .catch((e) => {
        setEnrichLoading(false);
        setLoadProg(null);
        loadProgRef.current = null;
        currentAbortRef.current = null;
        if (!isAbortError(e)) {
          console.error("Enrich request failed:", e);
        }
        finish();
      });
  }

  // Auto-enrich feature disabled (per user request)

  // ── Pins ──────────────────────────────────────────────────────────────────

  function togglePin(symbol) {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);

      // Persist pins into the currently active screener/tab
      setTabsState((prevTabs) => {
        const nextTabs = prevTabs.map((t) =>
          t.id === activeTab
            ? {
                ...t,
                state: {
                  ...(t.state || {}),
                  pins: [...next],
                },
              }
            : t,
        );
        saveTabs(user, nextTabs);
        if (hydratedRef.current) patchUserSettings({ tabs: nextTabs });
        return nextTabs;
      });

      return next;
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  function setFilters(f) {
    setFiltersRaw(f);

    // Auto-save filters + current pins to the active (non-default) tab
    setTabsState((prev) => {
      const next = prev.map((t) =>
        t.id === activeTab && activeTab !== "default"
          ? {
              ...t,
              state: {
                ...f,
                pins: [...pins],
              },
            }
          : t,
      );
      saveTabs(user, next);
      if (hydratedRef.current) patchUserSettings({ tabs: next });
      return next;
    });
  }

  // Used when Ori populates filter inputs from natural language.
  function applyFiltersFromAI(f) {
    setFilters(f);
  }

  function activateTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;

    setActiveTabState(id);
    localStorage.setItem(activeKey(user), id);
    if (hydratedRef.current) patchUserSettings({ activeTab: id });

    const tabState = tab.state || {};
    const restored = {
      ...DEFAULT_FILTERS,
      ...tabState,
      universe: normalizeUniverse(tabState),
    };
    setFiltersRaw(restored);

    // Load pins specific to this screener/tab
    const tabPins = Array.isArray(tabState.pins) ? new Set(tabState.pins) : new Set();
    setPins(tabPins);
  }

  function createTab(name) {
    const id = "tab_" + Date.now();
    const newTab = {
      id,
      name: name.slice(0, 28),
      state: {
        ...filters,
        pins: [...pins], // carry over current favorites for this new screener
      },
    };
    setTabsState((prev) => {
      const next = [...prev, newTab];
      saveTabs(user, next);
      if (hydratedRef.current) patchUserSettings({ tabs: next, activeTab: id });
      return next;
    });
    setActiveTabState(id);
    localStorage.setItem(activeKey(user), id);
  }

  function deleteTab(id) {
    setTabsState((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveTabs(user, next);
      if (hydratedRef.current) patchUserSettings({ tabs: next });
      return next;
    });
    if (activeTab === id) activateTab("default");
  }

  // ── Add ticker ────────────────────────────────────────────────────────────

  async function addTicker(symbol) {
    const res = await fetch("/api/stocks/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    // Merge into state
    setStocks((prev) => {
      const next = prev.filter((r) => r.symbol !== data.stock.symbol);
      return [...next, data.stock];
    });
    return data.stock;
  }

  return {
    stocks,
    filtered: convictionFiltered,  // post-filter rows (incl. Conviction filter); lite/cached Ori reviews folded in
    // Filtered set BEFORE conviction scoring — the table uses it for the heatmap.
    filteredRows,
    status,
    lastFetch,
    filters,
    setFilters,
    applyFiltersFromAI,
    risk,
    setRisk,
    persona,
    setPersona,
    horizon,
    setHorizon,
    goal,
    setGoal,
    pillarWeights,
    tableSortKey,
    tableSortDir,
    setTableSort,
    setConvictionOverride,
    fitCtx,
    pins,
    togglePin,
    tabs,
    activeTab,
    activateTab,
    createTab,
    deleteTab,
    loadStocks,
    mergeStocks,
    refreshWatchlistQuotes,
    // scope='visible' (default): act only on the on-screen (filtered) rows — fetch
    //   the ones still missing data, or force-refresh them all if they're already
    //   enriched.
    // scope='all': force re-gather the ENTIRE loaded universe, ignoring filters and
    //   what's on screen. These are deliberately two different operations.
    enrichAll: (scope = "visible") => {
      if (scope === "all") {
        return enrichAll(null, true); // no symbols list + force => backend uses getAllStocks()
      }
      // ETFs are never enriched, so exclude them from both the force-refresh set
      // and the missing set (otherwise they'd inflate counts and waste calls).
      const visible = filtered.filter((r) => !r.is_etf).map((r) => r.symbol);
      if (!visible.length) return;
      const missing = filtered
        .filter((r) => !r.is_etf && (!r.has_km || !r.has_rat))
        .map((r) => r.symbol);
      // Some on-screen rows still need their first gather → fetch just those.
      // Otherwise everything visible is already loaded and the user wants a refresh
      // → force-re-fetch the visible set (but NOT the rest of the universe).
      return missing.length
        ? enrichAll(missing, false)
        : enrichAll(visible, true);
    },
    // Re-gather everything for a single symbol (e.g. the Deep Research page): force
    // re-fetch its metrics/ratios/DCF/profile/etc. `onComplete` fires when the
    // server-side refresh is done, so the caller can reload the detail panes.
    regatherSymbol: (symbol, onComplete) => {
      if (!symbol) return;
      return enrichAll([symbol], true, onComplete);
    },
    enrichLoading,
    enrichNotice,
    clearEnrichNotice: () => setEnrichNotice(null),
    loadProgress,
    hasEnrichedOnce,
    addTicker,
    cancelOperation: cancelCurrentOperation,
  };
}
