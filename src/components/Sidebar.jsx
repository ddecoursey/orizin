import { useState, useMemo, useRef, useEffect } from 'react';
import { DEFAULT_FILTERS } from '../hooks/useScreener.js';

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
      <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onToggleCollapsed} />
      <aside className="fixed inset-y-0 left-0 z-40 w-[88vw] max-w-sm shadow-2xl
        lg:static lg:z-auto lg:w-56 lg:max-w-none lg:shadow-none
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
      <div className="p-3 flex-1">

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
          <NumRow label="Mkt cap ≥ $B" value={f.mcapMin} onChange={v => set('mcapMin', v)} step={1} />
          <NumRow label="Mkt cap ≤ $B" value={f.mcapMax} onChange={v => set('mcapMax', v)} step={5} />
          <NumRow label="Volume ≥ M"   value={f.volMin}  onChange={v => set('volMin', v)}  step={1} />
        </Section>

        <Section title="Margins" defaultOpen>
          <NumRow label="Gross ≥ %"      value={f.grossMin}   onChange={v => set('grossMin', v)}   step={1} />
          <NumRow label="Operating ≥ %"  value={f.opMin}      onChange={v => set('opMin', v)}      step={1} />
          <NumRow label="Net ≥ %"        value={f.netMin}     onChange={v => set('netMin', v)}      step={1} />
          <NumRow label="EBITDA ≥ %"     value={f.ebitdaMin}  onChange={v => set('ebitdaMin', v)}  step={1} />
          <NumRow label="FCF margin ≥ %" value={f.fcfMargMin} onChange={v => set('fcfMargMin', v)} step={1} />
        </Section>

        <Section title="Returns" defaultOpen>
          <NumRow label="ROIC ≥ %" value={f.roicMin} onChange={v => set('roicMin', v)} step={1} />
          <NumRow label="ROE ≥ %"  value={f.roeMin}  onChange={v => set('roeMin', v)}  step={1} />
          <NumRow label="ROA ≥ %"  value={f.roaMin}  onChange={v => set('roaMin', v)}  step={1} />
        </Section>

        <Section title="Growth" defaultOpen>
          <NumRow label="Revenue ≥ %"  value={f.revGrowthMin} onChange={v => set('revGrowthMin', v)} step={1} />
          <NumRow label="EPS ≥ %"      value={f.epsGrowthMin} onChange={v => set('epsGrowthMin', v)} step={1} />
          <NumRow label="FCF ≥ %"      value={f.fcfGrowthMin} onChange={v => set('fcfGrowthMin', v)} step={1} />
          <NumRow label="Rule of 40 ≥" value={f.r40Min}       onChange={v => set('r40Min', v)}      step={1} />
        </Section>

        <Section title="Valuation" defaultOpen>
          <NumRow label="P/E ≤"        value={f.peMax}   onChange={v => set('peMax', v)}   step={1} />
          <NumRow label="P/B ≤"        value={f.pbMax}   onChange={v => set('pbMax', v)}   step={0.5} />
          <NumRow label="P/S ≤"        value={f.psMax}   onChange={v => set('psMax', v)}   step={0.5} />
          <NumRow label="EV/EBITDA ≤"  value={f.evEbMax} onChange={v => set('evEbMax', v)} step={0.5} />
          <NumRow label="EV/Sales ≤"   value={f.evSMax}  onChange={v => set('evSMax', v)}  step={0.2} />
          <NumRow label="EV/GP ≤"      value={f.evGpMax} onChange={v => set('evGpMax', v)} step={0.5} />
          <NumRow label="FCF yield ≥ %" value={f.fcfMin} onChange={v => set('fcfMin', v)} step={0.5} />
        </Section>

        <Section title="Balance Sheet">
          <NumRow label="ND/EBITDA ≤"     value={f.ndMax} onChange={v => set('ndMax', v)} step={0.1} />
          <NumRow label="Current ratio ≥" value={f.crMin} onChange={v => set('crMin', v)} step={0.1} />
          <NumRow label="D/E ≤"           value={f.deMax} onChange={v => set('deMax', v)} step={0.1} />
        </Section>

        <Section title="Dividend">
          <NumRow label="Yield ≥ %"  value={f.divMin} onChange={v => set('divMin', v)} step={0.25} />
          <NumRow label="Payout ≤ %" value={f.payMax} onChange={v => set('payMax', v)} step={1} />
        </Section>

        <Section title="Risk">
          <NumRow label="Beta ≥" value={f.betaMin} onChange={v => set('betaMin', v)} step={0.1} />
          <NumRow label="Beta ≤" value={f.betaMax} onChange={v => set('betaMax', v)} step={0.1} />
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
