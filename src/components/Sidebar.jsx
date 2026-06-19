import { useState, useMemo, useRef, useEffect } from 'react';
import { DEFAULT_FILTERS } from '../hooks/useScreener.js';
import { IconFilters, IconChevronDown } from './icons.jsx';
import Tooltip from "./Tooltip.jsx";

// Tiny chevrons for the stepper buttons (replaces the ▲/▼ text glyphs).
function ChevronUp({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 14.5 6-6 6 6" />
    </svg>
  );
}
function ChevronRight({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
function PinStar({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.35 6.2 20.4l1.1-6.47-4.7-4.58 6.5-.95z" />
    </svg>
  );
}

function FilterRow({ label, filterKey, filters, set, step = 1 }) {
  const isMaxStyle = filterKey.endsWith('Max');
  const defaultOp = isMaxStyle ? "<=" : ">=";
  const current = filters[filterKey] || { op: defaultOp };
  const isBetween = current.op === "between";

  const handleOp = (op) => {
    const next = { ...current, op };
    if (op !== "between") {
      delete next.min;
      delete next.max;
    }
    set(filterKey, next);
  };

  const handleVal = (key, val) => {
    const next = { ...current };
    if (isBetween) {
      next[key] = val;
    } else {
      next.value = val;
    }
    set(filterKey, next);
  };

  const adjust = (delta) => {
    const next = { ...current };
    if (isBetween) {
      const base = Number(next.min || 0);
      next.min = Math.max(0, base + delta);
    } else {
      const base = Number(next.value || 0);
      next.value = Math.max(0, base + delta);
    }
    set(filterKey, next);
  };

  // True when this row is actively narrowing results (any value entered).
  const hasValue = isBetween
    ? (current.min ?? "") !== "" || (current.max ?? "") !== ""
    : (current.value ?? "") !== "";

  const inputCls =
    "w-14 px-1.5 py-1.5 lg:py-1 text-[11px] tabular-nums bg-transparent text-gray-200 " +
    "focus:outline-none placeholder-gray-600 " +
    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="flex items-center gap-2 mb-1.5">
      <label className={`flex-1 text-[11px] truncate transition-colors duration-150 ${hasValue ? "text-gray-200 font-medium" : "text-gray-500"}`}>
        {label}
      </label>

      <div className={`flex items-stretch shrink-0 rounded-md border overflow-hidden bg-gray-900 transition-colors duration-150
        focus-within:border-blue-500/70 ${hasValue ? "border-gray-600" : "border-gray-700/80"}`}>
        <select
          value={current.op || ">="}
          onChange={(e) => handleOp(e.target.value)}
          className="w-9 lg:w-8 shrink-0 appearance-none text-center text-xs leading-none bg-gray-800/80 border-r border-gray-700/80 px-0 text-gray-400 focus:outline-none cursor-pointer hover:text-gray-200 transition-colors"
          style={{ textAlignLast: "center", textAlign: "center" }}
          title="Comparison"
        >
          <option value=">=">≥</option>
          <option value=">">&gt;</option>
          <option value="<=">≤</option>
          <option value="<">&lt;</option>
          <option value="=">=</option>
          <option value="between">↔</option>
        </select>

        <input
          type="number"
          step={step}
          value={isBetween ? current.min ?? "" : current.value ?? ""}
          onChange={(e) => handleVal("min", e.target.value)}
          placeholder="—"
          className={inputCls}
        />

        {isBetween && (
          <>
            <span className="text-gray-500 text-[10px] self-center px-0.5">–</span>
            <input
              type="number"
              step={step}
              value={current.max ?? ""}
              onChange={(e) => handleVal("max", e.target.value)}
              placeholder="—"
              className={inputCls}
            />
          </>
        )}

        {/* Steppers */}
        <div className="flex flex-col border-l border-gray-700/80">
          <button
            type="button"
            onClick={() => adjust(step)}
            className="flex items-center justify-center px-1.5 lg:px-1 flex-1 text-gray-500 hover:text-gray-200 hover:bg-gray-800 active:bg-gray-700 transition-colors cursor-pointer"
            title={`+${step}`}
            tabIndex={-1}
          >
            <ChevronUp className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => adjust(-step)}
            className="flex items-center justify-center px-1.5 lg:px-1 flex-1 text-gray-500 hover:text-gray-200 hover:bg-gray-800 active:bg-gray-700 transition-colors border-t border-gray-700/80 cursor-pointer"
            title={`-${step}`}
            tabIndex={-1}
          >
            <ChevronUp className="w-2.5 h-2.5 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MultiSelect({ label, options, selected, onChange, search, onSearchChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter(x => x !== val)
      : [...selected, val];
    onChange(next);
  };

  const filtered = options.filter(opt =>
    opt.toLowerCase().includes((search || '').toLowerCase())
  );

  return (
    <div className="mb-3 relative" ref={ref}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">{label}</div>
        {selected?.length > 0 && (
          <div className="text-[10px] text-blue-400">{selected.length} selected</div>
        )}
      </div>

      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 py-2 lg:py-1.5 text-[11px] bg-gray-800 border border-gray-700 rounded-md flex justify-between items-center gap-2 hover:border-gray-600 text-left transition-colors duration-150 cursor-pointer"
      >
        <span className={`truncate ${selected?.length > 0 ? "text-gray-200 font-medium" : "text-gray-400"}`}>
          {selected?.length > 0
            ? `${selected.length} selected`
            : `All ${label.toLowerCase()}`}
        </span>
        <IconChevronDown className={`w-3 h-3 text-gray-500 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-[60] mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-h-64 flex flex-col oz-pop overflow-hidden">
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-2 py-1 text-xs bg-gray-800 border-b border-gray-700 text-gray-200 placeholder-gray-500 focus:outline-none"
          />

          {/* Quick actions */}
          <div className="flex justify-between px-2 py-1 border-b border-gray-700 text-[10px]">
            <button
              onClick={() => onChange(options)}
              className="text-blue-400 hover:text-blue-300 active:text-blue-200"
            >
              Select all
            </button>
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-red-400 hover:text-red-300 active:text-red-200"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1 p-1 text-xs max-h-48">
            {filtered.length > 0 ? (
              filtered.map(opt => (
                <label
                  key={opt}
                  className="flex items-center gap-2 px-2 py-1.5 lg:py-1 hover:bg-gray-800 cursor-pointer rounded"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => toggle(opt)}
                    className="accent-blue-500"
                  />
                  <span className="text-gray-300 truncate">{opt}</span>
                </label>
              ))
            ) : (
              <div className="px-2 py-1 text-gray-500">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full text-left py-2 lg:py-1.5 text-[11px] uppercase tracking-wider font-semibold
          text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
      >
        <ChevronRight className={`w-2.5 h-2.5 text-gray-600 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        {title}
      </button>
      {open && <div className="pl-2 pb-1">{children}</div>}
    </div>
  );
}

export default function Sidebar({ filters, setFilters, stocks, collapsed, onToggleCollapsed }) {
  const [sectorSearch, setSectorSearch] = useState('');
  const [industrySearch, setIndustrySearch] = useState('');

  const f = filters;
  const set = (key, val) => setFilters({ ...f, [key]: val });
  const setArr = (key, val) => setFilters({ ...f, [key]: val });

  // Local universe scope (normalized; old tabs with only usOnly are handled in the hook)
  const universeScope = f.universe && ["us", "us-listed", "global"].includes(f.universe)
    ? f.universe
    : "global";

  const sectors = useMemo(() =>
    [...new Set(stocks.map(r => r.sector).filter(s => s && s !== '—'))].sort(),
    [stocks]);

  const industries = useMemo(() => {
    const pool = f.sectors?.length
      ? stocks.filter(r => f.sectors.includes(r.sector))
      : stocks;
    return [...new Set(pool.map(r => r.industry).filter(i => i && i !== '—'))].sort();
  }, [stocks, f.sectors]);

  if (collapsed) {
    // Thin re-open strip — desktop only. On < lg the controls-bar "Filters"
    // button is the opener, so we don't steal width with a strip there.
    return (
      <aside className="hidden lg:flex w-9 shrink-0 bg-gray-900 border-r border-gray-800 flex-col items-center pt-2">
        <button
          onClick={onToggleCollapsed}
          className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors text-sm"
          title="Expand filter panel"
        >
          <IconFilters className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <>
      {/* Backdrop on tablet/phone where the expanded panel floats over the content */}
      <div className="fixed inset-0 z-30 bg-black/50 touch-none lg:hidden" onClick={onToggleCollapsed} />
      <aside className="fixed inset-y-0 left-0 z-40 w-[88vw] max-w-sm shadow-2xl
        lg:static lg:z-auto lg:w-72 lg:max-w-none lg:shadow-none
        shrink-0 bg-gray-900 border-r border-gray-800
        flex flex-col overflow-y-auto overflow-x-hidden">
      {/* Sticky header: title + Done (mobile) / collapse (desktop) */}
      <div className="sticky top-0 z-10 bg-gray-900 flex items-center justify-between gap-2 px-3 py-2.5 lg:py-2 border-b border-gray-800">
        <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
          <IconFilters className="w-3.5 h-3.5 text-gray-500" /> Filters
        </span>
        <button
          onClick={onToggleCollapsed}
          className="font-semibold rounded-md transition-colors text-gray-200
            px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm
            lg:bg-transparent lg:text-gray-500 lg:hover:text-gray-200 lg:hover:bg-gray-800 lg:px-2 lg:py-1 lg:text-xs"
          title="Collapse filter panel"
        >
          <span className="lg:hidden">Done</span>
          <ChevronRight className="hidden lg:inline w-3 h-3 rotate-180" />
        </button>
      </div>
      <div className="p-3 sm:p-4 flex-1">

        {/* Active watchlist only */}
        <label className="group flex items-center gap-2.5 text-[11px] text-gray-400 mb-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={f.pinnedOnly}
            onChange={e => set('pinnedOnly', e.target.checked)}
            className="accent-amber-400"
          />
          <span className={`w-4 h-4 rounded flex items-center justify-center border transition-colors duration-150
            ${f.pinnedOnly ? "bg-amber-500/15 border-amber-500/50 text-amber-400" : "bg-gray-800 border-gray-700 text-gray-500 group-hover:text-amber-400/70"}`}>
            <PinStar className="w-2.5 h-2.5" />
          </span>
          <span className={`transition-colors duration-150 ${f.pinnedOnly ? "text-gray-200 font-medium" : "group-hover:text-gray-200"}`}>
            Watchlist only
          </span>
        </label>

        {/* Rule of 40 only */}
        <label
          className="group flex items-center gap-2.5 text-[11px] text-gray-400 mb-3 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            checked={f.rule40Only}
            onChange={e => set('rule40Only', e.target.checked)}
            className="accent-emerald-400"
          />
          <span className={`w-4 h-4 rounded flex items-center justify-center border text-[7.5px] font-bold tabular-nums transition-colors duration-150
            ${f.rule40Only ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400" : "bg-gray-800 border-gray-700 text-gray-500 group-hover:text-emerald-400/70"}`}>
            40
          </span>
          <Tooltip content="Rev growth % + EBITDA margin % ≥ 40." maxWidth={180}>
            <span className={`transition-colors duration-150 border-b border-dotted border-gray-700 ${f.rule40Only ? "text-gray-200 font-medium" : "group-hover:text-gray-200"}`}>
              Rule of 40
            </span>
          </Tooltip>
        </label>

        <MultiSelect
          label="Sectors"
          options={sectors}
          selected={f.sectors || []}
          onChange={val => setArr('sectors', val)}
          search={sectorSearch}
          onSearchChange={setSectorSearch}
          placeholder="Search sectors…"
        />

        <MultiSelect
          label="Industries"
          options={industries}
          selected={f.industries || []}
          onChange={val => setArr('industries', val)}
          search={industrySearch}
          onSearchChange={setIndustrySearch}
          placeholder="Search industries…"
        />

        <Section title="Universe" defaultOpen>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Scope</div>
          <div className="flex border border-gray-700 rounded-md overflow-hidden text-[10px] mb-4">
            {[
              ["us", "US only"],
              ["us-listed", "US + ADR"],
              ["global", "Global"],
            ].map(([val, label]) => (
              <button
                key={val}
                onClick={() => set("universe", val)}
                className={`flex-1 py-1.5 lg:py-1 transition-colors cursor-pointer ${
                  universeScope === val
                    ? "bg-blue-600 text-white font-medium"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                }`}
                title={
                  val === "us"
                    ? "US-headquartered only"
                    : val === "us-listed"
                    ? "NYSE/NASDAQ/AMEX + ADRs"
                    : "All markets worldwide"
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* ETF include toggle — client-side filter (universe refresh always loads full lists) */}
          <label className="flex items-center gap-2 text-xs text-gray-400 mt-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!f.includeEtfs}
              onChange={(e) => set("includeEtfs", e.target.checked)}
              className="accent-blue-400"
            />
            <span>Include ETFs &amp; Funds</span>
          </label>
        </Section>

        <Section title="Size" defaultOpen>
          <FilterRow label="Mkt Cap ($B)" filterKey="mcap" filters={f} set={set} step={1} />

          <FilterRow label="Volume (M)" filterKey="volMin" filters={f} set={set} step={1} />

          <FilterRow label="Price ($)" filterKey="price" filters={f} set={set} step={0.5} />
        </Section>

        <Section title="Margins" defaultOpen>
          <FilterRow label="Gross Margin"   filterKey="grossMin"   filters={f} set={set} step={1} />
          <FilterRow label="Op Margin"      filterKey="opMin"      filters={f} set={set} step={1} />
          <FilterRow label="Net Margin"     filterKey="netMin"     filters={f} set={set} step={1} />
          <FilterRow label="EBITDA Margin"  filterKey="ebitdaMin"  filters={f} set={set} step={1} />
          <FilterRow label="FCF Margin"     filterKey="fcfMargMin" filters={f} set={set} step={1} />
        </Section>

        <Section title="Returns" defaultOpen>
          <FilterRow label="ROIC" filterKey="roicMin" filters={f} set={set} step={1} />
          <FilterRow label="ROE"  filterKey="roeMin"  filters={f} set={set} step={1} />
          <FilterRow label="ROA"  filterKey="roaMin"  filters={f} set={set} step={1} />
        </Section>

        <Section title="Growth" defaultOpen>
          <FilterRow label="Revenue Growth" filterKey="revGrowthMin" filters={f} set={set} step={1} />
          <FilterRow label="EPS Growth"     filterKey="epsGrowthMin" filters={f} set={set} step={1} />
          <FilterRow label="FCF Growth"     filterKey="fcfGrowthMin" filters={f} set={set} step={1} />
          <FilterRow label="Op Inc Growth"  filterKey="opIncGrowthMin" filters={f} set={set} step={1} />
          <FilterRow label="Rule of 40"     filterKey="r40Min" filters={f} set={set} step={1} />
        </Section>

        <Section title="Valuation" defaultOpen>
          <FilterRow label="P/E"        filterKey="peMax"   filters={f} set={set} step={1} />
          <FilterRow label="P/B"        filterKey="pbMax"   filters={f} set={set} step={0.5} />
          <FilterRow label="P/S"        filterKey="psMax"   filters={f} set={set} step={0.5} />
          <FilterRow label="EV/EBITDA"  filterKey="evEbMax" filters={f} set={set} step={0.5} />
          <FilterRow label="EV/Sales"   filterKey="evSMax"  filters={f} set={set} step={0.2} />
          <FilterRow label="EV/GP"      filterKey="evGpMax" filters={f} set={set} step={0.5} />
          <FilterRow label="FCF Yield"  filterKey="fcfMin"  filters={f} set={set} step={0.5} />
          <FilterRow label="Earn Yield" filterKey="earningsYieldMin" filters={f} set={set} step={0.5} />
        </Section>

        <Section title="Balance Sheet">
          <FilterRow label="ND/EBITDA"     filterKey="ndMax" filters={f} set={set} step={0.1} />
          <FilterRow label="Current Ratio" filterKey="crMin" filters={f} set={set} step={0.1} />
          <FilterRow label="D/E"           filterKey="deMax" filters={f} set={set} step={0.1} />
        </Section>

        <Section title="Dividend">
          <FilterRow label="Div Yield" filterKey="divMin"  filters={f} set={set} step={0.25} />
          <FilterRow label="Payout"    filterKey="payMax" filters={f} set={set} step={1} />
        </Section>

        <Section title="Risk">
          <FilterRow label="Beta" filterKey="beta" filters={f} set={set} step={0.1} />
        </Section>

        {/* Reset */}
        <button
          onClick={() => setFilters({ ...DEFAULT_FILTERS })}
          className="w-full mt-3 py-2 lg:py-1.5 text-[11px] font-semibold rounded-md bg-gray-800
            text-gray-400 border border-gray-700 hover:bg-gray-700 hover:text-gray-200
            transition-colors duration-150 cursor-pointer"
        >
          Reset filters
        </button>

      </div>
      </aside>
    </>
  );
}
