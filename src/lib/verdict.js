// ── Beginner Verdict ("Game Plan") ───────────────────────────────────────────
// Turns the pile of numbers on the Deep Research page into one plain-English
// answer to "what do I actually do with this?" — split into two honest axes:
//
//   1. HORIZON  — how long is this business worth owning? (trade / 1yr / 3yr /
//      5yr / 10yr+). Driven by DURABILITY: profitability, balance-sheet safety,
//      earnings consistency, size/stability, and growth. A great business earns
//      a long horizon regardless of today's price.
//   2. ACTION   — what to do at TODAY'S price? (Accumulate / Buy / Hold / Wait
//      for a pullback / Trim / Avoid). Driven by VALUATION (DCF margin of
//      safety, analyst upside, P/E-vs-growth, FCF yield) and TIMING (50/200
//      trend, RSI).
//
// Everything is computed from ABSOLUTE thresholds (not percentile rank within
// the current filter) so the verdict means the same thing every time a beginner
// looks at it. This is educational guidance, NOT financial advice — the UI says
// so, and Ori is told to frame it that way too.
//
// All thresholds live here so they're easy to tune, and the module is pure
// (no React / no fetch) so it can be unit-tested directly.

const isNum = (v) => v != null && Number.isFinite(v);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pct = (v) => (isNum(v) ? `${(v * 100).toFixed(0)}%` : "—");

// A persisted ~45-day price RETURN → 0..1 momentum proxy (down ~25% → 0, flat →
// 0.5, up ~25% → 1). Lets the SCREENER carry a technicals signal (so falling
// "value traps" don't rank like winners) without per-symbol indicator fetches;
// the full Deep Research technicals pillar (SMA50/200 trend + RSI) overrides it.
const momFromReturn = (m) => (isNum(m) ? clamp01(0.5 + m * 2) : null);

// Deterministic Intangibles baseline (0..1) for the screener / pre-Ori
// conviction, so that pillar isn't simply absent until Ori runs:
//   1. a STILL-FRESH cached Ori review (row.ori, attached server-side) if one
//      exists — free reuse, no new LLM call; else
//   2. the cheap durabilityProxy estimate.
// This closes most of the screener↔Ori conviction gap without Gemini cost.
const intangiblesBaseline = (row) =>
  isNum(row?.ori?.intangiblesScore)
    ? clamp01(row.ori.intangiblesScore / 100)
    : isNum(row?.durabilityProxy)
      ? clamp01(row.durabilityProxy / 100)
      : null;
// Cached Ori conviction nudge (clamped ±20); 0 when there's no cached review.
const oriDelta = (row) => (isNum(row?.ori?.convictionDelta) ? Math.max(-20, Math.min(20, row.ori.convictionDelta)) : 0);

// Analyst target-upside sub-signal (0..1) from consensus target vs price. Reads
// the target from detail (Deep Research) OR the bulk row (screener — joined from
// ai_enrichment), so both views compute the same number. Shared by the analyst
// pillar and the lean screener conviction.
function targetUpside(r, aiData, price) {
  const target = isNum(aiData?.target_consensus)
    ? aiData.target_consensus
    : isNum(r?.target_consensus)
      ? r.target_consensus
      : isNum(r?.targetConsensus)
        ? r.targetConsensus
        : null;
  return isNum(target) && isNum(price) && price > 0 ? clamp01(((target - price) / price) * 1.5 + 0.4) : null;
}

// Trend / momentum (0..1) + the trend regime. Uses the SMA50-vs-SMA200 cross —
// from live detail on Deep Research OR the persisted bulk SMAs on the screener —
// so BOTH views see the same trend (a 45-day bounce inside a long downtrend reads
// bearish either place). Falls back to the persisted ~45-day return only when no
// SMAs exist. Shared by computeVerdict and the lean screener conviction.
function momentumSignal(tech, r) {
  const sma50 = isNum(tech?.sma50) ? tech.sma50 : isNum(r?.sma50) ? r.sma50 : null;
  const sma200 = isNum(tech?.sma200) ? tech.sma200 : isNum(r?.sma200) ? r.sma200 : null;
  const price = isNum(r?.price) ? r.price : null;
  const rsi = tech ? (isNum(tech.rsi) ? tech.rsi : isNum(tech.rsi14) ? tech.rsi14 : null) : isNum(r?.latestRsi) ? r.latestRsi : null;
  const adx = isNum(tech?.adx) ? tech.adx : null;
  let trend = "unknown";
  if (isNum(sma50) && isNum(sma200)) trend = sma50 >= sma200 ? "up" : "down";
  else if (isNum(price) && isNum(sma200)) trend = price >= sma200 ? "up" : "down";
  const overbought = isNum(rsi) && rsi >= 70;
  const oversold = isNum(rsi) && rsi <= 30;
  const strongTrend = isNum(adx) && adx >= 25;
  let score;
  if (trend !== "unknown") {
    let m = trend === "up" ? 0.68 : 0.32;
    if (overbought) m -= 0.18;
    if (oversold) m += 0.18;
    score = clamp01(m);
  } else {
    score = momFromReturn(r?.mom); // last resort: short-window return
  }
  return { score, trend, overbought, oversold, strongTrend, rsi };
}

// Ramp helpers: map a raw value onto 0..1 between a low and high anchor.
function up(v, lo, hi) {
  if (!isNum(v)) return null;
  if (hi === lo) return v >= hi ? 1 : 0;
  return clamp01((v - lo) / (hi - lo));
}
const down = (v, lo, hi) => {
  const u = up(v, lo, hi);
  return u == null ? null : 1 - u;
};

// Average a list of 0..1 sub-scores, ignoring the missing ones.
function avgDefined(arr) {
  const xs = arr.filter((x) => x != null && Number.isFinite(x));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
// Weighted average of [value, weight] pairs, ignoring missing values and
// renormalizing the weights that remain.
function weightedAvg(pairs) {
  let s = 0;
  let w = 0;
  for (const [v, wt] of pairs) {
    if (v != null && Number.isFinite(v)) {
      s += v * wt;
      w += wt;
    }
  }
  return w > 0 ? s / w : null;
}

// 0..1 → tone bucket for gauges/badges.
const toneOf = (v) => (v == null ? "neutral" : v >= 0.6 ? "good" : v >= 0.4 ? "ok" : "bad");

// One pillar of the unified Game Plan. `ori:true` marks the Intangibles slot,
// which carries no weight in the deterministic conviction (Ori fills it later).
function pillar(id, label, score, weight, toneOverride, ori = false) {
  return { id, label, score: score ?? null, weight, tone: toneOverride || (score == null ? "neutral" : toneOf(score)), ori };
}
// Conviction 0..100 = weighted average over the pillars that have REAL data,
// renormalizing the remaining weights. A pillar with no data (null score) is
// EXCLUDED, not imputed — so a missing signal never drags the number toward the
// middle. The screener (Fundamentals + Valuation known) therefore reflects those
// two honestly and can reach the full range; opening Deep Research starts at the
// same number and then refines as technicals, insiders, analysts, fit and Ori's
// intangibles load. (Earlier we imputed unknowns at 0.5, which compressed the
// screener to a ~68 ceiling — reverted per user.)
function convictionFromPillars(pillars) {
  const s = weightedAvg(pillars.map((p) => [p.score, p.weight]));
  return s == null ? null : Math.round(100 * s);
}
// Smart-money conviction signal (U.S. Congress + corporate insiders) → 0..1.
// Built from the actual buyer/seller HEAD COUNTS so genuine net buying scores
// high even when a little selling on the other channel exists — the old coarse
// "buying/selling/mixed" bucket flattened "8 insiders bought, 0 sold, 1 senator
// trimmed" all the way to 0.5 (mixed) or worse. All-buy → ~0.85, balanced → 0.5,
// all-sell → ~0.15. Falls back to the coarse signal when counts aren't present,
// and stays null ("quiet"/no data) so it's excluded from the blend, not imputed.
function smartMoneyScore(sm) {
  if (!sm) return null;
  const c = sm.congress || {};
  const ins = sm.insider || {};
  const buyers = (Number(c.buyers) || 0) + (Number(ins.buyers) || 0);
  const sellers = (Number(c.sellers) || 0) + (Number(ins.sellers) || 0);
  const total = buyers + sellers;
  if (total > 0) return clamp01(0.15 + 0.7 * (buyers / total));
  if (sm.signal === "buying") return 0.8;
  if (sm.signal === "selling") return 0.2;
  if (sm.signal === "mixed") return 0.5;
  return null;
}

// Classify an analyst rating string → "bull" | "bear" | "hold" | null. Order
// matters: bullish/bearish patterns are tested before the generic "perform"
// that "outperform"/"underperform" also contain.
function classifyGrade(g) {
  const s = String(g || "").toLowerCase();
  if (!s) return null;
  if (/strong buy|\bbuy\b|outperform|overweight|accumulate|\badd\b|positive|conviction|top pick/.test(s)) return "bull";
  if (/strong sell|\bsell\b|underperform|underweight|reduce|negative/.test(s)) return "bear";
  if (/hold|neutral|market perform|sector perform|equal[- ]?weight|in[- ]?line|peer perform|perform/.test(s)) return "hold";
  return null;
}

// Standing analyst consensus from the recent grade ratings (Buy/Hold/Sell) → 0..1.
// Unlike grade FLOW (upgrades vs downgrades), this counts the rating itself, so a
// stock every analyst rates "Buy" reads bullish even when the latest actions were
// reiterations/maintains (the common case — which the old flow-only logic scored
// as "no signal"). Holds pull toward the middle. null when nothing is classifiable.
function gradeConsensus(grades) {
  if (!Array.isArray(grades) || !grades.length) return null;
  let bull = 0, bear = 0, hold = 0;
  for (const g of grades.slice(0, 20)) {
    const c = classifyGrade(g.new_grade || g.previous_grade);
    if (c === "bull") bull++;
    else if (c === "bear") bear++;
    else if (c === "hold") hold++;
  }
  const n = bull + bear + hold;
  return n ? clamp01(0.5 + (bull - bear) / (2 * n)) : null;
}

// Expert-analyst signal → 0..1, blending three sub-signals (each optional):
//   • implied upside to the consensus price target (works on the screener too),
//   • the standing Buy/Hold/Sell consensus across recent grades, and
//   • recent up/down grade FLOW (revision momentum).
// The grade halves only add in once per-symbol detail is loaded on Deep Research.
function analystScore(r, detail, aiData, price) {
  const upside = targetUpside(r, aiData, price);
  const grades = detail?.grades;
  const consensus = gradeConsensus(grades);
  let flow = null;
  if (Array.isArray(grades) && grades.length) {
    let u = 0;
    let d = 0;
    for (const g of grades.slice(0, 12)) {
      const a = (g.action || "").toLowerCase();
      if (a.includes("up")) u++;
      else if (a.includes("down")) d++;
    }
    if (u + d > 0) flow = clamp01(0.5 + (u - d) / (2 * (u + d)));
  }
  return avgDefined([upside, consensus, flow]);
}

// Recent reported quarters (epsActual present), newest first, from either the
// raw FMP array or the {recent:[...]} shape used in Ori's context.
function recentEarnings(earnings) {
  let arr = null;
  if (Array.isArray(earnings)) arr = earnings;
  else if (earnings && Array.isArray(earnings.recent)) arr = earnings.recent;
  if (!arr) return [];
  return arr
    .filter((e) => e && e.epsActual != null)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 6);
}

// Valuation pillar (0..1, higher = cheaper / more attractive) from DCF margin of
// safety, analyst upside, PEG-ish P/E, FCF yield, EV/EBITDA, and the Value
// percentile. Shared by computeVerdict and the lean screener conviction so they
// can't drift.
function valuationScore(r, aiData) {
  const price = isNum(r.price) ? r.price : null;
  const dcf = isNum(aiData?.dcf) ? aiData.dcf : isNum(r.dcf) ? r.dcf : null;
  const target = isNum(aiData?.target_consensus) ? aiData.target_consensus : isNum(r.target_consensus) ? r.target_consensus : isNum(r.targetConsensus) ? r.targetConsensus : null;
  const mos = isNum(dcf) && isNum(price) && dcf > 0 && price > 0 ? (dcf - price) / dcf : null;
  const upsideAnalyst = isNum(target) && isNum(price) && price > 0 ? (target - price) / price : null;
  let peTerm = null;
  if (r.pe != null) {
    if (r.pe <= 0) peTerm = 0.12;
    else if (r.eps_growth != null && r.eps_growth > 0.03) peTerm = down(r.pe / (r.eps_growth * 100), 1.0, 3.5);
    else peTerm = down(r.pe, 12, 40);
  }
  const score = avgDefined([
    mos != null ? clamp01(mos + 0.5) : null,
    upsideAnalyst != null ? clamp01(upsideAnalyst * 1.5 + 0.4) : null,
    up(r.fcf_yield, 0.0, 0.08),
    peTerm,
    r.ev_ebitda != null ? (r.ev_ebitda < 0 ? 0.2 : down(r.ev_ebitda, 8, 25)) : null,
    isNum(r.vScore) ? r.vScore : null,
  ]);
  return { score, mos, upsideAnalyst, dcf, target };
}

// Weights for the unified conviction blend. Intangibles only counts once Ori
// fills it in (see mergeOriIntoVerdict).
const PILLAR_WEIGHTS = { fundamentals: 0.3, valuation: 0.18, technicals: 0.12, smartMoney: 0.1, analyst: 0.12, fit: 0.18, intangibles: 0.14 };

// ── Risk tolerance ───────────────────────────────────────────────────────────
// Raw conviction is blind to how SPECULATIVE a name is, so cheap, high-rank
// microcaps float to the top. speculationScore measures that (small size, high
// beta, unprofitable, distressed balance sheet, thin data); riskDelta then tilts
// conviction by the user's risk tolerance — a retiree (conservative) pushes
// speculative names DOWN hard, a young/aggressive investor barely penalizes them.
export const RISK_LEVELS = ["conservative", "balanced", "aggressive"];
export const DEFAULT_RISK = "balanced";

function speculationScore(r) {
  const hasMargin = r.net_margin != null || r.op_margin != null;
  // Size and volatility dominate — they're what makes a name unsuitable for a
  // conservative (e.g. retiree) investor regardless of how good the numbers look.
  return weightedAvg([
    [isNum(r.mcap) ? 1 - up(r.mcap, 3e8, 3e9) : null, 0.35], // <$300M → 1, $3B+ → 0
    [isNum(r.beta) ? up(Math.abs(r.beta), 1.0, 2.2) : null, 0.25], // high beta → 1
    [(r.net_margin != null && r.net_margin < 0) || (r.op_margin != null && r.op_margin < 0) ? 1 : hasMargin ? 0 : null, 0.15],
    [isNum(r.debt_equity) ? (r.debt_equity < 0 ? 1 : up(r.debt_equity, 1.0, 3.0)) : null, 0.1],
    [isNum(r.net_debt_ebitda) ? up(r.net_debt_ebitda, 3, 7) : null, 0.05],
    [isNum(r.dataCoverage) ? 1 - r.dataCoverage : null, 0.15],
  ]);
}

// Conviction points to add for the user's risk tolerance. Computed from the SAME
// row fields on the screener and on Deep Research, so the two stay consistent.
function riskDelta(r, risk) {
  const spec = speculationScore(r);
  const s = spec == null ? 0.4 : spec;
  if (risk === "conservative") return -Math.round(s * 42); // retiree: speculative names sink hard
  if (risk === "aggressive") return -Math.round(s * 5); // risk-taker: barely penalized
  return -Math.round(s * 16); // balanced — a mild built-in guard
}
const applyRisk = (conviction, delta) => (conviction == null ? conviction : Math.max(0, Math.min(100, conviction + delta)));

/**
 * Lean conviction 0..100 for the screener (10k rows, no per-symbol detail / no
 * Ori). Uses only the pillars derivable from a scored row — Fundamentals (the
 * Orizin Score) + Valuation, plus Fit when a context is supplied — and lets the
 * weights renormalize. Equals computeVerdict().conviction for a row with no
 * detail loaded, so the number stays consistent as it refines on Deep Research.
 */
export function quickConviction(row, fit = null, risk = DEFAULT_RISK) {
  if (!row) return null;
  const fund = isNum(row.score) ? row.score : null;
  const price = isNum(row.price) ? row.price : null;
  const val = valuationScore(row, null).score;
  if (fund == null && val == null) return null; // nothing real to anchor on
  const analyst = targetUpside(row, null, price); // consensus-target upside (no grades on the screener)
  const tech = momentumSignal(null, row).score; // SMA50/200 trend (bulk), or ~45-day return fallback
  const fitS = fit && !fit.needsContext && isNum(fit.score) ? clamp01(fit.score / 100) : null;
  // Same pillars & renormalization as computeVerdict with no detail loaded, so
  // this EQUALS the Deep Research conviction on open and only refines (doesn't
  // jump) as live technicals / grades / insiders arrive. Intangibles uses a
  // deterministic baseline (cached Ori review, else durabilityProxy) + any cached
  // Ori delta, so good-but-quiet names aren't stuck low until Deep Research.
  const base = convictionFromPillars([
    { score: fund, weight: PILLAR_WEIGHTS.fundamentals },
    { score: val, weight: PILLAR_WEIGHTS.valuation },
    { score: tech, weight: PILLAR_WEIGHTS.technicals },
    { score: analyst, weight: PILLAR_WEIGHTS.analyst },
    { score: fitS, weight: PILLAR_WEIGHTS.fit },
    { score: intangiblesBaseline(row), weight: PILLAR_WEIGHTS.intangibles },
  ]);
  return applyRisk(applyRisk(base, riskDelta(row, risk)), oriDelta(row));
}

const HORIZON = {
  trade: { key: "trade", label: "Trade only", sub: "speculative — days to weeks", years: "days–weeks", holdText: "a quick trade, not an investment", tone: "bad" },
  oneYr: { key: "oneYr", label: "~1 year", sub: "short-term holding", years: "~1 yr", holdText: "about a year", tone: "ok" },
  threeYr: { key: "threeYr", label: "3 years", sub: "medium-term holding", years: "~3 yr", holdText: "about 3 years", tone: "ok" },
  fiveYr: { key: "fiveYr", label: "5 years", sub: "long-term holding", years: "~5 yr", holdText: "about 5 years", tone: "good" },
  tenYr: { key: "tenYr", label: "10+ years", sub: "buy & hold compounder", years: "10+ yr", holdText: "10+ years (buy & hold)", tone: "good" },
};

/**
 * Compute the beginner verdict for a stock.
 * @param {object} row     scored screener row (fundamentals + Orizin score)
 * @param {object} detail  { technicals, earnings, smartMoney, aiData }
 */
export function computeVerdict(row, detail = {}, fit = null, opts = {}) {
  const r = row || {};
  const risk = opts.risk || DEFAULT_RISK;
  const tech = detail.technicals || null;
  const aiData = detail.aiData || null;
  const price = isNum(r.price) ? r.price : null;

  // ── Sub-scores (each 0..1, absolute) ──────────────────────────────────────
  const profit = avgDefined([
    up(r.roic, 0.05, 0.2),
    up(r.roe, 0.08, 0.22),
    up(r.net_margin, 0.0, 0.18),
    up(r.op_margin, 0.03, 0.22),
    up(r.fcf_margin, 0.0, 0.15),
  ]);

  const safety = avgDefined([
    r.debt_equity != null ? (r.debt_equity < 0 ? 0 : down(r.debt_equity, 0.5, 2.5)) : null,
    down(r.net_debt_ebitda, 1.0, 4.5), // negative (net cash) ramps to 1 = good
    up(r.current_ratio, 1.0, 2.0),
  ]);

  const growth = avgDefined([
    up(r.revenue_growth, 0.0, 0.2),
    up(r.eps_growth, 0.0, 0.2),
    up(r.fcf_growth, 0.0, 0.2),
  ]);
  const declining =
    (r.revenue_growth != null && r.revenue_growth < -0.02) ||
    (r.eps_growth != null && r.eps_growth < -0.05);

  const quarters = recentEarnings(detail.earnings);
  let beatRate = null;
  {
    const judged = quarters.filter((e) => e.epsEstimated != null);
    if (judged.length >= 2) beatRate = judged.filter((e) => e.epsActual >= e.epsEstimated).length / judged.length;
  }

  const sizeScore = up(r.mcap, 3e8, 5e10); // $300M..$50B → micro..large
  const betaScore = r.beta != null ? down(Math.abs(r.beta), 1.0, 2.2) : null;

  // ── Durability (drives the HORIZON). Growth is folded in only mildly so a
  // steady, low-growth compounder (e.g. a consumer staple) still rates as a
  // long-term hold. ──────────────────────────────────────────────────────────
  const durability = weightedAvg([
    [profit, 0.34],
    [safety, 0.26],
    [beatRate, 0.1],
    [sizeScore, 0.12],
    [betaScore, 0.08],
    [growth != null ? clamp01(growth * 0.6 + 0.4) : null, 0.1],
  ]);

  // Hard guardrails — these cap the horizon no matter how the averages land.
  const unprofitable =
    (r.net_margin != null && r.net_margin < 0) ||
    (r.op_margin != null && r.op_margin < 0) ||
    (r.pe != null && r.pe < 0 && (r.net_margin == null || r.net_margin <= 0));
  const burningCash = r.fcf_margin != null && r.fcf_margin < -0.02;
  const distress =
    (r.debt_equity != null && r.debt_equity < 0) ||
    (r.net_debt_ebitda != null && r.net_debt_ebitda > 6 && (r.op_margin == null || r.op_margin < 0.05));
  const speculative = (r.mcap != null && r.mcap < 3e8) || (r.beta != null && Math.abs(r.beta) > 2.0);

  // Not enough to say anything useful.
  const hasFundamentals = profit != null || safety != null || growth != null || isNum(r.score);
  if (!hasFundamentals) {
    return {
      insufficient: true,
      headline: "Not enough data yet to form a verdict. Use Re-gather to pull this symbol's fundamentals.",
      disclaimer: DISCLAIMER,
    };
  }

  const dur = durability ?? 0.4;

  // ── HORIZON bucket ─────────────────────────────────────────────────────────
  let hk;
  if (distress || (unprofitable && (burningCash || dur < 0.3))) hk = "trade";
  else if (unprofitable || dur < 0.42) hk = "oneYr";
  else if (dur < 0.6) hk = "threeYr";
  else if (dur < 0.8 || declining) hk = "fiveYr";
  else hk = "tenYr";
  if (speculative && hk === "tenYr") hk = "fiveYr";
  const horizon = HORIZON[hk];

  // ── VALUATION (drives the ACTION) ──────────────────────────────────────────
  const { score: valuation, mos, upsideAnalyst, dcf, target } = valuationScore(r, aiData);
  const valTier =
    valuation == null ? "unknown" : valuation >= 0.6 ? "cheap" : valuation >= 0.45 ? "fair" : valuation >= 0.3 ? "rich" : "expensive";

  // ── TIMING (technical trend / momentum) ────────────────────────────────────
  const { score: momentum, trend, overbought, oversold, strongTrend, rsi } = momentumSignal(tech, r);

  // ── ACTION decision ────────────────────────────────────────────────────────
  let action;
  let actionTone;
  if (hk === "trade") {
    action = trend === "up" ? "Speculative — trade only" : "Avoid";
    actionTone = "bad";
  } else if (valTier === "cheap") {
    action = trend === "down" ? (oversold ? "Buy the dip" : "Accumulate gradually") : "Accumulate";
    actionTone = "good";
  } else if (valTier === "fair") {
    if (overbought) { action = "Hold — let it cool off"; actionTone = "ok"; }
    else { action = trend === "down" ? "Start a position" : "Buy / accumulate"; actionTone = "good"; }
  } else {
    // rich / expensive / unknown
    if (dur >= 0.6) { action = overbought ? "Wait for a pullback" : "Buy on dips only"; actionTone = "ok"; }
    else { action = "Watch — avoid at this price"; actionTone = "bad"; }
  }
  if (trend === "down" && strongTrend && (valTier === "rich" || valTier === "expensive")) {
    action = "Avoid — falling and pricey";
    actionTone = "bad";
  }

  // ── Reasons behind the HORIZON (✓ / ⚠ / ✗) ─────────────────────────────────
  const reasons = [];
  const add = (tone, text) => reasons.push({ tone, text });
  if (unprofitable) add("bad", `Not yet profitable (net margin ${pct(r.net_margin)})`);
  else if (profit != null) add(toneOf(profit), profit >= 0.66 ? `Strong, profitable returns (ROIC ${pct(r.roic)})` : profit >= 0.4 ? `Modest profitability (ROIC ${pct(r.roic)}, net ${pct(r.net_margin)})` : `Thin returns (ROIC ${pct(r.roic)})`);
  if (distress) add("bad", "Stretched balance sheet (high leverage / negative equity)");
  else if (safety != null) add(toneOf(safety), safety >= 0.66 ? "Healthy balance sheet (low debt)" : safety >= 0.4 ? `Manageable debt (D/E ${isNum(r.debt_equity) ? r.debt_equity.toFixed(2) : "—"})` : "Elevated leverage — watch the debt");
  if (declining) add("bad", "Revenue/earnings shrinking");
  else if (growth != null) add(toneOf(growth), growth >= 0.6 ? `Fast growth (rev ${pct(r.revenue_growth)})` : growth >= 0.4 ? `Steady growth (rev ${pct(r.revenue_growth)})` : `Slow growth (rev ${pct(r.revenue_growth)})`);
  if (beatRate != null) add(beatRate >= 0.75 ? "good" : beatRate >= 0.5 ? "ok" : "bad", `Beats estimates ${Math.round(beatRate * 100)}% of recent quarters`);
  if (speculative) add("ok", r.mcap != null && r.mcap < 3e8 ? "Small/micro-cap — higher risk" : "High volatility (beta) — higher risk");
  // Keep the list tight and decision-relevant: worst news first, then best.
  const order = { bad: 0, ok: 1, good: 2 };
  reasons.sort((a, b) => order[a.tone] - order[b.tone]);
  const topReasons = reasons.slice(0, 5);

  // ── Timing line for the ACTION ─────────────────────────────────────────────
  const tbits = [];
  if (valTier !== "unknown") tbits.push(valTier === "cheap" ? "looks undervalued" : valTier === "fair" ? "fairly valued" : valTier === "rich" ? "priced at a premium" : "looks expensive");
  if (mos != null) tbits.push(`${mos >= 0 ? "+" : ""}${Math.round(mos * 100)}% vs DCF`);
  if (upsideAnalyst != null) tbits.push(`${upsideAnalyst >= 0 ? "+" : ""}${Math.round(upsideAnalyst * 100)}% to analyst target`);
  if (trend !== "unknown") tbits.push(trend === "up" ? "uptrend (50>200)" : "downtrend (50<200)");
  if (overbought) tbits.push(`overbought (RSI ${Math.round(rsi)})`);
  else if (oversold) tbits.push(`oversold (RSI ${Math.round(rsi)})`);
  const timingLine = tbits.join(" · ");

  // ── Headline ───────────────────────────────────────────────────────────────
  const qualWord =
    hk === "trade" ? "Speculative and unprofitable"
      : dur >= 0.78 ? "High-quality compounder"
        : dur >= 0.6 ? "Solid, durable business"
          : dur >= 0.42 ? "Decent but mixed business"
            : "Lower-quality, higher-risk";
  const valWord =
    valTier === "cheap" ? "attractively priced" : valTier === "fair" ? "fairly priced today" : valTier === "rich" ? "trading at a premium" : valTier === "expensive" ? "expensive right now" : "hard to value on price alone";
  const headline =
    hk === "trade"
      ? "Speculative — treat as a short-term trade, not a long-term investment."
      : `${qualWord} — worth holding for ${horizon.holdText}. ${cap(valWord)}; ${action.toLowerCase()}.`;

  // ── Confidence (how much real evidence backs this) ─────────────────────────
  let signals = 0;
  if (tech) signals++;
  if (dcf != null || target != null) signals++;
  if (beatRate != null) signals++;
  const cov = isNum(r.dataCoverage) ? r.dataCoverage : null;
  const confidence =
    cov != null && cov >= 0.7 && signals >= 2 ? "high" : (cov != null && cov >= 0.45) || signals >= 2 ? "medium" : "low";

  // ── Unified pillars + a single conviction 0..100 (the Game Plan number).
  // The Orizin Score folds in as the Fundamentals pillar; personal Fit folds in
  // as its own pillar; Intangibles is left empty for Ori to fill (mergeOri…).
  const fund = isNum(r.score) ? r.score : dur;
  const pillars = [
    pillar("fundamentals", "Fundamentals", fund, PILLAR_WEIGHTS.fundamentals, unprofitable ? "bad" : undefined),
    pillar("valuation", "Valuation", valuation, PILLAR_WEIGHTS.valuation),
    pillar("technicals", "Technicals", momentum, PILLAR_WEIGHTS.technicals),
    pillar("smartMoney", "Insiders", smartMoneyScore(detail.smartMoney), PILLAR_WEIGHTS.smartMoney),
    pillar("analyst", "Analyst", analystScore(r, detail, aiData, price), PILLAR_WEIGHTS.analyst),
    { ...pillar("fit", "Fit for you", fit && !fit.needsContext && isNum(fit.score) ? clamp01(fit.score / 100) : null, PILLAR_WEIGHTS.fit), reasons: fit && !fit.needsContext ? fit.reasons : null },
    // Deterministic Intangibles baseline (cached Ori review, else durabilityProxy)
    // so the pillar isn't empty pre-Ori; the live Ori take overrides it in
    // mergeOriIntoVerdict on Deep Research.
    pillar("intangibles", "Intangibles", intangiblesBaseline(r), PILLAR_WEIGHTS.intangibles, undefined, true),
  ];
  // Risk-tolerance tilt (stored so mergeOriIntoVerdict can re-apply it after it
  // recomputes conviction with Ori's intangibles pillar) + any cached Ori nudge.
  const rDelta = riskDelta(r, risk);
  const conviction = applyRisk(applyRisk(convictionFromPillars(pillars), rDelta), oriDelta(r));

  return {
    horizon,
    conviction,
    riskDelta: rDelta,
    pillars,
    action: { label: action, tone: actionTone, line: timingLine },
    headline,
    reasons: topReasons,
    grades: {
      quality: { score: profit, tone: unprofitable ? "bad" : toneOf(profit) },
      value: { score: valuation, tone: toneOf(valuation), tier: valTier },
      growth: { score: growth, tone: declining ? "bad" : toneOf(growth) },
      safety: { score: safety, tone: distress ? "bad" : toneOf(safety) },
      momentum: { score: momentum, tone: toneOf(momentum), trend, overbought, oversold },
    },
    durability: dur,
    valuation,
    flags: { unprofitable, distress, speculative, declining },
    confidence,
    disclaimer: DISCLAIMER,
  };
}

const HORIZON_ORDER = ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"];

/**
 * Fold Ori's intelligence layer into a deterministic verdict ("adjust within
 * reason"): fill the Intangibles pillar, recompute conviction, apply Ori's
 * clamped convictionDelta, and let Ori move the horizon by AT MOST one notch.
 * Flags `narrativeDriven` when conviction leans on story over fundamentals
 * (the Tesla/SpaceX case) so the UI can warn it's higher-risk.
 * @param {object} det  result of computeVerdict
 * @param {object} ori  structured Ori result (see server game-plan endpoint)
 */
export function mergeOriIntoVerdict(det, ori) {
  if (!det || det.insufficient || !ori) return det;

  const intang = isNum(ori.intangiblesScore) ? clamp01(ori.intangiblesScore / 100) : null;
  const pillars = det.pillars.map((p) =>
    p.id === "intangibles" ? { ...p, score: intang, tone: intang == null ? "neutral" : toneOf(intang) } : p,
  );

  // Conviction now includes the real intangibles score, the risk-tolerance tilt
  // (re-applied since we recomputed from pillars), then Ori's bounded nudge.
  let conviction = applyRisk(convictionFromPillars(pillars), det.riskDelta || 0);
  if (conviction != null) {
    const delta = isNum(ori.convictionDelta) ? Math.max(-20, Math.min(20, ori.convictionDelta)) : 0;
    conviction = Math.max(0, Math.min(100, conviction + delta));
  }

  // Horizon: step at most one notch toward Ori's view.
  let horizon = det.horizon;
  let horizonAdjusted = false;
  const di = HORIZON_ORDER.indexOf(det.horizon?.key);
  const oi = HORIZON_ORDER.indexOf(ori.horizonView);
  if (di >= 0 && oi >= 0 && oi !== di) {
    const ni = Math.max(di - 1, Math.min(di + 1, oi));
    if (ni !== di) {
      horizon = HORIZON[HORIZON_ORDER[ni]];
      horizonAdjusted = true;
    }
  }

  // Action: surface Ori's call, flagged when it differs from the data verdict.
  const action = ori.actionView
    ? { ...det.action, label: ori.actionView, oriAdjusted: ori.actionView !== det.action.label }
    : det.action;

  const fundP = pillars.find((p) => p.id === "fundamentals");
  const narrativeDriven = intang != null && intang >= 0.6 && fundP?.score != null && fundP.score < 0.45;

  return { ...det, pillars, conviction, horizon, horizonAdjusted, action, narrativeDriven, ori };
}

export const DISCLAIMER = "Educational guidance generated from the data on this page — not financial advice. Do your own research.";

// ── Per-metric Good / OK / Bad rubric ─────────────────────────────────────────
// Absolute thresholds so a beginner can scan the metric panels and instantly see
// which numbers are healthy (green), so-so (amber), or weak (red). Returns
// "neutral" for keys we don't grade (e.g. market cap) or missing values.
const hi = (goodMin) => (v) => (v == null || !Number.isFinite(v) ? "neutral" : v < 0 ? "bad" : v >= goodMin ? "good" : "ok");
const lo = (goodMax, badMax) => (v) => (v == null || !Number.isFinite(v) ? "neutral" : v < 0 ? "bad" : v <= goodMax ? "good" : v > badMax ? "bad" : "ok");

const RUBRIC = {
  // Quality / returns (higher is better)
  roic: hi(0.15), roe: hi(0.15), roa: hi(0.07),
  gross_margin: hi(0.4), op_margin: hi(0.15), net_margin: hi(0.12), fcf_margin: hi(0.1),
  fcf_yield: hi(0.05), earnings_yield: hi(0.06),
  // Growth (higher is better)
  revenue_growth: hi(0.1), eps_growth: hi(0.12), fcf_growth: hi(0.1),
  // Valuation (lower is better)
  pe: lo(22, 40), pb: lo(3, 10), ps: lo(3, 12), ev_ebitda: lo(12, 28), ev_gp: lo(10, 25),
  // Leverage (lower is better; net cash counts as good)
  debt_equity: (v) => (v == null || !Number.isFinite(v) ? "neutral" : v < 0 ? "bad" : v <= 0.6 ? "good" : v > 2.5 ? "bad" : "ok"),
  net_debt_ebitda: (v) => (v == null || !Number.isFinite(v) ? "neutral" : v < 0 ? "good" : v <= 1.5 ? "good" : v > 4 ? "bad" : "ok"),
  current_ratio: (v) => (v == null || !Number.isFinite(v) ? "neutral" : v < 1 ? "bad" : v >= 1.5 ? "good" : "ok"),
  // Income — a reasonable yield is nice; an extreme one can be a trap.
  div_yield: (v) => (v == null || !Number.isFinite(v) || v <= 0 ? "neutral" : v > 0.1 ? "ok" : v >= 0.02 ? "good" : "neutral"),
};

export function metricTone(key, value) {
  const f = RUBRIC[key];
  return f ? f(value) : "neutral";
}
