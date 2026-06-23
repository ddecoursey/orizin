import {
  PERSONAS, PERSONA_KEYS,
  RISKS, RISK_LABELS,
  HORIZONS,
  GOALS,
  CATEGORIES, CATEGORY_LABELS, CATEGORY_TOOLTIPS,
  resolvePillarPercents,
} from "../lib/personas.js";
import Tooltip from "./Tooltip.jsx";

// Personal investing profile — Investor Persona + Risk + Horizon + Goal. Together
// these resolve the 7-category weights that shape the unified Conviction across the
// whole app (screener, cards, Deep Research), so they live on the Portfolio page as
// a saved per-account setting. (Replaced the old Risk + Q/V/G sliders; the Q/V/G
// fundamentals lens is now fixed internally and folds into the Fundamentals pillar.)

const HORIZON_SHORT = { short: "Short", medium: "Medium", long: "Long" };
const GOAL_SHORT = { preserve: "Preserve", grow: "Grow", maximize: "Maximize", income: "Income" };

function Segmented({ label, options, value, onChange }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{label}</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`rounded-lg border px-2 py-2 text-center text-xs font-semibold transition-colors cursor-pointer ${
                active ? "border-blue-500 bg-blue-950/40 text-gray-100" : "border-gray-700 bg-gray-950/40 text-gray-400 hover:bg-gray-800"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function InvestingPreferences({ persona, setPersona, horizon, setHorizon, goal, setGoal, risk, setRisk }) {
  const activePersona = PERSONAS[persona] ? persona : "balanced_growth";
  const percents = resolvePillarPercents({ persona: activePersona, risk, horizon, goal });
  const maxPct = Math.max(...CATEGORIES.map((k) => percents[k]), 1);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-gray-200">Investing profile</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Pick the <span className="text-gray-300 font-medium">investor persona</span> and lenses that shape how <span className="text-gray-300 font-medium">Conviction</span> is weighted across the whole app. Saved to your account.
        </p>
      </div>

      {/* Investor persona */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Investor persona</div>
        <div className="grid grid-cols-3 gap-2">
          {PERSONA_KEYS.map((key) => {
            const p = PERSONAS[key];
            const active = activePersona === key;
            return (
              <Tooltip key={key} content={p.blurb} side="top" maxWidth={200}>
                <button
                  type="button"
                  onClick={() => setPersona(key)}
                  aria-pressed={active}
                  className={`w-full rounded-lg border px-2 py-2 text-center transition-colors cursor-pointer ${
                    active ? "border-blue-500 bg-blue-950/40" : "border-gray-700 bg-gray-950/40 hover:bg-gray-800"
                  }`}
                >
                  <div className="text-base leading-none mb-0.5">{p.emoji}</div>
                  <div className={`text-[11px] font-bold leading-tight ${active ? "text-gray-100" : "text-gray-300"}`}>{p.label}</div>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <Segmented label="Risk tolerance" value={risk || "balanced"} onChange={setRisk}
          options={RISKS.map((v) => ({ value: v, label: RISK_LABELS[v] }))} />
        <Segmented label="Investment horizon" value={horizon || "medium"} onChange={setHorizon}
          options={HORIZONS.map((v) => ({ value: v, label: HORIZON_SHORT[v] }))} />
        <Segmented label="Portfolio goal" value={goal || "grow"} onChange={setGoal}
          options={GOALS.map((v) => ({ value: v, label: GOAL_SHORT[v] }))} />
      </div>

      {/* Live resolved weight breakdown */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Resulting category weights</div>
        <div className="space-y-1.5">
          {CATEGORIES.map((k) => {
            const isOri = k === "intangibles";
            return (
              <div key={k} className="flex items-center gap-2">
                <Tooltip content={CATEGORY_TOOLTIPS[k]} side="right" maxWidth={220}>
                  <div className={`w-28 shrink-0 text-[11px] flex items-center gap-1 cursor-help ${isOri ? "text-violet-300" : "text-gray-400"}`}>
                    {isOri && <span className="text-[9px] text-violet-400">✧</span>}
                    {CATEGORY_LABELS[k]}
                  </div>
                </Tooltip>
                <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isOri ? "bg-violet-500/70" : "bg-blue-600/70"}`}
                    style={{ width: `${(percents[k] / maxPct) * 100}%` }}
                  />
                </div>
                <div className={`w-9 shrink-0 text-right text-[11px] font-mono ${isOri ? "text-violet-300" : "text-gray-300"}`}>{percents[k]}%</div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          Persona sets the base; risk, horizon and goal adjust it. Weights renormalize to 100%.
        </p>
      </div>
    </div>
  );
}
