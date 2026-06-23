import {
  PERSONAS, PERSONA_KEYS,
  RISKS, RISK_LABELS,
  HORIZONS,
  GOALS,
} from "../lib/personas.js";

// Compact personalization "lens" for the screener toolbar. It's the SAME persona /
// risk / horizon / goal saved on the Portfolio page (shared useScreener state) —
// surfaced here so changing it re-resolves the 7-category Conviction weights
// (lib/personas.js resolvePillarWeights) and re-ranks the visible table in real
// time, where the effect is actually visible. Full descriptions live on the
// Portfolio page; this is the quick tuner.

const HORIZON_SHORT = { short: "Short", medium: "Medium", long: "Long" };
const GOAL_SHORT = { preserve: "Preserve", grow: "Grow", maximize: "Maximize", income: "Income" };

const SELECT =
  "appearance-none bg-gray-900 border border-gray-800 rounded-md text-xs text-gray-200 pl-2 pr-5 py-1.5 outline-none cursor-pointer hover:bg-gray-800 focus:border-blue-500 bg-no-repeat";
const CARET = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='%236b7280'%3E%3Cpath d='M3 4.5L6 8l3-3.5z'/%3E%3C/svg%3E\")",
  backgroundPosition: "right 0.35rem center",
  backgroundSize: "0.7rem",
};

function LensSelect({ title, value, onChange, children }) {
  return (
    <select className={SELECT} style={CARET} value={value} onChange={(e) => onChange(e.target.value)} title={title} aria-label={title}>
      {children}
    </select>
  );
}

export default function ScreenerLens({ persona, setPersona, risk, setRisk, horizon, setHorizon, goal, setGoal, showHorizon = true }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-gray-600 hidden xl:inline" title="These weight your Conviction score">Lens</span>
      <LensSelect title="Investor persona — weights Conviction across the app" value={persona || "balanced_growth"} onChange={setPersona}>
        {PERSONA_KEYS.map((k) => <option key={k} value={k}>{PERSONAS[k].emoji} {PERSONAS[k].label}</option>)}
      </LensSelect>
      <LensSelect title="Portfolio goal" value={goal || "grow"} onChange={setGoal}>
        {GOALS.map((k) => <option key={k} value={k}>{GOAL_SHORT[k]}</option>)}
      </LensSelect>
      <LensSelect title="Risk tolerance" value={risk || "balanced"} onChange={setRisk}>
        {RISKS.map((k) => <option key={k} value={k}>{RISK_LABELS[k]}</option>)}
      </LensSelect>
      {showHorizon && (
        <LensSelect title="Investment horizon" value={horizon || "medium"} onChange={setHorizon}>
          {HORIZONS.map((k) => <option key={k} value={k}>{HORIZON_SHORT[k]}</option>)}
        </LensSelect>
      )}
    </div>
  );
}
