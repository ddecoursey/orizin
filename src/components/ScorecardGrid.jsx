import React, { useMemo } from 'react';
import { fmt } from '../lib/format.js';
import { SECTOR_COLORS } from '../lib/scoring.js';

// Cards aren't virtualized (unlike the table), so cap how many DOM nodes we
// render. The card view is a "browse the best" surface — showing the top N by
// score keeps it smooth on phones/tablets where it's now the default view.
const CARD_CAP = 300;

function StatRow({ label, value, type }) {
  const f = fmt(value, type);
  const pos = type === 'pct' && value > 0;
  const neg = type === 'pct' && value < 0;
  return (
    <div className="flex justify-between py-1 border-b border-gray-800/50">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold font-mono text-xs ${pos ? 'text-emerald-400' : neg ? 'text-red-400' : 'text-gray-300'}`}>
        {f ?? <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}

function SubChip({ label, value, colors, title }) {
  const pct = value != null ? Math.round(value * 100) : null;
  return (
    <span
      className="group relative inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9.5px] font-semibold tracking-[-0.2px] cursor-default"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {label} {pct ?? '—'}

      {title && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 hidden group-hover:block z-[90] pointer-events-none">
          <div className="relative flex flex-col items-center transition-all duration-150 ease-out group-hover:opacity-100 group-hover:translate-y-0 opacity-0 -translate-y-1">
            {/* Arrow pointing up */}
            <div className="relative -mb-px h-2.5 w-4 overflow-hidden">
              <div className="absolute left-1/2 bottom-0 -translate-x-1/2 h-3 w-3 rotate-45 bg-zinc-900 border-r border-b border-white/15" />
            </div>
            {/* Tooltip body */}
            <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/15 text-gray-200 text-[10.5px] leading-relaxed px-3.5 py-2 rounded-xl shadow-2xl shadow-black/70 max-w-[260px] whitespace-normal text-left">
              {title}
            </div>
          </div>
        </span>
      )}
    </span>
  );
}

function Scorecard({ r, rank, onSelectStock, pinned, onTogglePin }) {
  const sc = r.score != null ? Math.round(r.score * 100) : null;
  const scoreColor = sc >= 70 ? '#10b981' : sc >= 45 ? '#f59e0b' : '#ef4444';
  const sec = SECTOR_COLORS[r.sector] || { bg: '#1e293b', fg: '#94a3b8' };

  return (
    <div
      onClick={() => onSelectStock?.(r)}
      className={`bg-gray-900 border rounded-xl p-3.5
        hover:border-gray-600 hover:shadow-lg hover:shadow-black/40 transition-all
        ${pinned ? 'border-amber-800/60 bg-amber-950/10' : 'border-gray-800'}
        ${onSelectStock ? 'cursor-pointer' : ''}`}
      style={{ borderTop: `3px solid ${sec.bg}` }}
    >
      <div className="flex justify-between items-start mb-1">
        <div>
          <span className="text-[9px] font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded mr-1">
            #{rank}
          </span>
          <span className="font-black text-gray-100 text-base">{r.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          {onTogglePin && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(r.symbol); }}
              title={pinned ? 'Unpin' : 'Pin to favorites'}
              className={`text-lg leading-none transition-colors ${
                pinned ? 'text-amber-400' : 'text-gray-700 hover:text-amber-400'
              }`}
            >
              {pinned ? '★' : '☆'}
            </button>
          )}
          <span className="text-2xl font-black" style={{ color: scoreColor }}>
            {sc ?? '—'}
          </span>
        </div>
      </div>
      <div className="text-[10px] text-gray-500 mb-3 flex items-center gap-2">
        <span className="truncate">{r.name}</span>
        <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium"
          style={{ background: sec.bg, color: sec.fg }}>{r.sector || '—'}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 text-[10px] mb-3">
        <StatRow label="Mkt Cap"    value={r.mcap}          type="money" />
        <StatRow label="P/E"        value={r.pe}            type="x" />
        <StatRow label="EV/EBITDA"  value={r.ev_ebitda}     type="x" />
        <StatRow label="EV/GP"      value={r.ev_gp}         type="x" />
        <StatRow label="ROIC"       value={r.roic}          type="pct" />
        <StatRow label="Gross M"    value={r.gross_margin}  type="pct" />
        <StatRow label="Op M"       value={r.op_margin}     type="pct" />
        <StatRow label="FCF Yld"    value={r.fcf_yield}     type="pct" />
        <StatRow label="Earn Yld"   value={r.earnings_yield} type="pct" />
        <StatRow label="Rev Gr"     value={r.revenue_growth} type="pct" />
        <StatRow label="EPS Gr"     value={r.eps_growth}     type="pct" />
        <StatRow label="FCF Gr"     value={r.fcf_growth}     type="pct" />
        <StatRow label="Op Inc Gr"  value={r.op_income_growth} type="pct" />
        <StatRow label="ND/EBITDA"  value={r.net_debt_ebitda} type="ratio" />
        <StatRow label="Div Yld"    value={r.div_yield}     type="pct" />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <SubChip
          label="Q"
          value={r.qScore}
          colors={{ bg: '#14532d', fg: '#86efac' }}
          title="Quality — Profitable, capital-efficient businesses with strong balance sheets (ROIC, margins, low debt, liquidity)."
        />
        <SubChip
          label="V"
          value={r.vScore}
          colors={{ bg: '#713f12', fg: '#fde68a' }}
          title="Value — Cheap on multiples + margin of safety (EV/GP, EV/EBITDA, P/E, FCF yield, DCF)."
        />
        <SubChip
          label="G"
          value={r.gScore}
          colors={{ bg: '#134e4b', fg: '#5eead4' }}
          title="Growth — Revenue, EPS, and FCF growth (TTM). Higher = favor faster-growing companies."
        />
        {r.dataCoverage != null && r.score != null && (
          <SubChip
            label="Data"
            value={r.dataCoverage}
            colors={
              r.dataCoverage >= 0.75
                ? { bg: '#1e3a5f', fg: '#93c5fd' }
                : { bg: '#78350f', fg: '#fcd34d' }
            }
            title="How much of the 16-metric scorecard has real data. Missing inputs count as a slightly-below-median rank instead of being ignored, so sparse data can't inflate the score — but low coverage still means lower confidence."
          />
        )}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-800 text-gray-400">
          β {r.beta != null ? r.beta.toFixed(1) : '—'}
        </span>
      </div>

      {/* Effective weights */}
      {r.effectiveWeights && (
        <div className="mt-1.5 flex items-center gap-x-2 text-[9px] text-gray-500 font-medium tracking-tight">
          <span className="text-gray-600">Effective:</span>
          <span className={r.effectiveWeights.q > 0 ? "" : "text-gray-700/60"}>
            Q {Math.round(r.effectiveWeights.q * 100)}%
          </span>
          <span className={r.effectiveWeights.v > 0 ? "" : "text-gray-700/60"}>
            V {Math.round(r.effectiveWeights.v * 100)}%
          </span>
          <span className={r.effectiveWeights.g > 0 ? "" : "text-gray-700/60"}>
            G {Math.round(r.effectiveWeights.g * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

const MemoizedScorecard = React.memo(Scorecard);

export default function ScorecardGrid({ rows, onSelectStock, pins, onTogglePin }) {
  // Pinned favorites are floated to the top (then ordered by score), so they
  // stay visible regardless of the score sort — same behavior as the table view.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => {
      const ap = pins?.has(a.symbol), bp = pins?.has(b.symbol);
      if (ap !== bp) return ap ? -1 : 1;
      return (b.score || 0) - (a.score || 0);
    }),
    [rows, pins],
  );
  const shown = sorted.length > CARD_CAP ? sorted.slice(0, CARD_CAP) : sorted;

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-gray-500">
        <span className="text-3xl mb-3">📊</span>
        <p className="font-medium text-gray-400">No results</p>
        <p className="text-xs mt-1">Loosen your filters or wait for metrics to finish loading.</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
        {shown.map((r, i) => (
          <MemoizedScorecard
            key={r.symbol}
            r={r}
            rank={i + 1}
            onSelectStock={onSelectStock}
            pinned={pins?.has(r.symbol)}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>
      {sorted.length > CARD_CAP && (
        <div className="text-center text-xs text-gray-500 py-4">
          Showing the top {CARD_CAP} of {sorted.length} by Orizin Score — narrow your filters to surface more specific names.
        </div>
      )}
    </div>
  );
}
