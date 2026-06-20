import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import BrokeragePanel from '../components/BrokeragePanel.jsx';
import InvestingPreferences from '../components/InvestingPreferences.jsx';
import { IconPie } from '../components/icons.jsx';
import { buildFitContext } from '../lib/fitScore.js';
import { computeSectorGaps } from '../lib/portfolioAnalysis.js';

function TickerAutocomplete({ value, onChange, symbols, theme = 'dark' }) {
  const [inputValue, setInputValue] = useState(value || '');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState({});
  useEffect(() => { setInputValue(value || ''); }, [value]);
  const filtered = React.useMemo(() => {
    const q = inputValue.trim().toUpperCase();
    if (!q) return symbols.slice(0, 8);
    return symbols.filter(s => s.includes(q)).sort((a, b) => {
      const aStarts = a.startsWith(q); const bStarts = b.startsWith(q);
      if (aStarts && !bStarts) return -1; if (!aStarts && bStarts) return 1;
      return a.localeCompare(b);
    }).slice(0, 10);
  }, [inputValue, symbols]);
  const updatePosition = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({ position: 'fixed', top: `${rect.bottom + 4}px`, left: `${rect.left}px`, width: `${Math.max(rect.width, 140)}px`, zIndex: 9999 });
  };
  const openDropdown = () => { setOpen(true); requestAnimationFrame(updatePosition); };
  const closeDropdown = () => setOpen(false);
  const selectSymbol = (sym) => { onChange(sym); setInputValue(sym); closeDropdown(); inputRef.current?.blur(); };
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        const dropdown = document.getElementById('ticker-dropdown-portal');
        if (!dropdown || !dropdown.contains(e.target)) closeDropdown();
      }
    };
    const handleScrollOrResize = () => { if (open) updatePosition(); };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);
  return (
    <div className="relative" ref={inputRef}>
      <input
        type="text" value={inputValue} onChange={(e) => { const val = e.target.value.toUpperCase(); setInputValue(val); onChange(val); if (!open) openDropdown(); }}
        onFocus={openDropdown} onKeyDown={(e) => { if (e.key === 'Escape') closeDropdown(); if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); selectSymbol(filtered[0]); } }}
        placeholder="VOO" className="font-mono uppercase bg-transparent border border-gray-700 focus:border-blue-500 rounded px-2 py-1 w-24 text-sm text-gray-100"
      />
      {open && filtered.length > 0 && createPortal(
        <div id="ticker-dropdown-portal" style={dropdownStyle} className={theme === 'dark' ? "bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-52 overflow-auto text-sm py-1 text-gray-100" : "bg-white border border-stone-300 rounded-lg shadow-xl max-h-52 overflow-auto text-sm py-1 text-stone-800"}>
          {filtered.map((sym) => (<div key={sym} onMouseDown={(e) => { e.preventDefault(); selectSymbol(sym); }} className={theme === 'dark' ? "px-3 py-1.5 cursor-pointer hover:bg-gray-800 font-mono" : "px-3 py-1.5 cursor-pointer hover:bg-stone-100 font-mono"}>{sym}</div>))}
        </div>, document.body
      )}
    </div>
  );
}

export default function PortfolioGoalsPage({
  portfolioGoals,
  stocks = [],
  theme = 'dark',
  onSelectStock,
  detailStock,
  weights,
  setWeights,
  risk,
  setRisk,
}) {
  const {
    portfolios,
    goals,
    theses,
    hydrated,
    addPortfolio,
    updatePortfolio,
    deletePortfolio,
    renamePortfolio,
    addHolding,
    updateHolding,
    deleteHolding,
    addGoal,
    updateGoal,
    deleteGoal,
    addThesis,
    updateThesis,
    deleteThesis,
    grandTotal,
    overallAllocations,
  } = portfolioGoals || {};
  const [goalsVisible, setGoalsVisible] = useState(() => { const saved = localStorage.getItem('portfolio_goals_visible'); return saved !== null ? saved === 'true' : true; });
  const [allocationLimit, setAllocationLimit] = useState(10);
  // Collapse the heavy holdings editor by default for a cleaner page — the
  // Combined Allocation + portfolio chips stay visible; expand to edit.
  const [editorOpen, setEditorOpen] = useState(false);
  const toggleGoals = () => { setGoalsVisible(v => { const next = !v; localStorage.setItem('portfolio_goals_visible', String(next)); return next; }); };
  const availableSymbols = React.useMemo(() => { const set = new Set((stocks || []).map((r) => r.symbol).filter(Boolean)); return [...set].sort(); }, [stocks]);
  const [selectedId, setSelectedId] = useState(null);
  React.useEffect(() => {
    if (!selectedId && portfolios.length > 0) setSelectedId(portfolios[0].id);
    if (portfolios.length === 0) setSelectedId(null);
    else if (selectedId && !portfolios.find(p => p.id === selectedId)) setSelectedId(portfolios[0].id);
  }, [portfolios, selectedId]);
  const selectedPortfolio = portfolios.find(p => p.id === selectedId);
  const handleAddPortfolio = () => { const id = addPortfolio('New Portfolio'); setSelectedId(id); };
  const handleTotalChange = (value) => { if (!selectedPortfolio) return; const num = parseFloat(value) || 0; updatePortfolio(selectedPortfolio.id, { totalInvested: num }); };
  const handleAddHolding = () => { if (!selectedPortfolio) return; addHolding(selectedPortfolio.id, ''); };
  const handleTickerClick = (ticker) => { if (!onSelectStock || ticker === 'MISC') return; const stock = stocks.find(s => s.symbol === ticker.toUpperCase()); if (stock) onSelectStock(stock); };
  const formatMoney = (n) => (n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatPercent = (n) => (n || 0).toFixed(2) + '%';
  const fitCtx = useMemo(
    () => buildFitContext({ portfolios, goals, theses, stocks }),
    [portfolios, goals, theses, stocks],
  );
  const sectorGaps = useMemo(() => computeSectorGaps(fitCtx, stocks), [fitCtx, stocks]);

  if (!portfolioGoals || !hydrated) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-800 px-4 sm:px-6 py-3 sm:py-4 shrink-0 bg-gray-950">
        <div><h1 className="text-xl font-semibold tracking-tight">Portfolio</h1><p className="text-xs text-gray-500 mt-0.5">Your holdings, goals and theses are sent to Ori automatically. Changes save as you type.</p></div>
        <div className="flex items-center gap-3 sm:gap-6">
          <button onClick={toggleGoals} className="text-xs px-3 py-2 lg:py-1.5 rounded-lg border border-gray-800 bg-gray-900/50 hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-2 cursor-pointer">
            {goalsVisible ? 'Hide Goals & Theses' : 'Show Goals & Theses'} <span className="opacity-50">{goalsVisible ? '→' : '←'}</span>
          </button>
          <div className="text-right"><div className="text-[10px] uppercase tracking-widest text-gray-500">Total Portfolio Value</div><div className="text-2xl font-semibold tabular-nums text-emerald-400">{formatMoney(grandTotal)}</div></div>
        </div>
      </div>
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col border-r border-gray-800 min-h-0 overflow-hidden">
          <div className="px-6 pt-4 pb-3 flex items-center justify-between shrink-0 border-b border-gray-800 bg-gray-950">
            <div className="text-sm font-semibold text-gray-300">Your Portfolios</div>
            <button onClick={handleAddPortfolio} className="text-xs px-3 py-1.5 lg:py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer active:scale-95 transition-transform">+ New Portfolio</button>
          </div>
          <div className="flex-1 overflow-auto p-6 space-y-6 text-gray-200">
            {overallAllocations.length > 0 && (
              <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 mb-8 oz-fade-rise">
                <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2"><IconPie className="w-4 h-4 text-blue-400" />Combined Allocation</h3><div className="text-[10px] text-gray-500 uppercase tracking-widest">Across all {portfolios.length} portfolios</div></div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {overallAllocations.slice(0, allocationLimit).map((alloc) => (
                    <div key={alloc.ticker} onClick={() => handleTickerClick(alloc.ticker)} className={`bg-gray-950 border rounded-xl p-3 flex flex-col gap-1 transition-all duration-200 ${alloc.ticker !== 'MISC' ? 'cursor-pointer hover:bg-gray-900 hover:-translate-y-0.5 hover:border-gray-700' : ''} ${detailStock?.symbol === alloc.ticker ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-gray-800'}`}>
                      <div className="flex items-center justify-between"><span className="font-mono font-bold text-gray-100">{alloc.ticker}</span><span className="text-emerald-400 font-mono text-xs">{formatPercent(alloc.overallPercent)}</span></div>
                      <div className="text-[10px] text-gray-500 tabular-nums">{formatMoney(alloc.dollars)}</div>
                      <div className="w-full bg-gray-800 h-1 rounded-full mt-1 overflow-hidden"><div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.min(100, alloc.overallPercent)}%` }} /></div>
                    </div>
                  ))}
                </div>
                {overallAllocations.length > allocationLimit && allocationLimit < 50 && (
                  <button onClick={() => setAllocationLimit(l => Math.min(50, l + 5))} className="mt-4 text-xs text-blue-400 hover:text-blue-300 font-medium">+ Add 5 more</button>
                )}
              </div>
            )}
            {sectorGaps.length > 0 && (
              <div className="rounded-2xl border border-violet-900/40 bg-violet-950/20 p-5 mb-8">
                <h3 className="text-sm font-semibold text-violet-200 mb-2">Sector gaps</h3>
                <p className="text-[11px] text-gray-500 mb-3">Sectors in the universe where your portfolio is under 5% allocated — potential diversification opportunities.</p>
                <ul className="space-y-1.5 text-[11px] text-gray-300">
                  {sectorGaps.map((g) => (
                    <li key={g.sector} className="flex justify-between gap-2 border-b border-gray-800/50 py-1">
                      <span>{g.sector}</span>
                      <span className="text-gray-500 tabular-nums">{g.portfolioPct}% held · {g.universeCount} names in universe</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Brokerage scaffolding: simulated account linking + order tickets,
                ready for real Plaid/Alpaca providers server-side. */}
            <BrokeragePanel />

            {portfolios.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {portfolios.map((p) => (
                  <button key={p.id} onClick={() => { setSelectedId(p.id); setEditorOpen(true); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all flex items-center gap-2 ${selectedId === p.id ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-gray-900 border-gray-800 hover:bg-gray-800 text-gray-300'}`}>{p.name}<span className="text-[10px] text-gray-500 tabular-nums">{formatMoney(p.totalInvested)}</span></button>
                ))}
              </div>
            )}
            {selectedPortfolio ? (
              <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
                <button
                  onClick={() => setEditorOpen(o => !o)}
                  className="w-full flex items-center justify-between gap-3 text-left group"
                >
                  <div className="flex items-baseline gap-3 min-w-0">
                    <span className="text-base font-semibold text-gray-100 truncate">{selectedPortfolio.name || 'Untitled'}</span>
                    <span className="text-xs text-gray-500 tabular-nums shrink-0">
                      {formatMoney(selectedPortfolio.totalInvested)} · {(selectedPortfolio.holdings || []).filter(h => h.ticker).length} holding{(selectedPortfolio.holdings || []).filter(h => h.ticker).length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 group-hover:text-gray-200 shrink-0 flex items-center gap-1">
                    {editorOpen ? 'Collapse' : 'Edit'}
                    <span className={`transition-transform ${editorOpen ? 'rotate-180' : ''}`}>▾</span>
                  </span>
                </button>

                {editorOpen && (
                <div className="mt-5">
                <div className="flex flex-wrap items-end gap-4 mb-5">
                  <div className="flex-1 min-w-[200px]"><div className="text-xs text-gray-400 mb-1">Portfolio Name</div><input type="text" value={selectedPortfolio.name} onChange={(e) => renamePortfolio(selectedPortfolio.id, e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-lg font-semibold focus:outline-none focus:border-blue-500 text-gray-100" /></div>
                  <div className="w-52"><div className="text-xs text-gray-400 mb-1">Total Invested</div><div className="relative"><span className="absolute left-3 top-2.5 text-gray-500">$</span><input type="number" value={selectedPortfolio.totalInvested || ''} onChange={(e) => handleTotalChange(e.target.value)} className="w-full bg-gray-950 border border-gray-700 rounded-lg pl-6 pr-3 py-2 font-medium focus:outline-none focus:border-blue-500 tabular-nums text-gray-100" /></div></div>
                  <button onClick={() => { if (confirm(`Delete portfolio "${selectedPortfolio.name}"?`)) deletePortfolio(selectedPortfolio.id); }} className="ml-auto px-3 py-2 text-sm text-red-400 hover:text-red-300 border border-red-900/60 rounded-lg">Delete Portfolio</button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2"><div className="text-sm font-medium text-gray-300">Holdings</div><button onClick={handleAddHolding} className="text-sm px-3 py-1.5 lg:py-1 rounded-md bg-gray-800 hover:bg-gray-700 border border-gray-700 flex items-center gap-1 cursor-pointer">+ Add Holding</button></div>
                  <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950">
                    <table className="w-full text-sm">
                      <thead className="text-gray-400"><tr className="border-b border-gray-800"><th className="text-left pl-4 py-2 font-normal text-xs">Ticker</th><th className="text-right pr-4 py-2 font-normal text-xs w-28">% of Portfolio</th><th className="text-right pr-4 py-2 font-normal text-xs w-32">Dollar Amount</th><th className="w-8"></th></tr></thead>
                      <tbody className="divide-y divide-gray-800">
                        {(selectedPortfolio.holdings || []).map((h, idx) => (
                          <tr key={idx} className="hover:bg-gray-900/60 group">
                            <td className="pl-4 py-2 flex items-center gap-2 text-gray-100">
                              <TickerAutocomplete value={h.ticker} onChange={(val) => updateHolding(selectedPortfolio.id, idx, 'ticker', val)} symbols={availableSymbols} theme={theme} />
                              {h.ticker && <button onClick={() => handleTickerClick(h.ticker)} className={`p-1 rounded hover:bg-gray-800 transition-colors ${detailStock?.symbol === h.ticker.toUpperCase() ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}><svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg></button>}
                            </td>
                            <td className="pr-4 py-2"><div className="flex justify-end items-center gap-1"><input type="number" step="0.01" value={h.percent != null ? h.percent : ''} onChange={(e) => updateHolding(selectedPortfolio.id, idx, 'percent', e.target.value)} className="w-20 text-right bg-gray-900 border border-gray-700 focus:border-blue-500 rounded px-2 py-1 text-sm tabular-nums text-gray-100" /><span className="text-gray-500 text-xs">%</span></div></td>
                            <td className="pr-4 py-2"><div className="flex justify-end items-center gap-1"><span className="text-gray-500 text-xs">$</span><input type="number" step="0.01" value={h.dollars != null ? h.dollars : ''} onChange={(e) => updateHolding(selectedPortfolio.id, idx, 'dollars', e.target.value)} className="w-28 text-right bg-gray-900 border border-gray-700 focus:border-blue-500 rounded px-2 py-1 text-sm tabular-nums text-gray-100" /></div></td>
                            <td className="pr-2 text-right"><button onClick={() => deleteHolding(selectedPortfolio.id, idx)} className="text-gray-500 hover:text-red-400 px-2 py-1 text-lg leading-none cursor-pointer">×</button></td>
                          </tr>
                        ))}
                        {/* Mandatory MISC row */}
                        <tr className="bg-gray-900/30">
                          <td className="pl-4 py-2 font-mono text-gray-500 italic">MISC</td>
                          <td className="pr-4 py-2 text-right text-gray-500 font-mono text-sm">
                            {(() => {
                              const used = (selectedPortfolio.holdings || []).reduce((s, h) => s + (Number(h.percent) || 0), 0);
                              return formatPercent(Math.max(0, 100 - used));
                            })()}
                          </td>
                          <td className="pr-4 py-2 text-right text-gray-500 font-mono text-sm">
                            {(() => {
                              const total = Number(selectedPortfolio.totalInvested) || 0;
                              const used = (selectedPortfolio.holdings || []).reduce((s, h) => s + (Number(h.percent) || 0), 0);
                              const rem = Math.max(0, 100 - used);
                              return formatMoney((rem / 100) * total);
                            })()}
                          </td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                </div>
                )}
              </div>
            ) : <div className="text-center py-12 text-gray-400">Create your first portfolio.</div>}
          </div>
        </div>
        {goalsVisible && (
          <div className="w-full lg:w-96 xl:w-[420px] flex flex-col border-t lg:border-t-0 lg:border-l border-gray-800 bg-gray-900/30 min-h-0 shrink-0 oz-pane-in">
            <div className="px-5 pt-4 pb-3 border-b border-gray-800 shrink-0">
              <div className="text-sm font-semibold text-gray-300">Goals &amp; Theses</div>
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">Sent to Ori automatically for context.</p>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-6">
              {/* Personal investing preferences — risk tolerance + Q/V/G lens */}
              {weights && setWeights && setRisk && (
                <InvestingPreferences weights={weights} setWeights={setWeights} risk={risk} setRisk={setRisk} />
              )}

              {/* Investment Goals */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Investment Goals</div>
                  <button onClick={() => addGoal('')} className="text-xs px-2.5 py-1.5 lg:py-1 rounded bg-violet-600 hover:bg-violet-500 text-white font-medium cursor-pointer">+ Add</button>
                </div>
                <p className="text-[10px] text-gray-500 leading-snug">What you want your investing to achieve (e.g. timelines, income, risk).</p>
                {goals.length === 0 && <div className="text-gray-500 text-sm py-2">No goals yet.</div>}
                {goals.map((goal, index) => (
                  <div key={index} className="flex gap-2 group">
                    <input type="text" value={goal} onChange={(e) => updateGoal(index, e.target.value)} placeholder="e.g. Retire in 2035..." className="flex-1 bg-gray-950 border border-gray-700 focus:border-violet-500 rounded-lg px-3 py-2 text-sm text-gray-100" />
                    <button onClick={() => deleteGoal(index)} className="opacity-30 group-hover:opacity-100 text-red-400 hover:text-red-300 px-1 text-xl leading-none self-center">×</button>
                  </div>
                ))}
              </div>

              {/* Investment Theses */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Investment Theses</div>
                  <button onClick={() => addThesis('')} className="text-xs px-2.5 py-1.5 lg:py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer">+ Add</button>
                </div>
                <p className="text-[10px] text-gray-500 leading-snug">Convictions about specific companies or trends that steer Ori's thinking (e.g. "HOOD will grow as younger investors mature", "TSLA has a 10-yr edge from robotaxi + humanoids + space data centers").</p>
                {theses.length === 0 && <div className="text-gray-500 text-sm py-2">No theses yet.</div>}
                {theses.map((thesis, index) => (
                  <div key={index} className="flex gap-2 group">
                    <textarea value={thesis} onChange={(e) => updateThesis(index, e.target.value)} rows={3} placeholder="e.g. I believe Robinhood will keep growing as the younger generation grows into investors..." className="flex-1 bg-gray-950 border border-gray-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-gray-100 resize-y leading-snug" />
                    <button onClick={() => deleteThesis(index)} className="opacity-30 group-hover:opacity-100 text-red-400 hover:text-red-300 px-1 text-xl leading-none self-start mt-1">×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
