import { useState, useEffect, useRef } from "react";

// Personal investing preferences — Risk Tolerance + the Q/V/G fundamentals lens.
// These shape the unified Conviction across the whole app (screener, cards, Deep
// Research), so they live on the Portfolio page as a saved per-account setting.

const RISK_OPTIONS = [
  { value: "conservative", label: "Conservative", emoji: "🛡", blurb: "Lower risk. Favors larger, profitable, low-debt, steady names and pushes speculative micro-caps / high-beta / unprofitable names well down the list." },
  { value: "balanced", label: "Balanced", emoji: "⚖", blurb: "A sensible middle ground with a mild guard against the most speculative names. Good default for most investors." },
  { value: "aggressive", label: "Aggressive", emoji: "🚀", blurb: "Higher risk tolerance. Comfortable holding smaller, faster-growing, more volatile names — barely penalizes speculation." },
];

function WeightSlider({ label, value, onChange }) {
  const [local, setLocal] = useState(value);
  const t = useRef(null);
  useEffect(() => setLocal(value), [value]);
  const handle = (e) => {
    const v = Number(e.target.value);
    setLocal(v);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => onChange(v), 120);
  };
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-300 mb-1">
        <span>{label}</span>
        <span className="font-mono text-gray-400">{local}</span>
      </div>
      <input type="range" min="0" max="100" value={local} onChange={handle} className="w-full accent-blue-500 h-2" />
    </div>
  );
}

export default function InvestingPreferences({ weights, setWeights, risk, setRisk }) {
  const current = risk || "balanced";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">Investing preferences</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Personalize how <span className="text-gray-300 font-medium">Conviction</span> is scored across the whole app. Saved to your account.
        </p>
      </div>

      {/* Risk tolerance — the genuinely personal dimension */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Risk tolerance</div>
        <div className="grid grid-cols-3 gap-2">
          {RISK_OPTIONS.map((o) => {
            const active = current === o.value;
            return (
              <button
                key={o.value}
                onClick={() => setRisk(o.value)}
                aria-pressed={active}
                className={`rounded-lg border px-2 py-2.5 text-center transition-colors cursor-pointer ${
                  active
                    ? "border-blue-500 bg-blue-950/40 text-gray-100"
                    : "border-gray-700 bg-gray-950/40 text-gray-400 hover:bg-gray-800"
                }`}
              >
                <div className="text-lg leading-none">{o.emoji}</div>
                <div className="text-xs font-semibold mt-1">{o.label}</div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">{RISK_OPTIONS.find((o) => o.value === current)?.blurb}</p>
      </div>

      {/* Q/V/G fundamentals lens */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Fundamentals lens (Quality / Value / Growth)</div>
        <div className="space-y-3">
          <WeightSlider label="Quality" value={weights.q} onChange={(v) => setWeights((w) => ({ ...w, q: v }))} />
          <WeightSlider label="Value" value={weights.v} onChange={(v) => setWeights((w) => ({ ...w, v: v }))} />
          <WeightSlider label="Growth" value={weights.g} onChange={(v) => setWeights((w) => ({ ...w, g: v }))} />
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          How the Orizin fundamentals engine weights its three pillars. Most investors want all three — leave it balanced unless you have a strong tilt.
        </p>
      </div>
    </div>
  );
}
