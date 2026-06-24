// Investor-persona personalization for Conviction.
//
// The 7 "categories" here ARE the 7 conviction pillars (see verdict.js
// PILLAR_WEIGHTS): a persona picks BASE weights, then risk / horizon / goal apply
// point modifiers on top, and the result renormalizes to fractions that feed the
// conviction blend. This module is pure + framework-free so it's trivially
// testable and shared by the screener (quickConviction) and Deep Research
// (computeVerdict). It deliberately does NOT import verdict.js (which holds the
// fallback PILLAR_WEIGHTS) so there's no import cycle — the resolved weights flow
// IN as a parameter from useScreener / App.

// Category keys — identical to verdict.js PILLAR_WEIGHTS keys.
export const CATEGORIES = ["fundamentals", "valuation", "technicals", "smartMoney", "analyst", "fit", "intangibles"];

// UI labels (match the pillar labels surfaced in the Game Plan).
export const CATEGORY_LABELS = {
  fundamentals: "Fundamentals",
  valuation: "Valuation",
  technicals: "Technicals",
  smartMoney: "Insiders",
  analyst: "Analyst",
  fit: "Portfolio Fit",
  intangibles: "Intangibles",
};

// Tooltip descriptions for the category weight breakdown.
export const CATEGORY_TOOLTIPS = {
  fundamentals: "Fundamentals — profitability, growth & balance-sheet health on absolute thresholds",
  valuation: "How cheap or expensive the stock is vs peers and intrinsic value",
  technicals: "Trend strength, RSI, and momentum signals",
  smartMoney: "U.S. Congress + corporate insider net buying vs selling activity",
  analyst: "Wall Street consensus rating and price target upside",
  fit: "How well the stock matches your portfolio goals and risk tolerance",
  intangibles: "Ori's AI judgment: moat strength, future importance, ecosystem depth — the edge spreadsheets can't capture",
};

// Base persona weights — percent points, each set sums to 100 across CATEGORIES.
// Ordered conservative → aggressive (the order the Lens dropdown shows them in):
// value/deep-value (margin-of-safety) → quality compounders → balanced → momentum
// → disruptor (most speculative, story-led).
export const PERSONAS = {
  value:           { label: "Value Investor", emoji: "🪙", blurb: "Cheap, sound businesses; price discipline over story.", weights: { fundamentals: 30, valuation: 30, technicals: 5, smartMoney: 5, analyst: 5, fit: 10, intangibles: 15 } },
  deep_value:      { label: "Deep Value", emoji: "🧱", blurb: "Hard valuation focus; deeply cheap over everything else.", weights: { fundamentals: 20, valuation: 45, technicals: 5, smartMoney: 5, analyst: 5, fit: 5, intangibles: 15 } },
  compounder:      { label: "Compounder", emoji: "♻️", blurb: "Durable, high-quality compounders held for years.", weights: { fundamentals: 35, valuation: 15, technicals: 5, smartMoney: 5, analyst: 5, fit: 10, intangibles: 25 } },
  garp:            { label: "GARP", emoji: "⚖️", blurb: "Growth at a reasonable price — quality and valuation in balance.", weights: { fundamentals: 30, valuation: 20, technicals: 5, smartMoney: 5, analyst: 5, fit: 10, intangibles: 25 } },
  balanced_growth: { label: "Balanced Growth", emoji: "🌱", blurb: "Quality growth with a strong intangibles lean — the all-rounder default.", weights: { fundamentals: 25, valuation: 10, technicals: 5, smartMoney: 7, analyst: 5, fit: 15, intangibles: 33 } },
  momentum:        { label: "Momentum", emoji: "📈", blurb: "Trend and relative strength drive the call.", weights: { fundamentals: 15, valuation: 5, technicals: 40, smartMoney: 10, analyst: 10, fit: 5, intangibles: 15 } },
  disruptor:       { label: "Disruptor", emoji: "🚀", blurb: "ARK-style: story, TAM and optionality lead; the numbers come second.", weights: { fundamentals: 20, valuation: 5, technicals: 3, smartMoney: 5, analyst: 2, fit: 15, intangibles: 50 } },
};
export const PERSONA_KEYS = Object.keys(PERSONAS);
export const DEFAULT_PERSONA = "balanced_growth";

// Risk tolerance — point modifiers (mirrors verdict.js RISK_LEVELS).
export const RISKS = ["conservative", "balanced", "aggressive"];
export const DEFAULT_RISK = "balanced";
export const RISK_LABELS = { conservative: "Conservative", balanced: "Balanced", aggressive: "Aggressive" };
export const RISK_MODIFIERS = {
  conservative: { fundamentals: 5, valuation: 5, technicals: -2, smartMoney: -3, intangibles: -5 },
  balanced: {},
  aggressive: { fundamentals: -5, valuation: -5, intangibles: 10 },
};

// Investment horizon — point modifiers.
export const HORIZONS = ["short", "medium", "long"];
export const DEFAULT_HORIZON = "medium";
export const HORIZON_LABELS = { short: "Short-term (<1 yr)", medium: "Medium (1–5 yrs)", long: "Long-term (5–10+ yrs)" };
export const HORIZON_MODIFIERS = {
  short: { technicals: 10, analyst: 5, intangibles: -10, fundamentals: -5 },
  medium: {},
  long: { intangibles: 10, fundamentals: 5, technicals: -10, analyst: -5 },
};

// Portfolio goal — point modifiers. "grow" is the neutral default (Balanced
// Growth is already intangibles/fundamentals-led, which IS the Grow-Wealth tilt),
// so the default selection resolves to the spec's Balanced-Growth weights exactly.
export const GOALS = ["preserve", "grow", "maximize", "income"];
export const DEFAULT_GOAL = "grow";
export const GOAL_LABELS = { preserve: "Preserve Wealth", grow: "Grow Wealth", maximize: "Maximize Upside", income: "Generate Income" };
export const GOAL_MODIFIERS = {
  preserve: { fundamentals: 6, valuation: 6, technicals: -2, analyst: -2, intangibles: -8 },
  grow: {},
  maximize: { fundamentals: -4, valuation: -8, intangibles: 12 },
  income: { fundamentals: 6, valuation: 6, technicals: -4, intangibles: -8 },
};

export const sanitizePersona = (p) => (Object.prototype.hasOwnProperty.call(PERSONAS, p) ? p : DEFAULT_PERSONA);
export const sanitizeHorizon = (h) => (HORIZONS.includes(h) ? h : DEFAULT_HORIZON);
export const sanitizeGoal = (g) => (GOALS.includes(g) ? g : DEFAULT_GOAL);
export const sanitizeRiskValue = (r) => (RISKS.includes(r) ? r : DEFAULT_RISK);

function addDeltas(base, deltas) {
  if (!deltas) return base;
  const out = { ...base };
  for (const k of CATEGORIES) if (deltas[k]) out[k] = (out[k] || 0) + deltas[k];
  return out;
}

/**
 * Resolve the 7-category conviction weights for a persona + modifiers.
 * Spec order: persona base → risk → horizon → goal → clamp ≥0 → renormalize.
 * @param {{persona?:string, risk?:string, horizon?:string, goal?:string}} sel
 * @returns {{fundamentals:number,valuation:number,technicals:number,smartMoney:number,analyst:number,fit:number,intangibles:number}} fractions summing to ~1
 */
export function resolvePillarWeights(sel = {}) {
  let w = { ...PERSONAS[sanitizePersona(sel.persona)].weights };
  w = addDeltas(w, RISK_MODIFIERS[sanitizeRiskValue(sel.risk)]);
  w = addDeltas(w, HORIZON_MODIFIERS[sanitizeHorizon(sel.horizon)]);
  w = addDeltas(w, GOAL_MODIFIERS[sanitizeGoal(sel.goal)]);
  let total = 0;
  for (const k of CATEGORIES) { w[k] = Math.max(0, w[k] || 0); total += w[k]; }
  const out = {};
  if (total <= 0) { // degenerate (everything zeroed) → equal split
    for (const k of CATEGORIES) out[k] = 1 / CATEGORIES.length;
    return out;
  }
  for (const k of CATEGORIES) out[k] = w[k] / total;
  return out;
}

/** Resolved weights as integer percentages summing to exactly 100 (UI breakdown). */
export function resolvePillarPercents(sel) {
  const w = resolvePillarWeights(sel);
  // Largest-remainder rounding so the displayed percents total exactly 100.
  const rows = CATEGORIES.map((k) => { const v = w[k] * 100; return { k, f: Math.floor(v), r: v - Math.floor(v) }; });
  const out = {};
  let used = 0;
  for (const x of rows) { out[x.k] = x.f; used += x.f; }
  rows.sort((a, b) => b.r - a.r);
  for (let i = 0; used < 100 && i < rows.length; i++, used++) out[rows[i].k]++;
  return out;
}

// ── Deterministic Ori-free outputs (persona changes the lens, not the scores) ──

function pillarPct(verdict, id) {
  const p = verdict?.pillars?.find((x) => x.id === id);
  return p && p.score != null ? Math.round(p.score * 100) : null;
}

/** Highest / lowest scoring categories (persona-invariant — scores don't move with persona). */
export function topStrengthsRisks(verdict, n = 3) {
  const scored = (verdict?.pillars || [])
    .filter((p) => p.score != null)
    .map((p) => ({ id: p.id, label: CATEGORY_LABELS[p.id] || p.label, pct: Math.round(p.score * 100) }));
  const byScore = [...scored].sort((a, b) => b.pct - a.pct);
  return {
    strengths: byScore.filter((x) => x.pct >= 55).slice(0, n),
    risks: [...byScore].reverse().filter((x) => x.pct <= 45).slice(0, n),
  };
}

/**
 * Deterministic "why it fits your persona" read: weigh how the stock scores on the
 * categories THIS persona emphasizes most. The category scores are persona-
 * invariant; only the emphasis (weights) changes.
 */
export function explainPersonaFit(verdict, sel = {}) {
  if (!verdict || verdict.insufficient || !Array.isArray(verdict.pillars)) return null;
  const persona = sanitizePersona(sel.persona);
  const w = resolvePillarWeights(sel);
  const top = CATEGORIES.slice().sort((a, b) => w[b] - w[a]).slice(0, 3);
  const parts = top
    .map((id) => ({ label: CATEGORY_LABELS[id], pct: pillarPct(verdict, id), wpct: Math.round(w[id] * 100) }))
    .filter((x) => x.pct != null);
  if (!parts.length) return null;
  const wsum = parts.reduce((s, x) => s + x.wpct, 0) || 1;
  const fitScore = Math.round(parts.reduce((s, x) => s + x.pct * x.wpct, 0) / wsum);
  const word = fitScore >= 62 ? "fits this persona well" : fitScore >= 45 ? "is a mixed fit for this persona" : "is a weak fit for this persona";
  return {
    fitScore,
    verdict: word,
    label: PERSONAS[persona].label,
    text: `As a ${PERSONAS[persona].label} investor you lean hardest on ${parts.map((x) => x.label).join(", ")}. This stock scores ${parts.map((x) => `${x.label} ${x.pct}`).join(", ")} there — so it ${word}.`,
  };
}
