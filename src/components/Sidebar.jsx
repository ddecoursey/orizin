import { useState, useMemo, useRef, useEffect } from 'react';
import { DEFAULT_FILTERS } from '../hooks/useScreener.js';

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

  return (
    <div className="flex items-center gap-2 mb-1">
      <label className="flex-1 text-xs text-gray-400">{label}</label>

      <div className="flex items-center flex-shrink-0">
        <select
          value={current.op || ">="}
          onChange={(e) => handleOp(e.target.value)}
          className="w-9 shrink-0 appearance-none text-center text-sm leading-none bg-gray-900 border border-gray-700 rounded-l px-0 py-0.5 text-gray-200 focus:outline-none focus:border-blue-500"
        >
          <option value=">=">≥</option>
          <option value=">">&gt;</option>
          <option value="<=">≤</option>
          <option value="<">&lt;</option>
          <option value="=">=</option>
          <option value="between">..</option>
        </select>

        <div className="flex items-center">
          <input
            type="number"
            step={step}
            value={isBetween ? current.min ?? "" : current.value ?? ""}
            onChange={(e) => handleVal("min", e.target.value)}
            className="w-14 px-1 py-0.5 text-xs border border-gray-700 bg-gray-900 text-gray-200 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />

          {isBetween && (
            <>
              <span className="text-gray-500 text-[10px] px-0.5">–</span>
              <input
                type="number"
                step={step}
                value={current.max ?? ""}
                onChange={(e) => handleVal("max", e.target.value)}
                className="w-14 px-1 py-0.5 text-xs border border-gray-700 bg-gray-900 text-gray-200 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </>
          )}

          {/* Interval adjusters (▲ ▼) */}
          <div className="flex flex-col border border-l-0 border-gray-700 rounded-r overflow-hidden">
            <button
              type="button"
              onClick={() => adjust(step)}
              className="px-1.5 text-[9px] leading-none min-h-[16px] text-gray-500 hover:text-gray-200 hover:bg-gray-800 active:bg-gray-700 transition-colors"
              title={`+${step}`}
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => adjust(-step)}
              className="px-1.5 text-[9px] leading-none min-h-[16px] text-gray-500 hover:text-gray-200 hover:bg-gray-800 active:bg-gray-700 transition-colors border-t border-gray-700"
              title={`-${step}`}
            >
              ▼
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumRow({ label, value, onChange, step = 1, placeholder = '' }) {
  const numValue = value === '' || value == null ? '' : Number(value);

  const adjust = (delta) => {
    const current = numValue === '' ? 0 : numValue;
    const next = Math.max(0, current + delta); // prevent negative for most filters
    onChange(next === 0 ? '' : next);
  };

  return (
    <div className="flex items-center gap-2 mb-1">
      <label className="flex-1 text-xs text-gray-400">{label}</label>

      <div className="flex items-center">
        <input
          type="number"
          value={value}
          step={step}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-20 px-2 py-1.5 text-sm lg:w-16 lg:px-1.5 lg:py-0.5 lg:text-xs rounded-l border border-gray-700 bg-gray-900 text-gray-200 focus:outline-none focus:border-blue-500
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />

        {/* Quick adjust arrows */}
        <div className="flex flex-col border border-l-0 border-gray-700 rounded-r overflow-hidden">
          <button
            type="button"
            onClick={() => adjust(step)}
            className="px-2.5 text-[10px] leading-none min-h-[18px] lg:px-2 lg:text-[9px] lg:min-h-[16px] text-gray-500 hover:text-gray-200 hover:bg-gray-800 active:bg-gray-700 transition-colors"
            title={`+${step}`}
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => adjust(-step)}
            className="px-2.5 text-[10px] leading-none min-h-[18px] lg:px-2 lg:text-[9px] lg:min-h-[16px] text-gray-500 hover:text-gray-200 hover:bg-gray-800 active:bg-gray-700 transition-colors border-t border-gray-700"
            title={`-${step}`}
          >
            ▼
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
        <div className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">{label}</div>
        {selected?.length > 0 && (
          <div className="text-[10px] text-blue-400">{selected.length} selected</div>
        )}
      </div>

      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-2 lg:py-1 text-xs bg-gray-800 border border-gray-700 rounded flex justify-between items-center hover:border-gray-600 text-left"
      >
        <span className="text-gray-300 truncate">
          {selected?.length > 0
            ? `${selected.length} selected`
            : `All ${label.toLowerCase()}`}
        </span>
        <span className="text-gray-500 text-[10px]">▼</span>
      </button>

      {open && (
        <div className="absolute z-[60] mt-1 w-full bg-gray-900 border border-gray-700 rounded shadow-2xl max-h-64 flex flex-col">
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
                  className="flex items-center gap-2 px-2 py-1 hover:bg-gray-800 cursor-pointer rounded"
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
        className="flex items-center gap-1.5 w-full text-left py-1 text-xs font-semibold
          text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span className={`text-gray-600 text-[8px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        {title}
      </button>
      {open && <div className="pl-2 pb-1">{children}</div>}
    </div>
  );
}

export default function Sidebar({ filters, setFilters, stocks, onAddTicker, collapsed, onToggleCollapsed }) {
  const [addInput, setAddInput] = useState('');
  const [addStatus, setAddStatus] = useState('');
  const [adding, setAdding] = useState(false);

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

  function toggleMulti(key, val) {
    const arr = f[key] || [];
    const next = arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
    setArr(key, next);
  }

  async function handleAdd() {
    const sym = addInput.trim().toUpperCase();
    if (!sym) return;
    setAdding(true);
    setAddStatus(`Fetching ${sym}…`);
    try {
      await onAddTicker(sym);
      setAddInput('');
      setAddStatus(`✓ Added ${sym}`);
    } catch (e) {
      setAddStatus(`Error: ${e.message}`);
    } finally {
      setAdding(false);
    }
  }

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
          ▶
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
        <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Filters</span>
        <button
          onClick={onToggleCollapsed}
          className="font-semibold rounded-md transition-colors text-gray-200
            px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm
            lg:bg-transparent lg:text-gray-500 lg:hover:text-gray-200 lg:hover:bg-gray-800 lg:px-2 lg:py-1 lg:text-xs"
          title="Collapse filter panel"
        >
          <span className="lg:hidden">Done</span>
          <span className="hidden lg:inline">◀</span>
        </button>
      </div>
      <div className="p-3 sm:p-4 flex-1">

        {/* Pinned only */}
        <label className="flex items-center gap-2 text-xs text-gray-400 mb-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={f.pinnedOnly}
            onChange={e => set('pinnedOnly', e.target.checked)}
            className="accent-amber-400"
          />
          <span className="text-amber-400">★</span> Pinned only
        </label>

        {/* Rule of 40 only */}
        <label
          className="flex items-center gap-2 text-xs text-gray-400 mb-3 cursor-pointer"
          title="Rule of 40 = Revenue growth (%) + EBITDA margin (%) ≥ 40. Classic growth-stock health check; needs growth + margin data."
        >
          <input
            type="checkbox"
            checked={f.rule40Only}
            onChange={e => set('rule40Only', e.target.checked)}
            className="accent-emerald-400"
          />
          <span className="text-emerald-400">40</span>
          <span className="border-b border-dotted border-gray-600">Rule of 40</span>
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
          <div className="text-[9px] uppercase tracking-widest text-gray-600 font-bold mb-1">Scope</div>
          <div className="flex border border-gray-700 rounded-md overflow-hidden text-[10px] mb-1">
            {[
              ["us", "US only"],
              ["us-listed", "US + ADR"],
              ["global", "Global"],
            ].map(([val, label]) => (
              <button
                key={val}
                onClick={() => set("universe", val)}
                className={`flex-1 py-1 transition-colors ${
                  universeScope === val
                    ? "bg-blue-600 text-white font-medium"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                }`}
                title={
                  val === "us"
                    ? "US-headquartered companies only (country=US)"
                    : val === "us-listed"
                    ? "Stocks listed on NYSE/NASDAQ/AMEX including ADRs (TSM, ASML, ARM...)"
                    : "All markets worldwide (top ~8000 by screener)"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-[9px] text-gray-500 mb-2 leading-snug">
            {universeScope === "us" && "US-headquartered only. Refresh to update list."}
            {universeScope === "us-listed" && "US exchanges + ADRs like TSM. Refresh for fresh list."}
            {universeScope === "global" && "Worldwide (no geo filter). Refresh to pull more names."}
          </div>
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
          {/* Beta - operator + value (compact) */}
          <div className="flex items-center gap-2 mb-1">
            <label className="flex-1 text-xs text-gray-400">Beta</label>
            <div className="flex items-center gap-1 flex-shrink-0">
              <select
                value={f.beta?.op || ">="}
                onChange={e => {
                  const current = f.beta || {};
                  set("beta", { ...current, op: e.target.value });
                }}
                className="w-8 text-center text-xs bg-gray-900 border border-gray-700 rounded px-0.5 py-0.5 text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value=">=">≥</option>
                <option value=">">&gt;</option>
                <option value="<=">≤</option>
                <option value="<">&lt;</option>
                <option value="=">=</option>
                <option value="between">..</option>
              </select>

              <input
                type="number"
                step={0.1}
                value={f.beta?.op === "between" ? f.beta?.min ?? "" : f.beta?.value ?? ""}
                onChange={e => {
                  const current = f.beta || { op: ">=" };
                  if (current.op === "between") {
                    set("beta", { ...current, min: e.target.value });
                  } else {
                    set("beta", { ...current, value: e.target.value });
                  }
                }}
                className="w-14 px-1 py-0.5 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              {f.beta?.op === "between" && (
                <>
                  <span className="text-gray-500 text-[10px]">–</span>
                  <input
                    type="number"
                    step={0.1}
                    value={f.beta?.max ?? ""}
                    onChange={e => {
                      const current = f.beta || { op: "between" };
                      set("beta", { ...current, max: e.target.value });
                    }}
                    className="w-14 px-1 py-0.5 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </>
              )}
            </div>
          </div>
        </Section>

        {/* Reset */}
        <button
          onClick={() => setFilters({ ...DEFAULT_FILTERS })}
          className="w-full mt-3 py-1.5 text-xs font-medium rounded bg-gray-800
            text-gray-400 border border-gray-700 hover:bg-gray-700 hover:text-gray-200
            transition-colors"
        >
          Reset filters
        </button>

        {/* Add Ticker */}
        <div className="mt-4">
          <div className="text-[9px] uppercase tracking-widest text-gray-600 font-bold mb-1.5">
            Add Ticker
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={addInput}
              onChange={e => setAddInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. PYPL"
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-gray-700
                bg-gray-900 text-gray-200 focus:outline-none focus:border-blue-500 uppercase"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !addInput.trim()}
              className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-300
                border border-gray-700 hover:bg-gray-700 disabled:opacity-40
                disabled:cursor-not-allowed transition-colors"
            >
              Add
            </button>
          </div>
          {addStatus && (
            <div className={`mt-1 text-[10px] ${addStatus.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {addStatus}
            </div>
          )}
        </div>

      </div>
      </aside>
    </>
  );
}
