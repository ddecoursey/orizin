import { fmt } from "../lib/format.js";
import Sparkline from "./Sparkline.jsx";
import GlobalSearch from "./GlobalSearch.jsx";

function ScoreMini({ row, canUseOri }) {
  const v = canUseOri
    ? row?.conviction
    : row?.score != null
      ? Math.round(row.score * 100)
      : null;
  if (v == null) return <span className="text-gray-600 text-[10px]">—</span>;
  const color = v >= 70 ? "text-emerald-400" : v >= 45 ? "text-amber-400" : "text-red-400";
  return <span className={`text-[10px] font-bold font-mono tabular-nums ${color}`}>{v}</span>;
}

function fmtAge(ms) {
  if (!ms || !Number.isFinite(ms)) return null;
  const age = Date.now() - ms;
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h ago`;
  return `${Math.round(age / 86_400_000)}d ago`;
}

function pctCls(pct) {
  if (pct == null) return "text-gray-500";
  if (pct >= 2) return "text-emerald-400";
  if (pct <= -2) return "text-red-400";
  return "text-gray-400";
}

export default function WatchlistPanel({
  open,
  onClose,
  watchlist,
  addSymbol,
  removeSymbol,
  stocks = [],
  sparklines = new Map(),
  snapshots = {},
  pendingSymbols = new Set(),
  canUseOri = false,
  onSelectSymbol,
}) {
  if (!open) return null;

  const stockMap = new Map(stocks.map((s) => [s.symbol, s]));
  const symbols = watchlist?.symbols || [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close watchlist" onClick={onClose} />
      <aside className="relative w-full max-w-sm bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl oz-pane-in">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-100">Watchlist</h2>
            <p className="text-[10px] text-gray-500">Priority refresh ~hourly · alerts on big moves</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200 px-1 cursor-pointer shrink-0">×</button>
        </header>

        <div className="px-4 py-3 border-b border-gray-800 shrink-0">
          <GlobalSearch
            stocks={stocks}
            placeholder="Search to add a stock…"
            className="max-w-none"
            onSelect={(row) => row?.symbol && addSymbol?.(row.symbol)}
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {symbols.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-10 px-4">
              Search above to add stocks, or use <strong className="text-gray-400">Add to watchlist</strong> on a Deep Research page. Screener ★ pins are only for filtering.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800/80">
              {symbols.map((sym) => {
                const row = stockMap.get(sym) || { symbol: sym };
                const snap = snapshots[sym];
                const pts = sparklines.get(sym);
                const syncing = pendingSymbols.has(sym);
                const pct = snap?.pctSession;
                const priceAge = fmtAge(snap?.priceUpdatedAt ?? row.price_updated_at);
                const dataAge = fmtAge(snap?.dataUpdatedAt ?? row.updated_at);
                return (
                  <li key={sym} className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-900/60 group">
                    <button
                      type="button"
                      onClick={() => onSelectSymbol?.(sym)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-100 text-xs">{sym}</span>
                          <ScoreMini row={row} canUseOri={canUseOri} />
                          {pct != null && (
                            <span className={`text-[10px] font-mono font-semibold ${pctCls(pct)}`}>
                              {pct >= 0 ? "+" : ""}{pct}%
                            </span>
                          )}
                          {syncing && (
                            <span className="text-[9px] text-violet-400/90 animate-pulse">syncing…</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{row.name || "—"}</div>
                        {(priceAge || dataAge) && (
                          <div className="text-[9px] text-gray-600 mt-0.5">
                            {priceAge ? `Price · ${priceAge}` : ""}
                            {priceAge && dataAge ? " · " : ""}
                            {dataAge ? `Data · ${dataAge}` : ""}
                          </div>
                        )}
                      </div>
                      {pts?.length > 1 ? (
                        <Sparkline
                          data={pts}
                          color={pts.at(-1) >= pts[0] ? "#22c55e" : "#ef4444"}
                        />
                      ) : (
                        <span className="text-[10px] font-mono text-gray-400 w-14 text-right">
                          {fmt(snap?.price ?? row.price, "price") ?? "—"}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSymbol(sym)}
                      className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 text-sm px-1 cursor-pointer"
                      title="Remove from watchlist"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600 shrink-0">
          {symbols.length} {symbols.length === 1 ? "symbol" : "symbols"} · tap a row for Deep Research
        </footer>
      </aside>
    </div>
  );
}