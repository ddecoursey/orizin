import { useState, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fmt } from "../lib/format.js";
import { SECTOR_COLORS } from "../lib/scoring.js";
import Sparkline from "./Sparkline";

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

function Cell({ val, type, colKey, heat, plain }) {
  if (plain) return null; // handled inline
  const formatted = fmt(val, type);
  const cls = heatClass(val, colKey, heat);
  const text = formatted ?? <span className="text-gray-600">—</span>;
  const positive = type === "pct" && val > 0;
  const negative = type === "pct" && val < 0;
  return (
    <td
      className={`px-3 py-2 text-right text-xs font-mono whitespace-nowrap ${cls}`}
    >
      {formatted == null ? (
        <span className="text-gray-600">—</span>
      ) : (
        <span
          className={
            positive ? "text-emerald-400" : negative ? "text-red-400" : ""
          }
        >
          {formatted}
        </span>
      )}
    </td>
  );
}

const COLS = [
  { key: "pin", label: "★", left: true, nosort: true },
  { key: "symbol", label: "Symbol", left: true, plain: true },
  { key: "sector", label: "Sector", left: true, plain: true },
  { key: "mcap", label: "Mkt Cap", plain: true, type: "money" },
  { key: "price", label: "Price", plain: true, type: "price" },
  { key: "trend", label: "Trend", plain: true, nosort: true },
  { key: "beta", label: "Beta", plain: true, type: "ratio" },
  { key: "pe", label: "P/E", type: "x" },
  { key: "pb", label: "P/B", type: "x" },
  { key: "ps", label: "P/S", type: "x" },
  { key: "ev_ebitda", label: "EV/EBITDA", type: "x" },
  { key: "ev_sales", label: "EV/S", type: "x" },
  { key: "ev_gp", label: "EV/GP", type: "x" },
  { key: "fcf_yield", label: "FCF Yld", type: "pct" },
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
  { key: "rule_of_40", label: "R40", type: "r40" },
  { key: "net_debt_ebitda", label: "ND/EB", type: "ratio" },
  { key: "current_ratio", label: "Curr R", type: "ratio" },
  { key: "debt_equity", label: "D/E", type: "ratio" },
  { key: "div_yield", label: "Div Yld", type: "pct" },
  { key: "score", label: "Score", plain: true, nosort: false },
];

export default function StockTable({ rows, pins, onTogglePin, onAskAI, onSelectStock, enrichLoading = false, sparklineForceVersion = 0 }) {
  const [sortKey, setSortKey] = useState("mcap");
  const [sortDir, setSortDir] = useState(-1);
  const [sparklines, setSparklines] = useState(() => {
    // Hydrate from localStorage on initial mount so that after a refresh
    // we don't immediately re-request everything that we already have persisted.
    // This makes sparklines behave like the main metric data: once gathered,
    // refresh/scroll is instant with no network activity for previously seen symbols.
    const initial = new Map();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sparkline_v1:')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            // key format: sparkline_v1:SYMBOL:45
            const parts = key.split(':');
            const sym = parts[1];
            if (sym && Array.isArray(parsed?.prices) && parsed.prices.length > 0) {
              initial.set(sym, parsed.prices);
            }
          }
        }
      }
    } catch {}
    return initial;
  }); // symbol -> number[]

  // Memoize expensive computations
  const heat = useMemo(() => buildHeat(rows), [rows]);

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
          console.log(`[Sparkline] LocalStorage hit for ${symbol}`);
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
      console.log(`[Sparkline] Fetching from backend for ${symbol}${force ? ' (force)' : ''}`);
      const res = await fetch(`/api/stocks/sparkline/${symbol}?days=45${forceParam}`);

      console.log(`[Sparkline] Backend response status for ${symbol}:`, res.status);

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'No error body');
        console.error(`[Sparkline] Backend error for ${symbol}:`, res.status, errorText);
        return;
      }

      const data = await res.json();
      console.log(`[Sparkline] Backend data for ${symbol}:`, data);

      const prices = data.prices?.map(p => p.price) || [];
      console.log(`[Sparkline] Parsed ${prices.length} prices for ${symbol}`);

      setSparklines(prev => {
        const next = new Map(prev);
        next.set(symbol, prices);
        return next;
      });

      // Persist to localStorage for fast reloads
      if (prices.length > 0) {
        saveSparklineToLocal(symbol, 45, prices);
      }
    } catch (e) {
      console.error(`[Sparkline] Fetch failed for ${symbol}:`, e);
    } finally {
      inFlightRef.current.delete(symbol);
    }
  };

  const sorted = useMemo(() => {
    const pinnedSet = pins;
    return [...rows].sort((a, b) => {
      const ap = pinnedSet.has(a.symbol),
        bp = pinnedSet.has(b.symbol);
      if (ap !== bp) return ap ? -1 : 1;
      const av = a[sortKey],
        bv = b[sortKey];
      if (av == null || !isFinite(av)) return 1;
      if (bv == null || !isFinite(bv)) return -1;
      if (typeof av === "string") return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });
  }, [rows, pins, sortKey, sortDir]);

  // Virtualization setup - Battle-tested pattern for large tables in flex layouts
  const parentRef = useRef(null);

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,           // Base row height estimate (adjust if your rows are consistently taller/shorter)
    overscan: 45,                     // Higher overscan = smoother "infinite scroll" feel, minimal perf cost for tables
    getItemKey: (index) => sorted[index]?.symbol ?? index, // Stable keys prevent unnecessary re-renders
  });

  // 5-second delay before enabling sparkline fetching on initial load
  const [sparklinesEnabled, setSparklinesEnabled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSparklinesEnabled(true);
      console.log('[Sparkline] Enabling sparkline fetching after 5s delay');
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Fetch sparklines for currently visible rows (lazy loading).
  // Load whenever no heavy enrich/refresh fetch is running — not every ticker
  // will ever have data, so we don't wait for the "missing" count to hit zero.
  useEffect(() => {
    if (!sparklinesEnabled || enrichLoading) return;

    const visibleItems = rowVirtualizer.getVirtualItems();
    const visibleSymbols = visibleItems
      .map(vi => sorted[vi.index]?.symbol)
      .filter(Boolean);

    console.log('[Sparkline] Visible symbols:', visibleSymbols);
    visibleSymbols.forEach(symbol => {
      // Skip if we already have it (either from this session or hydrated from localStorage on refresh)
      if (sparklines.has(symbol) || inFlightRef.current.has(symbol)) {
        return;
      }
      console.log('[Sparkline] Fetching for:', symbol);
      scheduleSparklineFetch(symbol);
    });
  }, [rowVirtualizer, sorted, sparklines, sparklinesEnabled, enrichLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the parent triggers a Force Re-gather, also force-refresh
  // sparklines for whatever is currently visible.
  useEffect(() => {
    if (sparklineForceVersion === 0) return;

    const visibleItems = rowVirtualizer.getVirtualItems();
    const visibleSymbols = visibleItems
      .map(vi => sorted[vi.index]?.symbol)
      .filter(Boolean);

    console.log('[Sparkline] Force refresh due to global re-gather:', visibleSymbols);
    visibleSymbols.forEach(symbol => {
      scheduleSparklineFetch(symbol, true); // force = true
    });
  }, [sparklineForceVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(key) {
    const col = COLS.find((c) => c.key === key);
    if (col?.nosort) return;
    if (sortKey === key) setSortDir((d) => -d);
    else {
      setSortKey(key);
      setSortDir(key === "symbol" || key === "sector" ? 1 : -1);
    }
  }

  // Helpful utilities for "infinite scroll" UX
  const scrollToTop = () => rowVirtualizer.scrollToOffset(0);
  const scrollToRow = (symbol) => {
    const index = sorted.findIndex((r) => r.symbol === symbol);
    if (index !== -1) {
      rowVirtualizer.scrollToIndex(index, { align: 'center' });
    }
  };

  const virtualItems = rowVirtualizer.getVirtualItems();
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
      className="overflow-auto flex-1 min-h-0"
      style={{ height: '100%' }}
    >
      <table className="w-full border-collapse text-xs">
        {/* Define column widths for stable "lanes" even with virtualization */}
        <colgroup>
          <col style={{ width: '32px' }} />      {/* Pin */}
          <col style={{ width: '92px' }} />     {/* Symbol + name */}
          <col style={{ width: '92px' }} />     {/* Sector */}
          <col style={{ width: '78px' }} />     {/* Mkt Cap */}
          <col style={{ width: '58px' }} />     {/* Price */}
          <col style={{ width: '58px' }} />     {/* Trend */}
          <col style={{ width: '44px' }} />     {/* Beta */}
          <col style={{ width: '52px' }} />     {/* P/E */}
          <col style={{ width: '52px' }} />     {/* P/B */}
          <col style={{ width: '52px' }} />     {/* P/S */}
          <col style={{ width: '68px' }} />     {/* EV/EBITDA */}
          <col style={{ width: '52px' }} />     {/* EV/S */}
          <col style={{ width: '52px' }} />     {/* EV/GP */}
          <col style={{ width: '58px' }} />     {/* FCF Yld */}
          <col style={{ width: '58px' }} />     {/* Gross M */}
          <col style={{ width: '52px' }} />     {/* Op M */}
          <col style={{ width: '52px' }} />     {/* Net M */}
          <col style={{ width: '52px' }} />     {/* FCF M */}
          <col style={{ width: '52px' }} />     {/* ROIC */}
          <col style={{ width: '52px' }} />     {/* ROE */}
          <col style={{ width: '52px' }} />     {/* ROA */}
          <col style={{ width: '58px' }} />     {/* Rev Gr */}
          <col style={{ width: '52px' }} />     {/* EPS Gr */}
          <col style={{ width: '52px' }} />     {/* FCF Gr */}
          <col style={{ width: '44px' }} />     {/* R40 */}
          <col style={{ width: '52px' }} />     {/* ND/EB */}
          <col style={{ width: '52px' }} />     {/* Curr R */}
          <col style={{ width: '48px' }} />     {/* D/E */}
          <col style={{ width: '58px' }} />     {/* Div Yld */}
          <col style={{ width: '72px' }} />     {/* Score */}
          <col style={{ width: '52px' }} />     {/* Ask Ori */}
        </colgroup>

        <thead className="sticky top-0 z-20 bg-gray-950">
          <tr>
            {COLS.map((c, i) => {
              // Widths aligned with colgroup for strong column lanes
              const widths = ['32px','92px','92px','78px','58px','58px','44px','52px','52px','52px','68px','52px','52px','58px','58px','52px','52px','52px','52px','52px','52px','58px','52px','52px','44px','52px','52px','48px','58px','72px'];
              const w = widths[i];
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
                  {c.label}
                  {sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : ""}
                </th>
              );
            })}
            {onAskAI && (
              <th className="px-2 py-2 border-b border-gray-800 bg-gray-950" style={{ width: '52px' }} />
            )}
          </tr>
        </thead>

        <tbody style={{ paddingTop: `${paddingTop}px`, paddingBottom: `${paddingBottom}px` }}>
          {virtualItems.map((virtualRow) => {
            const r = sorted[virtualRow.index];
            if (!r) return null;

            const pinned = pins.has(r.symbol);

            return (
              <tr
                key={r.symbol}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className={`group border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors
                  ${pinned ? "bg-amber-900/10" : ""}`}
              >
                {/* Pin — sticky col 1 */}
                <td
                  className={`px-3 py-2 text-left sticky left-0 z-10 border-r border-gray-950 ${pinned ? "bg-amber-950" : "bg-gray-950"}`}
                  style={{ width: '32px', minWidth: '32px' }}
                >
                  <button
                    onClick={() => onTogglePin(r.symbol)}
                    className={`text-sm leading-none transition-colors ${
                      pinned ? "text-amber-400" : "text-gray-700 hover:text-amber-400"
                    }`}
                  >
                    {pinned ? "★" : "☆"}
                  </button>
                </td>

                {/* Symbol + name — sticky col 2 */}
                <td
                  className={`px-3 py-2 text-left sticky left-10 z-10 ${pinned ? "bg-amber-950" : "bg-gray-950"}`}
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
                      <span className="font-bold text-gray-100 text-[11.5px] group-hover/sym:text-blue-400 transition-colors">{r.symbol}</span>
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

                {/* Heat-mapped columns */}
                {COLS.slice(7, -1).map((c) => {
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

                {/* Score */}
                <td className="px-3 py-2 min-w-[80px]">
                  <ScoreBar score={r.score} />
                </td>

                {/* Ask Ori */}
                <td className="px-2 py-2 text-right" style={{ width: '52px' }}>
                  {onAskAI && (
                    <button
                      onClick={() => onAskAI(r.symbol)}
                      className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[9px] font-medium
                        rounded bg-blue-600/20 text-blue-400 border border-blue-800/50
                        hover:bg-blue-600/40 transition-all whitespace-nowrap"
                    >
                      Ask Ori
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center py-16 text-gray-500">
          <span className="text-3xl mb-3">🔍</span>
          <p className="font-medium text-gray-400">No results</p>
          <p className="text-xs mt-1">
            Loosen your filters or wait for metrics to finish loading.
          </p>
        </div>
      )}
    </div>
  );
}
