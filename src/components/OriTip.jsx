// Compact ✧ tooltip body for screener rows (table + scorecards). Mirrors Ori's Take:
// intangibles score, model tier, top X-factors with strength dots, conviction delta.

import { prettyFactorLabel } from "../lib/intangibleFactors.js";

const XF = {
  strong: { n: 3, dot: "bg-emerald-400", text: "text-emerald-300" },
  moderate: { n: 2, dot: "bg-amber-400", text: "text-amber-300" },
  weak: { n: 1, dot: "bg-red-400", text: "text-red-300" },
};

function XFDots({ strength }) {
  const s = XF[strength] || { n: 0, dot: "bg-gray-700" };
  return (
    <span className="inline-flex gap-0.5 shrink-0 pt-px">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < s.n ? s.dot : "bg-gray-700"}`} />
      ))}
    </span>
  );
}

export default function OriTip({ ori }) {
  const tier = ori.modelTier === "frontier" ? "Frontier" : ori.modelTier === "value" ? "Value" : "Lite";
  const xf = Array.isArray(ori.xFactors) ? ori.xFactors.slice(0, 3) : [];
  return (
    <div className="space-y-0.5 w-36 rounded border border-violet-900/40 bg-violet-950/25 -mx-0.5 px-1 py-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-gray-100">Intangibles {ori.intangiblesScore ?? "—"}</span>
        <span className="text-[8px] uppercase tracking-wide text-violet-300/80">{tier}</span>
      </div>
      {xf.map((x, i) => {
        const s = XF[x.strength] || { text: "text-gray-400" };
        return (
          <div key={i} className="flex items-center gap-1.5">
            <XFDots strength={x.strength} />
            <span className={`truncate ${s.text}`}>{prettyFactorLabel(x.factor)}</span>
          </div>
        );
      })}
      {ori.convictionDelta ? (
        <div className="text-[9px] text-gray-500">
          Δ {ori.convictionDelta > 0 ? "+" : ""}{ori.convictionDelta}
        </div>
      ) : null}
    </div>
  );
}