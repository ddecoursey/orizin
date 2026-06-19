import InfoHint from "./InfoHint.jsx";

// ── Game Plan — the ONE unified verdict for a stock ───────────────────────────
// Folds the old Orizin Score (→ Fundamentals pillar) and Fit Score (→ Fit
// pillar) into a single conviction 0–100 + hold horizon + right-now action, then
// adds Ori's intelligence layer (Intangibles / future potential, macro, bull &
// bear). Color tells the story: green = strong/favorable, amber = mixed/watch,
// red = weak/caution. Educational only.

const TONE = {
  good: { text: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-700/50", bar: "bg-emerald-500", dot: "bg-emerald-400" },
  ok: { text: "text-amber-400", bg: "bg-amber-950/40", border: "border-amber-700/50", bar: "bg-amber-500", dot: "bg-amber-400" },
  bad: { text: "text-red-400", bg: "bg-red-950/40", border: "border-red-800/50", bar: "bg-red-500", dot: "bg-red-400" },
  neutral: { text: "text-gray-400", bg: "bg-gray-800/60", border: "border-gray-700", bar: "bg-gray-600", dot: "bg-gray-500" },
};
const GAUGE_LABEL = { good: "Good", ok: "Fair", bad: "Weak", neutral: "—" };
const convictionTone = (c) => (c == null ? "neutral" : c >= 66 ? "good" : c >= 45 ? "ok" : "bad");
const RISK = {
  low: { text: "text-emerald-300", bg: "bg-emerald-950/50 border-emerald-800/60" },
  moderate: { text: "text-amber-300", bg: "bg-amber-950/50 border-amber-800/60" },
  high: { text: "text-orange-300", bg: "bg-orange-950/50 border-orange-800/60" },
  speculative: { text: "text-red-300", bg: "bg-red-950/50 border-red-800/60" },
};

// Strength styling for Ori's X-factors (the named pieces of the intangible case:
// moat/monopoly, TAM, management, brand, regulatory). Filled-dot count signals how
// strong each factor is, so a near-monopoly reads at a glance.
const STRENGTH = {
  strong: { dot: "bg-emerald-400", text: "text-emerald-300", filled: 3 },
  moderate: { dot: "bg-amber-400", text: "text-amber-300", filled: 2 },
  weak: { dot: "bg-gray-500", text: "text-gray-400", filled: 1 },
};

function XFactor({ x }) {
  const s = STRENGTH[x.strength] || STRENGTH.moderate;
  return (
    <div className="flex items-start gap-2 py-1 border-b border-violet-900/20 last:border-0">
      <span className="flex gap-0.5 pt-1 shrink-0" title={x.strength}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < s.filled ? s.dot : "bg-gray-700"}`} />
        ))}
      </span>
      <span className="min-w-0">
        <span className={`text-[11.5px] font-semibold ${s.text}`}>{x.factor}</span>
        {x.note && <span className="text-[11px] text-gray-400"> — {x.note}</span>}
      </span>
    </div>
  );
}

function Pillar({ p, oriState }) {
  const isOri = p.id === "intangibles";
  const loading = isOri && oriState?.loading && p.score == null;
  const locked = isOri && oriState?.locked && p.score == null;
  const t = TONE[p.tone || "neutral"];
  const pct = p.score != null ? Math.round(p.score * 100) : null;
  return (
    <div className="min-w-0" title={Array.isArray(p.reasons) ? p.reasons.join(" · ") : undefined}>
      <div className="flex items-baseline justify-between mb-1 gap-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 truncate">
          {p.label}
          {isOri && <span className="ml-0.5 text-violet-400">✦</span>}
        </span>
        <span className={`text-[10px] font-bold shrink-0 ${locked ? "text-violet-300" : loading ? "text-gray-500" : t.text}`}>
          {locked ? "Pro" : loading ? "…" : pct != null ? GAUGE_LABEL[p.tone] : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        {loading ? (
          <div className="h-full w-1/3 bg-violet-700/60 animate-pulse" />
        ) : (
          <div className={`h-full rounded-full ${t.bar} transition-all`} style={{ width: `${pct ?? 5}%` }} />
        )}
      </div>
    </div>
  );
}

export default function GamePlan({ verdict, oriState = {} }) {
  if (!verdict) return null;

  if (verdict.insufficient) {
    return (
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <Header />
        <p className="text-xs text-gray-500 mt-2">{verdict.headline}</p>
      </section>
    );
  }

  const h = verdict.horizon;
  const ht = TONE[h.tone];
  const a = verdict.action;
  const at = TONE[a.tone];
  const conv = verdict.conviction;
  const ct = TONE[convictionTone(conv)];
  const ori = verdict.ori || null;

  return (
    <section className={`rounded-xl p-4 sm:p-5 border ${ht.border} ${ht.bg}`}>
      <Header confidence={verdict.confidence} />

      {/* Conviction · Horizon · Action */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
        <div className={`rounded-xl border ${ct.border} bg-gray-950/50 px-5 py-3 flex flex-col items-center justify-center text-center shrink-0`}>
          <div className={`text-4xl font-black leading-none ${ct.text}`}>{conv ?? "—"}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mt-1">conviction</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
          <div className={`rounded-lg border ${ht.border} bg-gray-950/40 px-3.5 py-2.5 min-w-0`}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Hold for</div>
            <div className={`text-2xl font-black leading-tight ${ht.text}`}>{h.label}</div>
            <div className="text-[11px] text-gray-400">
              {h.sub}
              {verdict.horizonAdjusted && <span className="ml-1 text-violet-300/90">· ✦ Ori-adjusted</span>}
            </div>
          </div>
          <div className={`rounded-lg border ${at.border} bg-gray-950/40 px-3.5 py-2.5 min-w-0`}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Right now</div>
            <div className={`text-base font-extrabold leading-tight break-words ${at.text}`}>
              {a.label}
              {a.oriAdjusted && <span className="ml-1 text-[10px] font-semibold text-violet-300/90 align-middle">✦</span>}
            </div>
            {a.line && <div className="text-[11px] text-gray-400 mt-0.5 break-words">{a.line}</div>}
          </div>
        </div>
      </div>

      {/* Pillars (Orizin + Fit folded in here) */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-x-4 gap-y-3">
        {verdict.pillars.map((p) => (
          <Pillar key={p.id} p={p} oriState={oriState} />
        ))}
      </div>

      {/* Narrative-driven caution */}
      {verdict.narrativeDriven && (
        <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
          ⚠ This conviction is driven by the <strong>story</strong> (intangibles / future potential), not current fundamentals — higher risk. If you buy, size it small.
        </div>
      )}

      {/* Plain-English headline */}
      <p className="mt-3 text-[12.5px] text-gray-200 leading-relaxed">{verdict.headline}</p>

      {/* Ori's Take */}
      <OriTake ori={ori} oriState={oriState} />

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-gray-800/70 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> strong</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> mixed / watch</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> weak / caution</span>
        </div>
        <span className="text-[10px] text-gray-600 italic">{verdict.disclaimer}</span>
      </div>
    </section>
  );
}

function OriTake({ ori, oriState }) {
  const { loading, locked, error } = oriState || {};
  const riskCls = ori?.riskLevel ? RISK[ori.riskLevel] || RISK.high : null;

  return (
    <div className="mt-4 rounded-lg border border-violet-900/50 bg-violet-950/20 p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-[11px] uppercase tracking-wider font-bold text-violet-300/90 flex items-center gap-1.5">
          <span>✦</span> Ori's Take
        </h4>
        {ori?.riskLevel && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${riskCls.bg} ${riskCls.text}`}>
            {ori.riskLevel} risk
          </span>
        )}
      </div>

      {locked ? (
        <div className="text-[12px] text-gray-300">
          <p className="mb-1.5">🔒 Ori's intelligence layer — the <strong>intangibles &amp; future-potential</strong> read (the Tesla/SpaceX factor a spreadsheet misses), plus bull/bear cases and macro trends — is a <strong>Pro</strong> feature.</p>
          <p className="text-[11px] text-violet-300/80">Upgrade for $10/month to unlock Ori on every Game Plan.</p>
        </div>
      ) : loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-2.5 bg-violet-900/40 rounded w-5/6" />
          <div className="h-2.5 bg-violet-900/30 rounded w-2/3" />
          <div className="h-2.5 bg-violet-900/30 rounded w-3/4" />
          <div className="text-[10px] text-violet-300/70 not-italic pt-1">Ori is weighing the intangibles…</div>
        </div>
      ) : ori ? (
        <div className="space-y-3 text-[12px] text-gray-300 leading-relaxed">
          {ori.bottomLine && <p className="text-gray-100 font-medium">{ori.bottomLine}</p>}

          {ori.futurePotential && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Future potential</div>
              <p>{ori.futurePotential}</p>
            </div>
          )}

          {Array.isArray(ori.xFactors) && ori.xFactors.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1.5">
                X-Factors
                <InfoHint text="The specific edges behind the intangibles score — durable moat / market dominance, total addressable market, management, brand, and regulatory positioning. More filled dots = stronger. These build the single Intangibles pillar; they aren't a separate conviction input." />
              </div>
              <div>
                {ori.xFactors.map((x, i) => (
                  <XFactor key={i} x={x} />
                ))}
              </div>
            </div>
          )}

          {Array.isArray(ori.keyFactors) && ori.keyFactors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ori.keyFactors.map((f, i) => (
                <span key={i} className="text-[10.5px] px-2 py-0.5 rounded-full bg-violet-900/30 text-violet-200 border border-violet-800/40">{f}</span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ori.bullCase && (
              <div className="rounded-md border border-emerald-900/40 bg-emerald-950/20 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400/90 font-bold mb-0.5">Bull case</div>
                <p className="text-[11.5px]">{ori.bullCase}</p>
              </div>
            )}
            {ori.bearCase && (
              <div className="rounded-md border border-red-900/40 bg-red-950/20 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-red-400/90 font-bold mb-0.5">Bear case</div>
                <p className="text-[11.5px]">{ori.bearCase}</p>
              </div>
            )}
          </div>

          {ori.whatWouldChangeMyMind && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">What would change the call</div>
              <p>{ori.whatWouldChangeMyMind}</p>
            </div>
          )}

          {(ori.macroTailwinds?.length > 0 || ori.macroHeadwinds?.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {ori.macroTailwinds?.length > 0 && (
                <div>
                  <span className="text-emerald-400/90 font-semibold">Tailwinds: </span>
                  <span className="text-gray-400">{ori.macroTailwinds.join(" · ")}</span>
                </div>
              )}
              {ori.macroHeadwinds?.length > 0 && (
                <div>
                  <span className="text-red-400/90 font-semibold">Headwinds: </span>
                  <span className="text-gray-400">{ori.macroHeadwinds.join(" · ")}</span>
                </div>
              )}
            </div>
          )}

          {/* Which Gemini model produced this review (frontier on Deep Research, */}
          {/* or value/lite if the frontier model was busy). */}
          {ori.model && (
            <div className="text-[9px] text-gray-600 pt-1" title={`Generated by ${ori.model}`}>
              ⚙ {ori.modelTier === "frontier" ? "Frontier" : ori.modelTier === "lite" ? "Lite" : "Value"} model · {ori.model}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11.5px] text-gray-500">
          <p>{error || "Ori couldn't weigh in right now. The data-driven Game Plan above still stands."}</p>
          {oriState?.retry && (
            <button
              onClick={oriState.retry}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-violet-900/40 text-violet-200 border border-violet-800/50 hover:bg-violet-800/50 transition-colors active:scale-95 cursor-pointer"
            >
              ↻ Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ confidence }) {
  return (
    <header className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-300">Game Plan</h3>
        <InfoHint text="One unified verdict: a conviction score (0–100) blending fundamentals (the old Orizin Score), valuation, technicals, insiders (corporate insiders + U.S. Congress buying/selling), analysts, your personal Fit, and Ori's read on intangibles / future potential — plus how long it's worth holding and what to do at today's price. Educational only — not financial advice." />
      </div>
      <div className="flex items-center gap-2">
        {confidence && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${confidence === "high" ? "border-emerald-800/60 text-emerald-300/90 bg-emerald-950/40" : confidence === "medium" ? "border-amber-800/60 text-amber-300/90 bg-amber-950/40" : "border-gray-700 text-gray-500 bg-gray-800/60"}`}>
            {confidence} confidence
          </span>
        )}
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-950/50 text-violet-300/80 border border-violet-900/50">✦ Ori · Pro</span>
      </div>
    </header>
  );
}
