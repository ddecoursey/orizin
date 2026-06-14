// ── Orizin Score ────────────────────────────────────────────────────────────
// Composite 0..100 score with three pillars (Quality / Value / Growth), built
// from tie-aware percentile ranks within the currently filtered set.
//
// Design rules (these exist to keep sparse or junk data from inflating scores):
//  1. JUNK GUARDS — values that would otherwise rank as "best" are corrected
//     before ranking: negative P/E (loss-maker) ranks worst, negative D/E
//     (negative equity) ranks worst and voids ROE, negative EV/EBITDA only
//     counts as cheap when EBITDA is actually positive, ND/EBITDA is dropped
//     when EBITDA is negative, and current ratio is capped at 3 (hoarding cash
//     past that earns no extra credit).
//  2. NEUTRAL IMPUTATION — a missing input counts as rank 0.45 ("unknown is
//     slightly worse than median") instead of being ignored. A stock with two
//     stellar metrics and fourteen blanks can no longer ace its pillars, and a
//     stock with NO growth data can no longer beat an identical stock with
//     mediocre growth (the old behavior redistributed the missing pillar's
//     weight into the stock's good pillars).
//  3. COVERAGE GATE — stocks with fewer than MIN_COMPONENTS real inputs are
//     not scored at all (score = null) so symbol-only rows don't all show a
//     meaningless ~45.
//  4. Final score = slider-weighted average of the three pillars. Pillars are
//     always present once a stock clears the gate, so the effective weights
//     are exactly the user's sliders (normalized) — no silent redistribution.

import { quickConviction } from "./verdict.js";

export const DEFAULT_WEIGHTS = { q: 30, v: 30, g: 40 };

// Rank substitute for "this value is disqualifying" (sorts to the bottom of
// ascending-is-better columns). Finite so it survives isFinite checks.
const WORST = 1e15;

// Rank assigned to missing inputs: slightly below the median stock.
const IMPUTED_RANK = 0.45;

// Minimum number of real (non-imputed) inputs, across all 16, to get a score.
const MIN_COMPONENTS = 3;

// Tie-aware percentile rank: 1 = best, 0 = worst, equal values share the same
// rank (average of their positions). asc=true means smaller value = better.
function rankVals(vals, asc) {
  const idx = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v !== null && v !== undefined && isFinite(v)) idx.push({ v, i });
  }
  const out = new Array(vals.length).fill(null);
  const L = idx.length;
  if (L === 0) return out;
  if (L === 1) {
    out[idx[0].i] = 0.5;
    return out;
  }
  idx.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  let k = 0;
  while (k < L) {
    let j = k;
    while (j + 1 < L && idx[j + 1].v === idx[k].v) j++;
    const avgPos = (k + j) / 2;
    const score = (L - 1 - avgPos) / (L - 1);
    for (let m = k; m <= j; m++) out[idx[m].i] = score;
    k = j + 1;
  }
  return out;
}

const num = (v) => (v === null || v === undefined || !isFinite(v) ? null : v);

// Pre-rank sanitization: returns the values that actually enter the ranking,
// with junk cases corrected (see JUNK GUARDS above).
export function scoringInputs(r) {
  const de = num(r.debt_equity);
  const negEquity = de !== null && de < 0;
  const ebitdaMargin = num(r.ebitda_margin);

  const pe = num(r.pe);
  const evEb = num(r.ev_ebitda);
  const cr = num(r.current_ratio);
  const nd = num(r.net_debt_ebitda);

  return {
    // Quality
    roic: num(r.roic),
    // ROE computed against negative equity is meaningless (often a huge
    // positive for money-losing companies) — drop it.
    roe: negEquity ? null : num(r.roe),
    gross_margin: num(r.gross_margin),
    op_margin: num(r.op_margin),
    fcf_margin: num(r.fcf_margin),
    // Liquidity beyond 3x earns no extra credit (a 25x current ratio is idle
    // capital, not 8x better than a healthy 3x).
    current_ratio: cr !== null ? Math.min(cr, 3) : null,
    // ND/EBITDA flips sign (looks like net cash) when EBITDA is negative.
    net_debt_ebitda: nd !== null && ebitdaMargin !== null && ebitdaMargin <= 0 ? null : nd,
    // Negative equity is a distress signal, not "no leverage".
    debt_equity: negEquity ? WORST : de,

    // Value
    ev_gp: num(r.ev_gp),
    // Negative EV/EBITDA is genuinely cheap ONLY when EBITDA is positive
    // (negative enterprise value). With negative/unknown EBITDA it's junk.
    ev_ebitda:
      evEb !== null && evEb < 0 && !(ebitdaMargin !== null && ebitdaMargin > 0)
        ? WORST
        : evEb,
    // Negative P/E = negative earnings; "cheapest" is the opposite of true.
    pe: pe !== null && pe <= 0 ? WORST : pe,
    fcf_yield: num(r.fcf_yield),

    // Growth
    revenue_growth: num(r.revenue_growth),
    eps_growth: num(r.eps_growth),
    fcf_growth: num(r.fcf_growth),
  };
}

// Clamp 0..1
const clamp01 = (v) => (v == null || !isFinite(v) ? null : Math.max(0, Math.min(1, v)));

// DCF margin of safety, normalized to 0..1.
// (dcf - price) / dcf — positive = undervalued. We map -50%..+50% MoS to 0..1.
function dcfMarginOfSafety(price, dcf) {
  if (price == null || dcf == null || dcf <= 0 || price <= 0) return null;
  const mos = (dcf - price) / dcf;
  // Map: mos = -0.5 → 0, mos = 0 → 0.5, mos = +0.5 → 1
  return clamp01(mos + 0.5);
}

// Rule of 40: revenue growth + EBITDA margin (as percentages, but our data is fractional).
// We return the raw % score (e.g. 0.47 = 47%) for display, and the boolean for filtering.
export function ruleOf40(r) {
  const rev = r?.revenue_growth;
  const margin = r?.ebitda_margin ?? r?.fcf_margin;
  if (rev == null || margin == null) return { score: null, passes: false };
  const score = (rev + margin) * 100; // both are fractional in our schema
  return { score, passes: score >= 40 };
}

/**
 * Heavy computation: sanitizes inputs and pre-computes all percentile ranks
 * for the given rows. Runs only when the underlying (filtered) data changes.
 */
export function computeRankedRows(rows) {
  if (!rows.length) return { rows, ranks: { q: [], v: [], g: [] } };

  const inputs = rows.map(scoringInputs);
  const col = (key) => inputs.map((s) => s[key]);

  return {
    rows,
    ranks: {
      q: [
        rankVals(col('roic'), false),
        rankVals(col('roe'), false),
        rankVals(col('gross_margin'), false),
        rankVals(col('op_margin'), false),
        rankVals(col('fcf_margin'), false),
        rankVals(col('current_ratio'), false),
        rankVals(col('net_debt_ebitda'), true),
        rankVals(col('debt_equity'), true),
      ],
      v: [
        rankVals(col('ev_gp'), true),
        rankVals(col('ev_ebitda'), true),
        rankVals(col('pe'), true),
        rankVals(col('fcf_yield'), false),
        rows.map((r) => dcfMarginOfSafety(r.price, r.dcf)),
      ],
      g: [
        rankVals(col('revenue_growth'), false),
        rankVals(col('eps_growth'), false),
        rankVals(col('fcf_growth'), false),
      ],
    },
  };
}

// Average a pillar's component ranks for row i, imputing missing components
// at IMPUTED_RANK. Returns the pillar score plus how many inputs were real.
function pillarAt(componentCols, i) {
  let sum = 0;
  let present = 0;
  for (const colRanks of componentCols) {
    const v = colRanks[i];
    if (v == null) {
      sum += IMPUTED_RANK;
    } else {
      sum += v;
      present++;
    }
  }
  return { score: sum / componentCols.length, present, total: componentCols.length };
}

// Conviction penalty for user-weighted missing evidence. The Q/V/G score still
// uses neutral imputation so sparse rows remain comparable, but the headline
// Conviction should not let a stock dominate when the user (or the default lens)
// weights a pillar that is *completely* unknown. We add an extra boost for
// zero-coverage pillars (common for growth: many stocks simply have no rev/eps/fcf
// growth numbers populated). This produces a meaningful ranking discount (~8-14 pts
// for a typical large-cap no-growth name under the new 30/30/40 defaults) while
// still allowing exceptional evidenced names to rise.
function coveragePenalty({ qCoverage, vCoverage, gCoverage }, weights, denom) {
  if (!denom) return 0;
  const wq = (Number(weights?.q ?? DEFAULT_WEIGHTS.q) || 0) / denom;
  const wv = (Number(weights?.v ?? DEFAULT_WEIGHTS.v) || 0) / denom;
  const wg = (Number(weights?.g ?? DEFAULT_WEIGHTS.g) || 0) / denom;
  let weightedMissing =
    wq * (1 - qCoverage) +
    wv * (1 - vCoverage) +
    wg * (1 - gCoverage);
  // Extra penalty when the user puts weight on a pillar for which we have *zero*
  // real evidence. This is the key case the original bug report highlighted.
  if (gCoverage === 0) weightedMissing += wg * 0.12;
  if (vCoverage === 0) weightedMissing += wv * 0.10;
  if (qCoverage === 0) weightedMissing += wq * 0.10;
  // Slightly lower entry threshold + steeper ramp than the very first version.
  return Math.min(20, Math.round(Math.max(0, weightedMissing - 0.22) * 55));
}

/**
 * Lightweight: applies the Q/V/G slider weights to already-ranked data.
 * Cheap enough to run on every slider change.
 */
export function applyWeights(ranked, weights = DEFAULT_WEIGHTS, risk = "balanced", fitMap = null) {
  const { rows, ranks } = ranked;
  if (!rows.length) return rows;

  const wq = Number(weights?.q ?? DEFAULT_WEIGHTS.q) || 0;
  const wv = Number(weights?.v ?? DEFAULT_WEIGHTS.v) || 0;
  const wg = Number(weights?.g ?? DEFAULT_WEIGHTS.g) || 0;
  const denom = wq + wv + wg;

  return rows.map((r, i) => {
    const q = pillarAt(ranks.q, i);
    const v = pillarAt(ranks.v, i);
    const g = pillarAt(ranks.g, i);

    const present = q.present + v.present + g.present;
    const totalInputs = q.total + v.total + g.total;
    const scored = present >= MIN_COMPONENTS && denom > 0;
    const coverage = totalInputs ? present / totalInputs : 0;
    const qCoverage = q.total ? q.present / q.total : 0;
    const vCoverage = v.total ? v.present / v.total : 0;
    const gCoverage = g.total ? g.present / g.total : 0;
    const dataCoveragePenalty = scored
      ? coveragePenalty({ qCoverage, vCoverage, gCoverage }, weights, denom)
      : 0;

    const score = scored ? (q.score * wq + v.score * wv + g.score * wg) / denom : null;
    const durProxy = scored ? computeDurabilityProxy(r) : null;
    const baseConviction = scored
      ? quickConviction(
          {
            score, vScore: v.score, pe: r.pe, ev_ebitda: r.ev_ebitda, fcf_yield: r.fcf_yield,
            eps_growth: r.eps_growth, price: r.price, dcf: r.dcf,
            // Joined from ai_enrichment + computed during enrich — let the screener
            // see analyst upside and the SMA50/200 trend so value traps (and
            // names in long downtrends) don't rank high.
            target_consensus: r.target_consensus, mom: r.mom, sma50: r.sma50, sma200: r.sma200,
            // Speculation inputs for the risk-tolerance tilt.
            mcap: r.mcap, beta: r.beta, net_margin: r.net_margin, op_margin: r.op_margin,
            debt_equity: r.debt_equity, net_debt_ebitda: r.net_debt_ebitda, dataCoverage: coverage,
            // Intangibles baseline: cached Ori review (row.ori, free) else durabilityProxy.
            durabilityProxy: durProxy, ori: r.ori || null,
          },
          // Personalized Fit (precomputed per-symbol; null when the user has no
          // portfolio/goals context). Same computeFit() Deep Research uses, so
          // the screener and DR conviction stay consistent.
          fitMap ? fitMap[r.symbol] || null : null,
          risk,
        )
      : null;

    const r40 = ruleOf40(r);

    return {
      ...r,
      qScore: scored ? q.score : null,
      vScore: scored ? v.score : null,
      gScore: scored ? g.score : null,
      score,
      // Unified, user-facing Conviction (0..100) — the Orizin Score (fundamentals)
      // blended with valuation. The full multi-pillar + Ori conviction is computed
      // on the Deep Research page; this lean version keeps the 10k-row screener fast.
      conviction: baseConviction == null ? null : Math.max(0, baseConviction - dataCoveragePenalty),
      baseConviction,
      dataCoveragePenalty,
      // Fraction of the 16 scorecard inputs with real data — surfaced in the
      // UI and to Ori so low-coverage scores are visibly less trustworthy.
      dataCoverage: coverage,
      pillarCoverage: {
        q: qCoverage,
        v: vCoverage,
        g: gCoverage,
      },
      // With imputation every scored stock carries all three pillars, so the
      // effective weights are simply the normalized sliders.
      effectiveWeights: scored
        ? { q: wq / denom, v: wv / denom, g: wg / denom }
        : { q: 0, v: 0, g: 0 },
      rule_of_40: r40.score,
      passes_rule_of_40: r40.passes,
      // Durability / intangibles proxy (0-100). Always available, no LLM cost.
      // High values indicate stronger signals of sustainable business quality
      // (real profits, efficient capital, clean balance sheet, rich data, scale).
      // Feeds the deterministic Intangibles pillar baseline in quickConviction.
      durabilityProxy: durProxy,
    };
  });
}

/** Legacy API - kept for compatibility */
export function computeScores(rows, weights = DEFAULT_WEIGHTS, risk = "balanced") {
  const ranked = computeRankedRows(rows);
  return applyWeights(ranked, weights, risk);
}

// Cheap, always-available proxy for the kinds of "intangibles" Ori reviews
// (durable moat / profitability sustainability, balance sheet safety, data richness,
// scale/stability). High score makes it harder for pure "paper perfect" quantitative
// names (unprofitable cyclicals, narrative microcaps, etc.) to dominate the list
// without real business quality signals. 0-100. Complements the dataCoveragePenalty.
export function computeDurabilityProxy(r) {
  if (!r) return null;
  // Profitability sustainability (margins positive and decent)
  const m = (v, lo, hi) => (v == null || !isFinite(v) ? 0.3 : Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
  const prof = (m(r.net_margin, 0, 0.15) * 0.3 + m(r.op_margin, 0.02, 0.18) * 0.4 + m(r.fcf_margin, 0, 0.12) * 0.3);
  // Capital efficiency + safety
  const roic = m(r.roic, 0.05, 0.2);
  const bs = r.debt_equity == null ? 0.6 : (r.debt_equity < 0 ? 0.95 : m(3 - r.debt_equity, 0, 2.5));
  const cap = 0.5 * roic + 0.5 * bs;
  // Data + stability (harder to fake, more "real" business)
  const data = r.dataCoverage != null ? r.dataCoverage : 0.5;
  const scale = r.mcap == null ? 0.4 : (r.mcap > 10e9 ? 1 : r.mcap > 2e9 ? 0.85 : r.mcap > 5e8 ? 0.6 : 0.35);
  const hasG = (r.revenue_growth != null || r.eps_growth != null || r.fcf_growth != null) ? 0.15 : 0;
  const stab = 0.5 * data + 0.3 * scale + 0.2 * hasG;
  const raw = 0.35 * prof + 0.3 * cap + 0.35 * stab;
  return Math.round(100 * Math.max(0, Math.min(1, raw)));
}

export const SECTOR_COLORS = {
  'Technology':             { bg: '#1e3a5f', fg: '#93c5fd' },
  'Healthcare':             { bg: '#14532d', fg: '#86efac' },
  'Financial Services':     { bg: '#713f12', fg: '#fde68a' },
  'Consumer Cyclical':      { bg: '#7c2d12', fg: '#fed7aa' },
  'Consumer Defensive':     { bg: '#312e81', fg: '#c7d2fe' },
  'Energy':                 { bg: '#701a75', fg: '#f0abfc' },
  'Industrials':            { bg: '#064e3b', fg: '#6ee7b7' },
  'Communication Services': { bg: '#4c1d95', fg: '#ddd6fe' },
  'Real Estate':            { bg: '#134e4a', fg: '#99f6e4' },
  'Utilities':              { bg: '#78350f', fg: '#fcd34d' },
  'Basic Materials':        { bg: '#1a2e05', fg: '#bef264' },
};
