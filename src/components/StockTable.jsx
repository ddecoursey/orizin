import { useState, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fmt } from "../lib/format.js";
import { SECTOR_COLORS } from "../lib/scoring.js";
import Sparkline from "./Sparkline";
import { IconSearch } from "./icons.jsx";
import Tooltip from "./Tooltip.jsx";
import OriTip from "./OriTip.jsx";
import { resolveSortField, tierColumnDefs } from "../lib/screenerDisplay.js";

const GOOD_H = new Set([
  "gross_margin",
  "op_margin",
  "net_margin",
  "ebitda_margin",
  "fcf_margin",
  "roic",
  "roe",
  "roa",
  "fcf_yield",
  "current_ratio",
  "div_yield",
  "revenue_growth",
  "eps_growth",
  "fcf_growth",
  "rule_of_40",
]);
const GOOD_L = new Set([
  "pe",
  "pb",
  "ps",
  "ev_ebitda",
  "ev_sales",
  "ev_gp",
  "net_debt_ebitda",
  "debt_equity",
]);

function buildHeat(rows) {
  const h = {};
  for (const key of [...GOOD_H, ...GOOD_L]) {
    h[key] = rows
      .map((r) => r[key])
      .filter((v) => v !== null && isFinite(v))
      .sort((a, b) => a - b);
  }
  return h;
}
function heatClass(val, key, heat) {
  if (val === null || !isFinite(val)) return "";
  const arr = heat[key];
  if (!arr || arr.length < 8) return "";
  const rank = arr.filter((v) => v < val).length / arr.length;
  const p = GOOD_H.has(key) ? rank : 1 - rank;
  if (p >= 0.8) return "bg-emerald-900/40 text-emerald-300";
  if (p >= 0.6) return "bg-emerald-900/20 text-emerald-400/80";
  if (p <= 0.2) return "bg-red-900/40 text-red-300";
  if (p <= 0.4) return "bg-red-900/20 text-red-400/80";
  return "";
}

function SectorChip({ sector }) {
  const c = SECTOR_COLORS[sector] || { bg: "#1e293b", fg: "#94a3b8" };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[9.5px] font-medium whitespace-nowrap"
      style={{ background: c.bg, color: c.fg }}
    >
      {sector || "—"}
    </span>
  );
}

function ScoreBar({ score }) {
  if (score == null) return <span className="text-gray-600">—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "#10b981" : pct >= 45 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-bold w-5 text-right" style={{ color }}>
        {pct}
      </span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden min-w-[40px]">
        <div
          className="h-full rounded-full"
          style={{ width: pct + "%", background: color }}
        />
      </div>
    </div>
  );
}

const COLS = [
  { key: "pin", label: "★", left: true, nosort: true },
  { key: "symbol", label: "Symbol", left: true, plain: true },
  { key: "sector", label: "Sector", left: true, plain: true },
  { key: "mcap", label: "Mkt Cap", plain: true, type: "money" },
  { key: "price", label: "Price", plain: true, type: "price" },
  { key: "conviction", label: "Conviction", plain: true, nosort: false },
  { key: "durabilityProxy", label: "Dur", plain: true },
  { key: "trend", label: "Trend", plain: true, nosort: true },
  { key: "beta", label: "Beta", plain: true, type: "ratio" },
  { key: "pe", label: "P/E", type: "x" },
  { key: "pb", label: "P/B", type: "x" },
  { key: "ps", label: "P/S", type: "x" },
  { key: "ev_ebitda", label: "EV/EBITDA", type: "x" },
  { key: "ev_sales", label: "EV/S", type: "x" },
  { key: "ev_gp", label: "EV/GP", type: "x" },
  { key: "fcf_yield", label: "FCF Yld", type: "pct" },
  { key: "earnings_yield", label: "Earn Yld", type: "pct" },
  { key: "gross_margin", label: "Gross M", type: "pct" },
  { key: "op_margin", label: "Op M", type: "pct" },
  { key: "net_margin", label: "Net M", type: "pct" },
  { key: "fcf_margin", label: "FCF M", type: "pct" },
  { key: "roic", label: "ROIC", type: "pct" },
  { key: "roe", label: "ROE", type: "pct" },
  { key: "roa", label: "ROA", type: "pct" },
  { key: "revenue_growth", label: "Rev Gr", type: "pct" },
  { key: "eps_growth", label: "EPS Gr", type: "pct" },
  { key: "fcf_growth", label: "FCF Gr", type: "pct" },
  { key: "op_income_growth", label: "Op Inc Gr", type: "pct" },
  { key: "rule_of_40", label: "R40", type: "r40" },
  { key: "net_debt_ebitda", label: "ND/EB", type: "ratio" },
  { key: "current_ratio", label: "Curr R", type: "ratio" },
  { key: "debt_equity", label: "D/E", type: "ratio" },
  { key: "div_yield", label: "Div Yld", type: "pct" },
];

const COL_WIDTHS = {
  pin: "32px",
  symbol: "92px",
  sector: "92px",
  mcap: "78px",
  price: "58px",
  conviction: "92px",
  durabilityProxy: "42px",
  trend: "58px",
  beta: "44px",
  pe: "52px",
  pb: "52px",
  ps: "52px",
  ev_ebitda: "68px",
  ev_sales: "52px",
  ev_gp: "52px",
  fcf_yield: "58px",
  earnings_yield: "58px",
  gross_margin: "58px",
  op_margin: "52px",
  net_margin: "52px",
  fcf_margin: "52px",
  roic: "52px",
  roe: "52px",
  roa: "52px",
  revenue_growth: "58px",
  eps_growth: "52px",
  fcf_growth: "52px",
  op_income_growth: "58px",
  rule_of_40: "44px",
  net_debt_ebitda: "52px",
  current_ratio: "52px",
  debt_equity: "48px",
  div_yield: "58px",
};

export default function StockTable({
  rows,
  heatRows = rows,
  pins,
  onTogglePin,
  canUseOri = true,
  onUpgradeToPro,
  onAskAI,
  onSelectStock,
  enrichLoading = false,
  sparklineForceVersion = 0,
  sortKey = "mcap",
  sortDir = -1,
  onSortChange,
}) {
  const cols = useMemo(() => tierColumnDefs(COLS), []);
  // symbol -> number[]. localStorage hydration happens lazily per symbol inside
  // fetchSparklineInternal (getSparklineFromLocal) — the old eager loop parsed
  // every persisted sparkline JSON blob synchronously at mount, which scaled
  // with the total number of symbols ever viewed and visibly slowed startup.
  const [sparklines, setSparklines] = useState(() => new Map());

  // Memoize expensive computations. Heat (per-column percentile colouring) depends
  // only on the metric distributions, which don't change when the Q/V/G weights move
  // — so key it on the pre-weight `heatRows` to avoid re-sorting ~20 columns on every
  // slider tick. Values are identical to building from `rows` (same securities).
  const heat = useMemo(() => buildHeat(heatRows), [heatRows]);

  // Fetch historical prices for sparklines (lazy, for visible rows)
  const inFlightRef = useRef(new Set());

  // Note: fetchSparkline is now internal + scheduled via scheduleSparklineFetch for concurrency control

  // Concurrency control for sparklines (max 10 at a time)
  const MAX_SPARKLINE_CONCURRENCY = 10;
  const activeSparklineFetches = useRef(0);
  const sparklineQueue = useRef([]);

  const processSparklineQueue = () => {
    while (activeSparklineFetches.current < MAX_SPARKLINE_CONCURRENCY && sparklineQueue.current.length > 0) {
      const item = sparklineQueue.current.shift(); // { symbol, force }
      const symbol = typeof item === 'string' ? item : item.symbol;
      const force = typeof item === 'object' ? !!item.force : false;

      if (!force && (sparklines.has(symbol) || inFlightRef.current.has(symbol))) {
        // Skip if already fetched or in flight (unless forcing)
        continue;
      }
      activeSparklineFetches.current++;
      fetchSparklineInternal(symbol, force).finally(() => {
        activeSparklineFetches.current--;
        processSparklineQueue();
      });
    }
  };

  const scheduleSparklineFetch = (symbol, force = false) => {
    if (!force && (sparklines.has(symbol) || inFlightRef.current.has(symbol))) return;

    if (force) {
      // On force, clear any in-flight guard and existing data so we re-fetch
      inFlightRef.current.delete(symbol);
      setSparklines(prev => {
        const next = new Map(prev);
        next.delete(symbol);
        return next;
      });
      // Also clear localStorage cache for this symbol so we don't serve stale on next normal load
      try {
        localStorage.removeItem(`sparkline_v1:${symbol}:45`);
      } catch {}
    }

    const item = { symbol, force };

    // Avoid duplicates in queue (unless forcing)
    const alreadyQueued = sparklineQueue.current.some(i =>
      (typeof i === 'string' ? i : i.symbol) === symbol
    );

    if (force || !alreadyQueued) {
      if (force) {
        // Put force requests at the front
        sparklineQueue.current.unshift(item);
      } else {
        sparklineQueue.current.push(item);
      }
    }
    processSparklineQueue();
  };

  // Simple localStorage-backed cache for sparklines so we don't hammer the backend (and thus FMP)
  // on every page reload or when scrolling to new symbols that were previously loaded.
  const getSparklineFromLocal = (symbol, days) => {
    try {
      const key = `sparkline_v1:${symbol}:${days}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Consider data fresh for a long time (e.g. 30 days) unless force is used
      const maxAge = 1000 * 60 * 60 * 24 * 30;
      if (Date.now() - parsed.savedAt < maxAge) {
        return parsed.prices;
      }
    } catch {}
    return null;
  };

  const saveSparklineToLocal = (symbol, days, prices) => {
    try {
      const key = `sparkline_v1:${symbol}:${days}`;
      localStorage.setItem(key, JSON.stringify({
        prices,
        savedAt: Date.now(),
      }));
    } catch {}
  };

  // The actual fetch logic (renamed from fetchSparkline)
  const fetchSparklineInternal = async (symbol, force = false) => {
    if (!force && (sparklines.has(symbol) || inFlightRef.current.has(symbol))) return;

    inFlightRef.current.add(symbol);

    try {
      // First check localStorage (unless forcing)
      if (!force) {
        const localPrices = getSparklineFromLocal(symbol, 45);
        if (localPrices && localPrices.length > 0) {
          setSparklines(prev => {
            const next = new Map(prev);
            next.set(symbol, localPrices);
            return next;
          });
          inFlightRef.current.delete(symbol);
          return;
        }
      }

      const forceParam = force ? '&force=1' : '';
      const res = await fetch(`/api/stocks/sparkline/${symbol}?days=45${forceParam}`);
      if (!res.ok) return;

      const data = await res.json();
      const prices = data.prices?.map(p => p.price) || [];

      setSparklines(prev => {
        const next = new Map(prev);
        next.set(symbol, prices);
        return next;
      });

      // Persist to localStorage for fast reloads
      if (prices.length > 0) {
        saveSparklineToLocal(symbol, 45, prices);
      }
    } catch {
      // Network hiccup — the cell keeps its placeholder; a later scroll retries.
    } finally {
      inFlightRef.current.delete(symbol);
    }
  };

  const sorted = useMemo(() => {
    const pinnedSet = pins;
    const sortField = resolveSortField(sortKey);
    return [...rows].sort((a, b) => {
      const ap = pinnedSet.has(a.symbol),
        bp = pinnedSet.has(b.symbol);
      if (ap !== bp) return ap ? -1 : 1;
      const av = a[sortField];
      const bv = b[sortField];
      if (av == null || av === "" || (typeof av === "number" && !isFinite(av))) return 1;
      if (bv == null || bv === "" || (typeof bv === "number" && !isFinite(bv))) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * sortDir;
      }
      return (av - bv) * sortDir;
    });
  }, [rows, pins, sortKey, sortDir]);

  // Virtualization setup - Battle-tested pattern for large tables in flex layouts
  const parentRef = useRef(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual opts this component out of React Compiler memoization; expected and fine for a virtualized table.
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,           // Base row height estimate (adjust if your rows are consistently taller/shorter)
    overscan: 45,                     // Higher overscan = smoother "infinite scroll" feel, minimal perf cost for tables
    getItemKey: (index) => sorted[index]?.symbol ?? index, // Stable keys prevent unnecessary re-renders
  });

  // Computed during render (the virtualizer re-renders this component as you
  // scroll), so effects keyed on `visibleRangeKey` actually re-run when the
  // visible window moves. The previous version read getVirtualItems() inside
  // an effect whose deps never changed on scroll — newly revealed rows kept
  // their "loading" placeholder until some unrelated state change kicked it.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const visibleRangeKey = virtualItems.length
    ? `${virtualItems[0].index}:${virtualItems[virtualItems.length - 1].index}`
    : "";

  // 5-second delay before enabling sparkline fetching on initial load
  const [sparklinesEnabled, setSparklinesEnabled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSparklinesEnabled(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  // Fetch sparklines for currently visible rows (lazy loading).
  // Load whenever no heavy enrich/refresh fetch is running — not every ticker
  // will ever have data, so we don't wait for the "missing" count to hit zero.
  useEffect(() => {
    if (!sparklinesEnabled || enrichLoading) return;

    const visibleSymbols = rowVirtualizer.getVirtualItems()
      .map(vi => sorted[vi.index]?.symbol)
      .filter(Boolean);

    visibleSymbols.forEach(symbol => {
      // Skip if we already have it (either from this session or hydrated from localStorage)
      if (sparklines.has(symbol) || inFlightRef.current.has(symbol)) {
        return;
      }
      scheduleSparklineFetch(symbol);
    });
  }, [visibleRangeKey, sorted, sparklines, sparklinesEnabled, enrichLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the parent triggers a Force Re-gather, also force-refresh
  // sparklines for whatever is currently visible.
  useEffect(() => {
    if (sparklineForceVersion === 0) return;

    const visibleSymbols = rowVirtualizer.getVirtualItems()
      .map(vi => sorted[vi.index]?.symbol)
      .filter(Boolean);

    visibleSymbols.forEach(symbol => {
      scheduleSparklineFetch(symbol, true); // force = true
    });
  }, [sparklineForceVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(key) {
    const col = cols.find((c) => c.key === key);
    if (col?.nosort || !onSortChange) return;
    if (sortKey === key) onSortChange(key, -sortDir);
    else onSortChange(key, key === "symbol" || key === "sector" ? 1 : -1);
  }

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  // Robust height measurement - critical for large lists in flex layouts
  // Using useLayoutEffect for more reliable synchronous measurement after render
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const measure = () => rowVirtualizer.measure();

    // Staggered initial measurements to catch layout shifts
    const t1 = setTimeout(measure, 50);
    const t2 = setTimeout(measure, 200);
    const t3 = setTimeout(measure, 600);

    // Watch for size changes (window resize, sidebar toggle, etc.)
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    window.addEventListener('resize', measure);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [rowVirtualizer]);

  // Re-measure + scroll to top when the dataset changes significantly
  // (new filters, sort change, initial load). This prevents "stuck" scroll position.
  useEffect(() => {
    const id = setTimeout(() => {
      rowVirtualizer.measure();
      // Optional: scroll to top when filters change drastically
      // rowVirtualizer.scrollToOffset(0);
    }, 30);
    return () => clearTimeout(id);
  }, [sorted.length, rowVirtualizer]);

  return (
    <div 
      ref={parentRef} 
      className="overflow-auto flex-1 min-h-0 overscroll-contain"
      style={{ height: '100%' }}
    >
      <table className="w-full border-collapse text-xs">
        {/* Define column widths for stable "lanes" even with virtualization */}
        <colgroup>
          {COLS.map((c) => (
            <col key={c.key} style={{ width: COL_WIDTHS[c.key] }} />
          ))}
          <col style={{ width: '52px' }} />     {/* Ask Ori */}
        </colgroup>

        <thead className="sticky top-0 z-20 bg-gray-950">
          <tr>
            {cols.map((c) => {
              const w = COL_WIDTHS[c.key] || COL_WIDTHS[c.key === "orizin" ? "conviction" : c.key];
              return (
                <th
                  key={c.key}
                  onClick={() => handleSort(c.key)}
                  style={w ? { width: w } : undefined}
                  className={`px-3 py-2 whitespace-nowrap text-[9px] uppercase tracking-wider
                    font-bold border-b border-gray-800
                    ${c.left ? "text-left" : "text-right"}
                    ${c.nosort ? "cursor-default" : "cursor-pointer hover:bg-gray-900"}
                    ${sortKey === c.key ? "text-blue-400 bg-gray-900" : "text-gray-500"}
                    ${c.key === "pin" ? "sticky left-0 z-40 border-r border-gray-950 bg-gray-950" : ""}
                    ${c.key === "symbol" ? "sticky left-[32px] z-40 bg-gray-950" : ""}`}
                >
                  {c.key === "conviction" ? (
                    <Tooltip
                      content={
                        canUseOri
                          ? "0–100 conviction from fundamentals + Ori when available. Refines on Deep Research."
                          : "0–100 conviction from fundamentals and market data — no Ori on Free."
                      }
                      maxWidth={220}
                    >
                      {c.label}{canUseOri ? <> <span className="text-violet-400/80">+ Ori</span></> : null}
                    </Tooltip>
                  ) : (
                    c.label
                  )}
                  {sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : ""}
                </th>
              );
            })}
            {onAskAI && (
              <th className="px-2 py-2 border-b border-gray-800 bg-gray-950" style={{ width: '52px' }} />
            )}
          </tr>
        </thead>

        <tbody>
          {/* Spacer rows give the table its full virtual height. CSS padding
              does not apply to table-row-groups, so the old tbody padding was
              silently ignored — the scrollbar only ever reflected the rendered
              slice and jumping/dragging through a large universe misbehaved. */}
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={cols.length + (onAskAI ? 1 : 0)} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
            </tr>
          )}
          {virtualItems.map((virtualRow) => {
            const r = sorted[virtualRow.index];
            if (!r) return null;

            const pinned = pins.has(r.symbol);

            return (
              <tr
                key={r.symbol}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className={`group border-b border-gray-800/50 hover:bg-gray-800/40 transition-[background-color] duration-75
                  ${pinned ? "bg-amber-900/10" : ""}`}
              >
                {/* Pin — sticky col 1 */}
                <td
                  className={`px-3 py-2 text-left sticky left-0 z-10 border-r border-gray-950 ${pinned ? "bg-amber-950" : "bg-gray-950 group-hover:bg-gray-900"}`}
                  style={{ width: '32px', minWidth: '32px' }}
                >
                  <button
                    onClick={() => onTogglePin(r.symbol)}
                    className={`inline-flex items-center justify-center w-7 h-7 -my-1 text-base leading-none ${
                      pinned ? "text-amber-400" : "text-gray-700 hover:text-amber-400"
                    }`}
                    title={pinned ? "Unpin from screener" : "Pin to screener"}
                  >
                    {pinned ? "★" : "☆"}
                  </button>
                </td>

                {/* Symbol + name — sticky col 2 */}
                <td
                  className={`px-3 py-2 text-left sticky left-10 z-10 ${pinned ? "bg-amber-950" : "bg-gray-950 group-hover:bg-gray-900"}`}
                  style={{ width: '92px', minWidth: '92px', left: '32px' }}
                >
                  <div
                    className={`flex flex-col gap-0.5 ${onSelectStock ? "cursor-pointer group/sym" : ""}`}
                    onClick={() => onSelectStock?.(r)}
                    title={onSelectStock ? "View company details" : undefined}
                  >
                    <div className="flex items-center gap-1">
                      {r.has_km ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Metrics loaded" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" title="Metrics not loaded" />
                      )}
                      <span className="font-bold text-gray-100 text-[11.5px] group-hover/sym:text-blue-400">{r.symbol}</span>
                    </div>
                    <span className="text-[9.5px] text-gray-500 max-w-[130px] truncate">{r.name}</span>
                  </div>
                </td>

                {/* Sector */}
                <td className="px-3 py-2 text-left">
                  <SectorChip sector={r.sector} />
                </td>

                {/* Mcap */}
                <td className="px-3 py-2 text-right font-mono text-gray-300">
                  {fmt(r.mcap, "money") ?? <span className="text-gray-600">—</span>}
                </td>
                {/* Price */}
                <td className="px-3 py-2 text-right font-mono text-gray-300">
                  {fmt(r.price, "price") ?? <span className="text-gray-600">—</span>}
                </td>

                {/* Conviction (Pro) or Orizin Score (free) */}
                <td className="px-3 py-2 min-w-[80px]">
                  <span className="inline-flex items-center">
                    <Tooltip
                      content={
                        r.conviction != null && r.dataCoveragePenalty > 0
                          ? `${r.conviction} (base ${r.baseConviction} −${r.dataCoveragePenalty}). Sparse Q/V/G data.`
                          : r.conviction != null
                            ? canUseOri
                              ? "Conviction (0–100) with Ori when available."
                              : "Conviction (0–100) from fundamentals — no Ori on Free."
                            : undefined
                      }
                    >
                      <span><ScoreBar score={r.conviction != null ? r.conviction / 100 : null} /></span>
                    </Tooltip>
                    {r.dataCoveragePenalty > 0 && (
                      <Tooltip content={`−${r.dataCoveragePenalty} penalty`}>
                        <span className="ml-1 text-[9px] text-amber-400 align-super">↓</span>
                      </Tooltip>
                    )}
                    {canUseOri && r.ori && (
                      <Tooltip content={<OriTip ori={r.ori} />} maxWidth={200}>
                        <span className="ml-1 text-[8px] text-purple-400 align-super cursor-help">✧</span>
                      </Tooltip>
                    )}
                  </span>
                </td>

                {/* Durability / intangibles proxy (cheap Ori equivalent) */}
                <td className="px-1 py-2 text-center font-mono text-[9px] text-gray-400">
                  <Tooltip content="0–100 quality proxy. Penalizes paper-perfect junk. Full Ori review on ✧ or Deep Research.">
                    <span>{r.durabilityProxy ?? <span className="text-gray-600">—</span>}</span>
                  </Tooltip>
                </td>

                {/* Trend Sparkline (real historical prices) */}
                <td className="px-2 py-2 text-center">
                  {sparklines.has(r.symbol) ? (
                    <Sparkline 
                      data={sparklines.get(r.symbol)} 
                      color={
                        sparklines.get(r.symbol).length > 1 &&
                        sparklines.get(r.symbol).at(-1) > sparklines.get(r.symbol)[0]
                          ? '#22c55e' 
                          : '#ef4444'
                      }
                    />
                  ) : (
                    <div className="h-[22px] w-[64px] bg-gray-800/40 rounded flex items-center justify-center">
                      <span className="text-[8px] text-gray-600">loading</span>
                    </div>
                  )}
                </td>

                {/* Beta */}
                <td className="px-3 py-2 text-right font-mono text-gray-400">
                  {r.beta != null ? r.beta.toFixed(2) : <span className="text-gray-600">—</span>}
                </td>

                {/* Heat-mapped columns (pe through div_yield) */}
                {COLS.slice(9).map((c) => {
                  const val = r[c.key];
                  const formatted = fmt(val, c.type);
                  const hcls = heatClass(val, c.key, heat);
                  const pos = c.type === "pct" && val > 0;
                  const neg = c.type === "pct" && val < 0;
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-right font-mono whitespace-nowrap ${hcls || "text-gray-400"}`}
                    >
                      {formatted == null ? (
                        <span className="text-gray-700">—</span>
                      ) : (
                        <span className={pos ? "text-emerald-400" : neg ? "text-red-400" : ""}>
                          {formatted}
                        </span>
                      )}
                    </td>
                  );
                })}

                {/* Ask Ori */}
                <td className="px-2 py-2 text-right" style={{ width: '52px' }}>
                  {onAskAI && (
                    <button
                      onClick={() => onAskAI(r.symbol)}
                      className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 px-2 py-1 text-[9px] font-medium
                        rounded bg-blue-600/20 text-blue-400 border border-blue-800/50
                        hover:bg-blue-600/40 transition-opacity duration-75 whitespace-nowrap"
                    >
                      Ask Ori
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={COLS.length + (onAskAI ? 1 : 0)} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center py-16 text-gray-500">
          <IconSearch className="w-8 h-8 mb-3 text-gray-600" />
          <p className="font-medium text-gray-400">No results</p>
          <p className="text-xs mt-1">
            Loosen your filters or wait for metrics to finish loading.
          </p>
        </div>
      )}
    </div>
  );
}
