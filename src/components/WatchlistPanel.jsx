import { useState, useRef, useEffect } from "react";
import { fmt } from "../lib/format.js";
import Sparkline from "./Sparkline.jsx";

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

export default function WatchlistPanel({
  open,
  onClose,
  lists,
  activeId,
  activeList,
  setActiveWatchlist,
  createWatchlist,
  deleteWatchlist,
  addSymbol,
  removeSymbol,
  stocks = [],
  sparklines = new Map(),
  canUseOri = false,
  onSelectSymbol,
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [ticker, setTicker] = useState("");
  const inputRef = useRef(null);
  const tickerRef = useRef(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  if (!open) return null;

  const stockMap = new Map(stocks.map((s) => [s.symbol, s]));
  const symbols = activeList?.symbols || [];

  function submitTicker() {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    addSymbol?.(sym);
    setTicker("");
    tickerRef.current?.focus();
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close watchlist" onClick={onClose} />
      <aside className="relative w-full max-w-sm bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl oz-pane-in">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-100">Watchlists</h2>
            <p className="text-[10px] text-gray-500 truncate">Track news &amp; price moves — separate from screener pins</p>
          </div>
          <select
            value={activeId}
            onChange={(e) => setActiveWatchlist(e.target.value)}
            className="ml-auto text-xs bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-gray-200 outline-none shrink-0"
          >
            {lists.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.symbols.length})</option>
            ))}
          </select>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200 px-1 cursor-pointer shrink-0">×</button>
        </header>

        <div className="px-4 py-2 border-b border-gray-800 flex gap-2 shrink-0 flex-wrap">
          {adding ? (
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  createWatchlist(newName.trim());
                  setAdding(false);
                  setNewName("");
                }
                if (e.key === "Escape") { setAdding(false); setNewName(""); }
              }}
              placeholder="List name…"
              maxLength={28}
              className="flex-1 min-w-[8rem] text-xs bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-gray-100 outline-none focus:border-violet-500/60"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-[11px] font-semibold text-violet-300 hover:text-violet-200 cursor-pointer"
            >
              + New list
            </button>
          )}
          {activeId !== "default" && (
            <button
              type="button"
              onClick={() => { if (confirm(`Delete "${activeList?.name}"?`)) deleteWatchlist(activeId); }}
              className="text-[11px] text-gray-500 hover:text-red-400 ml-auto cursor-pointer"
            >
              Delete list
            </button>
          )}
        </div>

        <div className="px-4 py-2 border-b border-gray-800 shrink-0 flex gap-2">
          <input
            ref={tickerRef}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") submitTicker(); }}
            placeholder="Add ticker…"
            maxLength={8}
            className="flex-1 text-xs bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-gray-100 outline-none focus:border-violet-500/60 font-mono uppercase"
          />
          <button
            type="button"
            onClick={submitTicker}
            disabled={!ticker.trim()}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-violet-600/80 text-white hover:bg-violet-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {symbols.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-10 px-4">
              Add tickers here or from Deep Research to monitor price and news. Use ★ pins in the screener to lock rows while filtering.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800/80">
              {symbols.map((sym) => {
                const row = stockMap.get(sym) || { symbol: sym };
                const pts = sparklines.get(sym);
                return (
                  <li key={sym} className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-900/60 group">
                    <button
                      type="button"
                      onClick={() => onSelectSymbol?.(sym)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-100 text-xs">{sym}</span>
                          <ScoreMini row={row} canUseOri={canUseOri} />
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{row.name || "—"}</div>
                      </div>
                      {pts?.length > 1 ? (
                        <Sparkline
                          data={pts}
                          color={pts.at(-1) >= pts[0] ? "#22c55e" : "#ef4444"}
                        />
                      ) : (
                        <span className="text-[10px] font-mono text-gray-400 w-14 text-right">{fmt(row.price, "price") ?? "—"}</span>
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
          Monitoring list · open a symbol for news and deep research
        </footer>
      </aside>
    </div>
  );
}