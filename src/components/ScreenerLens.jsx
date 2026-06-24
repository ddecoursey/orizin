import { useEffect, useRef, useState } from "react";
import {
  PERSONAS, PERSONA_KEYS,
  RISKS, RISK_LABELS,
  HORIZONS,
  GOALS,
} from "../lib/personas.js";

// Compact personalization "lens" — a single button that opens a popover with the
// persona / goal / risk / horizon controls. It's the SAME persona/risk/horizon/
// goal saved on the Portfolio page (shared useScreener state); changing it here
// re-resolves the 7-category Conviction weights and re-ranks the table in real
// time. Collapsing it to one button keeps the screener toolbar and the Deep
// Research header from looking busy.

const HORIZON_SHORT = { short: "Short", medium: "Medium", long: "Long" };
const GOAL_SHORT = { preserve: "Preserve", grow: "Grow", maximize: "Maximize", income: "Income" };

function Pill({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-2 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors text-left ${
        active
          ? "border-blue-500 bg-blue-950/50 text-gray-100"
          : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, children }) {
  return (
    <div className="pt-1.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export default function ScreenerLens({ persona, setPersona, risk, setRisk, horizon, setHorizon, goal, setGoal, showHorizon = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activePersona = PERSONAS[persona] ? persona : "balanced_growth";
  const p = PERSONAS[activePersona];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Conviction lens — persona, goal, risk & horizon"
        aria-label="Conviction lens"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-800 bg-gray-900 text-xs text-gray-200 hover:bg-gray-800 cursor-pointer"
      >
        <span className="text-[10px] uppercase tracking-wider text-gray-500 hidden sm:inline">Lens</span>
        <span className="text-sm leading-none">{p.emoji}</span>
        <span className="font-medium hidden md:inline">{p.label}</span>
        <span className="text-gray-500 text-[9px] leading-none">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Investor persona</div>
          <div className="grid grid-cols-2 gap-1">
            {PERSONA_KEYS.map((k) => (
              <Pill key={k} active={activePersona === k} onClick={() => setPersona(k)} title={PERSONAS[k].blurb}>
                <span className="mr-1">{PERSONAS[k].emoji}</span>{PERSONAS[k].label}
              </Pill>
            ))}
          </div>

          <Row label="Goal">
            {GOALS.map((k) => (
              <Pill key={k} active={(goal || "grow") === k} onClick={() => setGoal(k)}>{GOAL_SHORT[k]}</Pill>
            ))}
          </Row>
          <Row label="Risk tolerance">
            {RISKS.map((k) => (
              <Pill key={k} active={(risk || "balanced") === k} onClick={() => setRisk(k)}>{RISK_LABELS[k]}</Pill>
            ))}
          </Row>
          {showHorizon && (
            <Row label="Horizon">
              {HORIZONS.map((k) => (
                <Pill key={k} active={(horizon || "medium") === k} onClick={() => setHorizon(k)}>{HORIZON_SHORT[k]}</Pill>
              ))}
            </Row>
          )}

          <p className="text-[10px] text-gray-600 pt-2">Weights the Conviction score across the whole app.</p>
        </div>
      )}
    </div>
  );
}
