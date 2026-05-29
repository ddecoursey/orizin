import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { computeRankedRows, applyWeights } from "../lib/scoring.js";

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
function savePins(user, pins) {
  try {
    localStorage.setItem(pinsKey(user), JSON.stringify([...pins]));
  } catch {}
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
  // Default is now global (with backend 500M mkt cap floor on fetch).
  universe: "global",
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

function applyFilters(all, f, pins) {
  const g = (k, mul = 1) =>
    f[k] === "" || f[k] == null ? null : Number(f[k]) * mul;
  const ok = (val, op, cmp) => {
    if (cmp === null) return true;
    if (val === null || !isFinite(val)) return true;
    return op === ">=" ? val >= cmp : val <= cmp;
  };
  const p = (v) => (v == null ? null : v * 100);
  const sectorSet = f.sectors?.length ? new Set(f.sectors) : null;
  const industrySet = f.industries?.length ? new Set(f.industries) : null;
  const search = (f.search || "").trim().toLowerCase();

  return all.filter((r) => {
    if (f.pinnedOnly && !pins.has(r.symbol)) return false;

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
    if (!ok(r.mcap ? r.mcap / 1e9 : null, ">=", g("mcapMin"))) return false;
    if (g("mcapMax") != null && r.mcap != null && r.mcap / 1e9 > g("mcapMax"))
      return false;
    if (!ok(r.volume ? r.volume / 1e6 : null, ">=", g("volMin"))) return false;
    if (!ok(p(r.gross_margin), ">=", g("grossMin"))) return false;
    if (!ok(p(r.op_margin), ">=", g("opMin"))) return false;
    if (!ok(p(r.net_margin), ">=", g("netMin"))) return false;
    if (!ok(p(r.ebitda_margin), ">=", g("ebitdaMin"))) return false;
    if (!ok(p(r.fcf_margin), ">=", g("fcfMargMin"))) return false;
    if (!ok(p(r.roic), ">=", g("roicMin"))) return false;
    if (!ok(p(r.roe), ">=", g("roeMin"))) return false;
    if (!ok(p(r.roa), ">=", g("roaMin"))) return false;
    if (!ok(p(r.revenue_growth), ">=", g("revGrowthMin"))) return false;
    if (!ok(p(r.eps_growth), ">=", g("epsGrowthMin"))) return false;
    if (!ok(p(r.fcf_growth), ">=", g("fcfGrowthMin"))) return false;
    if (g("r40Min") != null) {
      const margin = r.ebitda_margin ?? r.fcf_margin;
      if (r.revenue_growth == null || margin == null) return false;
      if ((r.revenue_growth + margin) * 100 < g("r40Min")) return false;
    }
    if (!ok(r.pe, "<=", g("peMax"))) return false;
    if (!ok(r.pb, "<=", g("pbMax"))) return false;
    if (!ok(r.ps, "<=", g("psMax"))) return false;
    if (!ok(r.ev_ebitda, "<=", g("evEbMax"))) return false;
    if (!ok(r.ev_sales, "<=", g("evSMax"))) return false;
    if (!ok(r.ev_gp, "<=", g("evGpMax"))) return false;
    if (!ok(p(r.fcf_yield), ">=", g("fcfMin"))) return false;
    if (!ok(r.net_debt_ebitda, "<=", g("ndMax"))) return false;
    if (!ok(r.current_ratio, ">=", g("crMin"))) return false;
    if (!ok(r.debt_equity, "<=", g("deMax"))) return false;
    if (!ok(p(r.div_yield), ">=", g("divMin"))) return false;
    if (
      g("payMax") != null &&
      r.payout != null &&
      isFinite(r.payout) &&
      r.payout * 100 > g("payMax")
    )
      return false;
    if (!ok(r.beta, ">=", g("betaMin"))) return false;
    if (!ok(r.beta, "<=", g("betaMax"))) return false;
    return true;
  });
}

export function useScreener(currentUser) {
  const user = currentUser || "default";
  // Run migration synchronously before any state init so loadPins/loadTabs
  // see the migrated values on first render.
  if (typeof window !== "undefined") migrateLegacyIfNeeded(user);

  const [stocks, setStocks] = useState([]);
  const [status, setStatus] = useState({ type: "loading", msg: "Connecting…" });
  const [lastFetch, setLastFetch] = useState(null);
  const [filters, setFiltersRaw] = useState({ ...DEFAULT_FILTERS });
  const [weights, setWeights] = useState({ q: 25, v: 25, b: 15, d: 20, g: 15 });
  const [tabs, setTabsState] = useState(() => loadTabs(user));
  const [activeTab, setActiveTabState] = useState(
    () => localStorage.getItem(activeKey(user)) || "default",
  );

  // Pins are now per active tab/screener (not global)
  const initialActiveTab = localStorage.getItem(activeKey(user)) || "default";
  const initialTab = tabs.find((t) => t.id === initialActiveTab);
  const initialPins = initialTab?.state?.pins && Array.isArray(initialTab.state.pins)
    ? new Set(initialTab.state.pins)
    : new Set();

  const [pins, setPins] = useState(initialPins);
  const [loadProgress, setLoadProg] = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [hasEnrichedOnce, setHasEnrichedOnce] = useState(false);
  const stocksRef = useRef([]);
  // Auto-enrich refs removed (feature disabled)
  const currentAbortRef = useRef(null); // for cancelling refresh or enrich
  const loadProgRef = useRef(null); // latest progress numbers for status messages

  // Derived - split heavy ranking from light weighting for better slider perf
  const filteredRows = useMemo(
    () => applyFilters(stocks, filters, pins),
    [stocks, filters, pins]
  );

  const rankedData = useMemo(
    () => computeRankedRows(filteredRows),
    [filteredRows]
  );

  const filtered = useMemo(
    () => applyWeights(rankedData, weights),
    [rankedData, weights]
  );

  // ── Data loading ─────────────────────────────────────────────────────────

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

  function streamRefresh(onDone, force = false) {
    const controller = startLongOperation();

    setStatus({ type: "loading", msg: "Fetching profiles from FMP…" });
    setLoadProg({ done: 0, total: null, errors: 0 });

    const opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };

    const refreshBody = {
      force: !!force,
      scope: normalizeUniverse(filters),
    };
    opts.body = JSON.stringify(refreshBody);

    fetch("/api/stocks/refresh", opts)
      .then((res) => {
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
          });
        }
        pump();
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
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
      const res = await fetch("/api/stocks");
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

  useEffect(() => {
    loadStocks();
  }, []);

  // ── Combined enrichment SSE loader ───────────────────────────────────────

  function enrichAll(symbols, force = false) {
    if (enrichLoading) return;

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
                  loadStocks(false, true);
                } else if (evt.type === "error") {
                  currentAbortRef.current = null;
                  setEnrichLoading(false);
                  setLoadProg(null);
                  loadProgRef.current = null;
                }
              } catch {}
            }
            pump();
          });
        }
        pump();
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') {
          setEnrichLoading(false);
          setLoadProg(null);
          loadProgRef.current = null;
        }
        currentAbortRef.current = null;
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
      return next;
    });
    setActiveTabState(id);
    localStorage.setItem(activeKey(user), id);
  }

  function deleteTab(id) {
    setTabsState((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveTabs(user, next);
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
    filtered,
    status,
    lastFetch,
    filters,
    setFilters,
    applyFiltersFromAI,
    weights,
    setWeights,
    pins,
    togglePin,
    tabs,
    activeTab,
    activateTab,
    createTab,
    deleteTab,
    loadStocks,
    // Normal call → only missing data. Pass true (or call enrichAll(true)) to force re-enrich everything visible.
    enrichAll: (force = false) => {
      const targets = force
        ? filtered.map((r) => r.symbol)
        : filtered
            .filter((r) => !r.has_km || !r.has_rat)
            .map((r) => r.symbol);
      return enrichAll(targets, force);
    },
    enrichLoading,
    loadProgress,
    hasEnrichedOnce,
    addTicker,
    cancelOperation: cancelCurrentOperation,
  };
}
