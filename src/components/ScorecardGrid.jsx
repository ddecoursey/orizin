import React, { useMemo } from 'react';
import { fmt } from '../lib/format.js';
import { SECTOR_COLORS } from '../lib/scoring.js';
import { IconChart } from './icons.jsx';

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

function SubChip({ label, value, colors, title, lowCov }) {
  const pct = value != null ? Math.round(value * 100) : null;
  const style = lowCov
    ? { background: colors.bg, color: colors.fg, border: '1px solid #f59e0b' }
    : { background: colors.bg, color: colors.fg };
  return (
    <span
      className="group relative inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9.5px] font-semibold tracking-[-0.2px] cursor-default"
      style={style}
    >
      {label} {pct ?? '—'}

      {title && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 hidden group-hover:block z-[90] pointer-events-none">
          <div className="relative flex flex-col items-center transition-all duration-75 ease-out group-hover:opacity-100 group-hover:translate-y-0 opacity-0 -translate-y-1">
            {/* Arrow pointing up */}
            <div className="relative -mb-px h-2.5 w-4 overflow-hidden">
              <div className="absolute left-1/2 bottom-0 -translate-x-1/2 h-3 w-3 rotate-45 bg-zinc-900 border-r border-b border-white/15" />
            </div>
            {/* Tooltip body */}
            <div className="bg-zinc-900 border border-white/15 text-gray-200 text-[10.5px] leading-relaxed px-3.5 py-2 rounded-xl shadow-2xl shadow-black/70 max-w-[260px] whitespace-normal text-left">
              {title}
            </div>
          </div>
        </span>
      )}
    </span>
  );
}

function Scorecard({ r, rank, onSelectStock, pinned, onTogglePin }) {
  const sc = r.conviction != null ? r.conviction : r.score != null ? Math.round(r.score * 100) : null;
  const scoreColor = sc >= 70 ? '#10b981' : sc >= 45 ? '#f59e0b' : '#ef4444';
  const sec = SECTOR_COLORS[r.sector] || { bg: '#1e293b', fg: '#94a3b8' };

  return (
    <div
      onClick={() => onSelectStock?.(r)}
      className={`bg-gray-900 border rounded-xl p-3.5
        hover:border-gray-600 hover:shadow-lg hover:shadow-black/40 transition-[border-color,box-shadow] duration-50
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
              className={`text-lg leading-none ${
                pinned ? 'text-amber-400' : 'text-gray-700 hover:text-amber-400'
              }`}
            >
              {pinned ? '★' : '☆'}
            </button>
          )}
          <span
            className="text-2xl font-black"
            style={{ color: scoreColor }}
            title={r.dataCoveragePenalty > 0
              ? `Conviction ${sc} (base ${r.baseConviction}, -${r.dataCoveragePenalty} data-coverage penalty for missing heavily-weighted pillar data)`
              : undefined}
          >
            {sc ?? '—'}
            {r.dataCoveragePenalty > 0 && (
              <span className="text-[10px] align-super ml-0.5 text-amber-400" title={`Data penalty -${r.dataCoveragePenalty}`}>↓</span>
            )}
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
          lowCov={r.pillarCoverage && r.pillarCoverage.q < 0.5}
          title={`Quality — Profitable, capital-efficient businesses with strong balance sheets (ROIC, margins, low debt, liquidity). Pillar coverage: ${r.pillarCoverage ? Math.round(r.pillarCoverage.q * 100) : '—'}% real data.`}
        />
        <SubChip
          label="V"
          value={r.vScore}
          colors={{ bg: '#713f12', fg: '#fde68a' }}
          lowCov={r.pillarCoverage && r.pillarCoverage.v < 0.5}
          title={`Value — Cheap on multiples + margin of safety (EV/GP, EV/EBITDA, P/E, FCF yield, DCF). Pillar coverage: ${r.pillarCoverage ? Math.round(r.pillarCoverage.v * 100) : '—'}% real data.`}
        />
        <SubChip
          label="G"
          value={r.gScore}
          colors={{ bg: '#134e4b', fg: '#5eead4' }}
          lowCov={r.pillarCoverage && r.pillarCoverage.g < 0.5}
          title={`Growth — Revenue, EPS, and FCF growth (TTM). Higher = favor faster-growing companies. Pillar coverage: ${r.pillarCoverage ? Math.round(r.pillarCoverage.g * 100) : '—'}% real data.`}
        />
        {r.dataCoverage != null && r.score != null && (
          <SubChip
            label="Data"
            value={r.dataCoverage}
            colors={
              (r.dataCoveragePenalty && r.dataCoveragePenalty > 0)
                ? { bg: '#78350f', fg: '#fcd34d' }
                : (r.dataCoverage >= 0.75 ? { bg: '#1e3a5f', fg: '#93c5fd' } : { bg: '#78350f', fg: '#fcd34d' })
            }
            title={
              (r.dataCoveragePenalty && r.dataCoveragePenalty > 0)
                ? `Data coverage ${Math.round(r.dataCoverage*100)}%. Conviction penalized by ${r.dataCoveragePenalty} because user-weighted pillar(s) have heavy missing data (see Q/V/G %). Low-evidence names are pushed down the ranking when you weight a missing pillar heavily.`
                : "How much of the 16-metric scorecard has real data. Missing inputs count as a slightly-below-median rank instead of being ignored, so sparse data can't inflate the score — but low coverage still means lower confidence."
            }
          />
        )}
        {r.durabilityProxy != null && (
          <SubChip
            label="Dur"
            value={r.durabilityProxy / 100}
            colors={
              r.durabilityProxy >= 70 ? { bg: '#14532d', fg: '#86efac' } :
              r.durabilityProxy >= 50 ? { bg: '#713f12', fg: '#fde68a' } : { bg: '#78350f', fg: '#fcd34d' }
            }
            title={`Business durability proxy (${r.durabilityProxy}/100). Combines real profitability sustainability, capital efficiency/safety, data richness, and scale/stability. High = harder for "perfect on paper" quantitative names to rank at the top without underlying business quality. Cheap equivalent to Ori intangibles review (full version on Deep Research for any symbol).`}
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
  // Pinned favorites are floated to the top (then ordered by conviction), so
  // they stay visible regardless of the sort — same behavior as the table view.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => {
      const ap = pins?.has(a.symbol), bp = pins?.has(b.symbol);
      if (ap !== bp) return ap ? -1 : 1;
      return (b.conviction || 0) - (a.conviction || 0);
    }),
    [rows, pins],
  );
  const shown = sorted.length > CARD_CAP ? sorted.slice(0, CARD_CAP) : sorted;

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-gray-500">
        <IconChart className="w-8 h-8 mb-3 text-gray-600" />
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
          Showing the top {CARD_CAP} of {sorted.length} by Conviction — narrow your filters to surface more specific names.
        </div>
      )}
    </div>
  );
}
