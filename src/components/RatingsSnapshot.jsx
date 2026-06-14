// FMP Ratings snapshot — overall letter grade + 1–5 sub-scores (DCF, ROE, ROA,
// D/E, P/E, P/B). Shared by the screener company side-pane (StockDetailModal)
// and the Deep Research page so they render identically.

import { gradeColor } from "../lib/ratingColor.js";

// 1–5 score → color
const scoreColor5 = (s) =>
  s >= 5 ? "#22c55e" : s >= 4 ? "#4ade80" : s >= 3 ? "#f59e0b" : s >= 2 ? "#fb923c" : "#ef4444";

function ScoreBar5({ score }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-1.5 flex-1 rounded-sm"
          style={{ background: score != null && i <= score ? scoreColor5(score) : "rgba(120,120,120,0.25)" }}
        />
      ))}
    </div>
  );
}

export default function RatingsSnapshot({ ratings }) {
  const gc = gradeColor(ratings.rating);
  const subs = [
    ["DCF", ratings.dcf_score],
    ["ROE", ratings.roe_score],
    ["ROA", ratings.roa_score],
    ["D/E", ratings.de_score],
    ["P/E", ratings.pe_score],
    ["P/B", ratings.pb_score],
  ];
  return (
    <div className="flex gap-4">
      {/* Overall grade */}
      <div
        className="flex flex-col items-center justify-center rounded-xl px-4 py-2 shrink-0"
        style={{ background: gc.bg, color: gc.fg }}
      >
        <span className="text-2xl font-black leading-none">{ratings.rating ?? "—"}</span>
        {ratings.overall_score != null && (
          <span className="text-[9px] font-semibold opacity-80 mt-1">
            {ratings.overall_score}/5 overall
          </span>
        )}
      </div>

      {/* Sub-scores */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 flex-1 self-center">
        {subs.map(([label, s]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 w-7 shrink-0">{label}</span>
            <ScoreBar5 score={s} />
            <span className="text-[10px] font-mono text-gray-400 w-3 text-right shrink-0">
              {s ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
