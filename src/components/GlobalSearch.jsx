import { useState, useRef, useEffect, useMemo } from "react";
import { IconSearch } from "./icons.jsx";

// Header search across the whole universe. Selecting a result opens that
// stock's company-overview panel (via onSelect), regardless of current filters.
export default function GlobalSearch({ stocks = [], onSelect, placeholder = "Search any stock…", className = "" }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const starts = [];
    const contains = [];
    for (const s of stocks) {
      const sym = (s.symbol || "").toLowerCase();
      const name = (s.name || "").toLowerCase();
      if (sym.startsWith(term) || name.startsWith(term)) starts.push(s);
      else if (sym.includes(term) || name.includes(term)) contains.push(s);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [q, stocks]);

  useEffect(() => {
    setHi(0);
  }, [q]);

  function choose(row) {
    if (!row) return;
    onSelect?.(row);
    setQ("");
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[hi]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className={`relative flex-1 max-w-md min-w-0 ${className}`.trim()}>
      <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 lg:py-1.5 focus-within:border-gray-600 transition-colors duration-150">
        <IconSearch className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent text-xs text-gray-200 outline-none placeholder-gray-600"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl shadow-black/50 py-1 max-h-80 overflow-y-auto oz-pop">
          {results.map((s, i) => (
            <button
              key={s.symbol}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(s)}
              className={`w-full text-left px-3 py-2 lg:py-1.5 flex items-center gap-2 cursor-pointer ${
                i === hi ? "bg-gray-800" : "hover:bg-gray-800/60"
              }`}
            >
              <span className="font-bold text-gray-100 text-xs w-14 shrink-0">{s.symbol}</span>
              <span className="text-[11px] text-gray-400 truncate flex-1">{s.name}</span>
              <span className="text-[10px] text-gray-600 shrink-0 hidden sm:inline">{s.sector}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
