import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Admin tool: add a single ticker (e.g. a fresh IPO not yet in the universe) and
// gather its core details from FMP (profile, key metrics, ratios). The added
// stock then behaves like any other — open it to load full detail (DCF, analyst
// targets, RSI, news…) on demand.
export default function AddTickerModal({ onClose, onAdd, onView }) {
  const [symbol, setSymbol] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | loading | success | error
  const [error, setError] = useState("");
  const [added, setAdded] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e) {
    e?.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym || phase === "loading") return;
    setPhase("loading");
    setError("");
    try {
      const stock = await onAdd(sym);
      setAdded(stock);
      setPhase("success");
    } catch (err) {
      setError(err?.message || `Couldn't add ${sym}`);
      setPhase("error");
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-100">Add a ticker</h3>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-100" aria-label="Close">×</button>
        </div>

        <div className="p-5">
          {phase === "success" ? (
            <div className="py-2 text-center">
              <div className="mb-2 text-2xl text-emerald-400">✓</div>
              <p className="text-sm text-gray-200">
                Added <span className="font-bold">{added?.symbol}</span>
                {added?.name ? <span className="text-gray-400"> — {added.name}</span> : null}
              </p>
              <p className="mt-1 text-[11px] text-gray-500">
                It's in the screener now. Open it to gather full details.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {onView && added && (
                  <button
                    onClick={() => onView(added)}
                    className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    View details
                  </button>
                )}
                <button
                  onClick={() => { setSymbol(""); setAdded(null); setPhase("idle"); inputRef.current?.focus(); }}
                  className="rounded-md border border-gray-700 px-4 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
                >
                  Add another
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-gray-500">Ticker symbol</label>
              <input
                ref={inputRef}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. SPCX"
                autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono uppercase text-gray-100 outline-none focus:border-blue-500"
              />
              {error && (
                <div className="mt-2 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>
              )}
              <button
                type="submit"
                disabled={!symbol.trim() || phase === "loading"}
                className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {phase === "loading" ? "Gathering…" : "Add & gather details"}
              </button>
              <p className="mt-2 text-[10px] leading-snug text-gray-500">
                Pulls the company profile, key metrics and ratios from FMP. Deeper data (DCF, analyst targets, news…) loads when you open the stock.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
