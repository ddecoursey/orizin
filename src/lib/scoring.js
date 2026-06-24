// ── Screener scoring ────────────────────────────────────────────────────────
// Attaches the single user-facing Conviction (0..100) to every row. Conviction
// is computed from ABSOLUTE thresholds (see lib/verdict.js) — there is no longer
// an "Orizin Score" or percentile Q/V/G rank. Each row gets:
//   • conviction       — the headline (quickConviction, minus a sparse-data penalty)
//   • dataCoverage      — fraction of the key fundamentals present (drives the
//                         durability proxy + the penalty; low = less trustworthy)
//   • durabilityProxy   — cheap intangibles baseline (computeDurabilityProxy)
//   • rule_of_40        — display/filter helper
// Stocks below MIN_COVERAGE real inputs are left unscored (conviction = null) so
// symbol-only rows don't show a meaningless number.

import { quickConviction } from "./verdict.js";

// The fundamentals/valuation inputs Conviction actually leans on. dataCoverage =
// how many of these a row really has (the rest fall out of the absolute blend —
// they are never imputed).
const COVERAGE_FIELDS = [
  "roic", "roa", "roe", "net_margin", "op_margin", "fcf_margin",
  "debt_equity", "net_debt_ebitda", "current_ratio",
  "revenue_growth", "eps_growth", "fcf_growth",
  "pe", "fcf_yield", "ev_ebitda",
];
// Minimum real inputs (of COVERAGE_FIELDS) before a row gets a Conviction.
const MIN_COVERAGE = 3;

// Rule of 40: revenue growth + EBITDA margin (fractional in our schema). Returns
// the raw % score (0.47 = 47%) for display and the boolean for filtering.
export function ruleOf40(r) {
  const rev = r?.revenue_growth;
  const margin = r?.ebitda_margin ?? r?.fcf_margin;
  if (rev == null || margin == null) return { score: null, passes: false };
  const score = (rev + margin) * 100; // both are fractional in our schema
  return { score, passes: score >= 40 };
}

const isFiniteNum = (v) => v != null && Number.isFinite(Number(v));

/**
 * Attach Conviction (+ supporting fields) to each row. Absolute scoring needs no
 * cross-row pass, so this is a single O(n) map — cheap enough to re-run whenever
 * the persona-resolved pillarWeights, risk, or Fit context change.
 * @param {object[]} rows
 * @param {{risk?:string, fitMap?:object|null, pillarWeights?:object}} opts
 */
export function scoreRows(rows, { risk = "balanced", fitMap = null, pillarWeights = undefined } = {}) {
  if (!rows || !rows.length) return rows || [];
  return rows.map((r) => {
    let present = 0;
    for (const k of COVERAGE_FIELDS) if (isFiniteNum(r[k])) present++;
    const dataCoverage = present / COVERAGE_FIELDS.length;
    const r40 = ruleOf40(r);

    if (present < MIN_COVERAGE) {
      // Too little real data to stand behind a number.
      return {
        ...r,
        conviction: null, baseConviction: null,
        dataCoverage, dataCoveragePenalty: 0,
        durabilityProxy: null,
        rule_of_40: r40.score, passes_rule_of_40: r40.passes,
      };
    }

    const durabilityProxy = computeDurabilityProxy({ ...r, dataCoverage });
    const fit = fitMap ? fitMap[r.symbol] || null : null;
    // Intangibles baseline = cached Ori review (free) else the durability proxy;
    // dataCoverage feeds the risk-tolerance tilt. Same inputs Deep Research uses,
    // so the screener and DR conviction stay consistent.
    const baseConviction = quickConviction(
      { ...r, dataCoverage, durabilityProxy, ori: r.ori || null },
      fit, risk, pillarWeights,
    );
    // Modest sparse-data discount: full coverage (≥60% of the key inputs) → no
    // penalty; very sparse rows lose up to 15 points so a thin score can't top
    // the list on a couple of lucky metrics.
    const dataCoveragePenalty = dataCoverage >= 0.6 ? 0 : Math.min(15, Math.round((0.6 - dataCoverage) * 35));
    const conviction = baseConviction == null ? null : Math.max(0, baseConviction - dataCoveragePenalty);

    return {
      ...r,
      conviction,
      baseConviction,
      dataCoverage,
      dataCoveragePenalty,
      durabilityProxy,
      rule_of_40: r40.score,
      passes_rule_of_40: r40.passes,
    };
  });
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

/** Light-theme sector chips — pale fills with readable dark labels. */
export const SECTOR_COLORS_LIGHT = {
  'Technology':             { bg: '#dbeafe', fg: '#1e40af' },
  'Healthcare':             { bg: '#d1fae5', fg: '#047857' },
  'Financial Services':     { bg: '#fef3c7', fg: '#b45309' },
  'Consumer Cyclical':      { bg: '#ffedd5', fg: '#c2410c' },
  'Consumer Defensive':     { bg: '#ede9fe', fg: '#6d28d9' },
  'Energy':                 { bg: '#fae8ff', fg: '#a21caf' },
  'Industrials':            { bg: '#d1fae5', fg: '#047857' },
  'Communication Services': { bg: '#ede9fe', fg: '#6d28d9' },
  'Real Estate':            { bg: '#ccfbf1', fg: '#0f766e' },
  'Utilities':              { bg: '#ffedd5', fg: '#c2410c' },
  'Basic Materials':        { bg: '#ecfccb', fg: '#4d7c0f' },
};

export function sectorChipColors(sector, light = false) {
  const map = light ? SECTOR_COLORS_LIGHT : SECTOR_COLORS;
  return map[sector] || (light ? { bg: '#e7e5e4', fg: '#57534e' } : { bg: '#1e293b', fg: '#94a3b8' });
}

const PILLAR_CHIP = {
  q: {
    dark: { bg: '#14532d', fg: '#86efac' },
    light: { bg: '#d1fae5', fg: '#047857' },
  },
  v: {
    dark: { bg: '#713f12', fg: '#fde68a' },
    light: { bg: '#fef3c7', fg: '#b45309' },
  },
  g: {
    dark: { bg: '#134e4b', fg: '#5eead4' },
    light: { bg: '#ccfbf1', fg: '#0f766e' },
  },
  dataOk: {
    dark: { bg: '#1e3a5f', fg: '#93c5fd' },
    light: { bg: '#dbeafe', fg: '#1d4ed8' },
  },
  dataWarn: {
    dark: { bg: '#78350f', fg: '#fcd34d' },
    light: { bg: '#ffedd5', fg: '#c2410c' },
  },
  durHigh: {
    dark: { bg: '#14532d', fg: '#86efac' },
    light: { bg: '#d1fae5', fg: '#047857' },
  },
  durMid: {
    dark: { bg: '#713f12', fg: '#fde68a' },
    light: { bg: '#fef3c7', fg: '#b45309' },
  },
  durLow: {
    dark: { bg: '#78350f', fg: '#fcd34d' },
    light: { bg: '#ffedd5', fg: '#c2410c' },
  },
};

export function pillarChipColors(key, light = false) {
  const entry = PILLAR_CHIP[key];
  if (!entry) return light ? { bg: '#e7e5e4', fg: '#57534e' } : { bg: '#1e293b', fg: '#94a3b8' };
  return light ? entry.light : entry.dark;
}
