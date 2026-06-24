import { useState, useMemo } from "react";
import { fmt } from "../lib/format.js";
import { IconCompare } from "./icons.jsx";

// Metric, how to format it, and which direction is "better" (for highlighting).
const METRICS = [
  { label: "Conviction", key: "conviction", kind: "int", better: "high" },
  { label: "Mkt Cap", key: "mcap", kind: "money", better: null },
  { label: "Price", key: "price", kind: "price", better: null },
  { label: "P/E", key: "pe", kind: "x", better: "low" },
  { label: "P/B", key: "pb", kind: "x", better: "low" },
  { label: "EV/EBITDA", key: "ev_ebitda", kind: "x", better: "low" },
  { label: "EV/GP", key: "ev_gp", kind: "x", better: "low" },
  { label: "FCF Yld", key: "fcf_yield", kind: "pct", better: "high" },
  { label: "ROIC", key: "roic", kind: "pct", better: "high" },
  { label: "ROE", key: "roe", kind: "pct", better: "high" },
  { label: "Gross M", key: "gross_margin", kind: "pct", better: "high" },
  { label: "Op M", key: "op_margin", kind: "pct", better: "high" },
  { label: "Rev Gr", key: "revenue_growth", kind: "pct", better: "high" },
  { label: "EPS Gr", key: "eps_growth", kind: "pct", better: "high" },
  { label: "ND/EBITDA", key: "net_debt_ebitda", kind: "ratio", better: "low" },
  { label: "D/E", key: "debt_equity", kind: "ratio", better: "low" },
  { label: "Div Yld", key: "div_yield", kind: "pct", better: "high" },
  { label: "Beta", key: "beta", kind: "ratio", better: null },
];

function display(v, kind) {
  if (v == null) return "—";
  if (kind === "score") return Math.round(v * 100);
  if (kind === "int") return Math.round(v);
  return fmt(v, kind) ?? "—";
}

export default function CompareModal({ rows = [], universe = [], pins = [], initialA, initialB, onClose, onAskOri }) {
  const byScore = useMemo(
    () => [...rows].sort((a, b) => (b.conviction || 0) - (a.conviction || 0)),
    [rows],
  );
  const symbols = useMemo(() => {
    const set = new Set([...rows, ...universe].map((r) => r.symbol).filter(Boolean));
    return [...set].sort();
  }, [rows, universe]);
  const lookup = useMemo(() => {
    const m = new Map();
    for (const r of universe) m.set(r.symbol, r);
    for (const r of rows) m.set(r.symbol, r); // scored rows take precedence
    return m;
  }, [rows, universe]);

  const [aSym, setASym] = useState(() => initialA || pins[0] || byScore[0]?.symbol || "");
  const [bSym, setBSym] = useState(() => initialB || pins[1] || byScore[1]?.symbol || "");

  const a = lookup.get((aSym || "").toUpperCase()) || null;
  const b = lookup.get((bSym || "").toUpperCase()) || null;

  const cellClass = (m, mine, other) => {
    if (m.better == null || mine == null || other == null || mine === other) return "text-gray-200";
    const mineBetter = m.better === "high" ? mine > other : mine < other;
    return mineBetter ? "text-emerald-400 font-semibold" : "text-gray-400";
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden oz-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-bold text-gray-100 flex items-center gap-2"><IconCompare className="w-4 h-4 text-blue-400" /> Head-to-Head</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl leading-none px-2 py-1 cursor-pointer">
            ×
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center px-4 py-3 border-b border-gray-800">
          <input
            list="compare-symbols"
            value={aSym}
            onChange={(e) => setASym(e.target.value.toUpperCase())}
            placeholder="Ticker A"
            autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-bold text-gray-100 uppercase text-center outline-none focus:border-blue-500"
          />
          <span className="text-[10px] text-gray-600 font-bold">VS</span>
          <input
            list="compare-symbols"
            value={bSym}
            onChange={(e) => setBSym(e.target.value.toUpperCase())}
            placeholder="Ticker B"
            autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-bold text-gray-100 uppercase text-center outline-none focus:border-blue-500"
          />
        </div>
        <datalist id="compare-symbols">
          {symbols.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        {a && b ? (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-4 py-2 text-[10px] text-gray-500 border-b border-gray-800">
              <div className="truncate text-center">{a.name}</div>
              <div className="w-20" />
              <div className="truncate text-center">{b.name}</div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {METRICS.map((m) => {
                const av = a[m.key];
                const bv = b[m.key];
                return (
                  <div
                    key={m.key}
                    className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center py-1 border-b border-gray-800/40 text-xs font-mono"
                  >
                    <div className={`text-center ${cellClass(m, av, bv)}`}>{display(av, m.kind)}</div>
                    <div className="text-[9px] text-gray-500 uppercase tracking-wide w-20 text-center">{m.label}</div>
                    <div className={`text-center ${cellClass(m, bv, av)}`}>{display(bv, m.kind)}</div>
                  </div>
                );
              })}
            </div>
            {onAskOri && (
              <div className="px-4 py-3 border-t border-gray-800">
                <button
                  onClick={() => onAskOri(a.symbol, b.symbol)}
                  className="w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white hover:brightness-110 transition-all"
                >
                  Ask Ori to compare {a.symbol} vs {b.symbol} →
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-10 text-center text-xs text-gray-500">
            Enter two tickers to compare.
            {!a && aSym ? ` "${aSym}" not found.` : ""}
            {!b && bSym ? ` "${bSym}" not found.` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
