// Rank a column 0..1 within the row set. asc=true means smaller value → higher rank.
function rankCol(rows, key, asc) {
  const idx = rows.map((r, i) => ({ v: r[key], i })).filter(x => x.v !== null && isFinite(x.v));
  idx.sort((a, b) => asc ? a.v - b.v : b.v - a.v);
  const out = new Array(rows.length).fill(null);
  const L = idx.length;
  idx.forEach((x, k) => { out[x.i] = L < 2 ? 0.5 : (L - 1 - k) / (L - 1); });
  return out;
}

function avg(arr) {
  const a = arr.filter(x => x !== null && isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

// Clamp 0..1
const clamp01 = (v) => (v == null || !isFinite(v) ? null : Math.max(0, Math.min(1, v)));

// DCF margin of safety, normalized to 0..1.
// (dcf - price) / dcf — positive = undervalued. We map -50%..+50% MoS to 0..1.
function dcfMarginOfSafety(price, dcf) {
  if (price == null || dcf == null || dcf <= 0 || price <= 0) return null;
  const mos = (dcf - price) / dcf;
  // Map: mos = -0.5 → 0, mos = 0 → 0.5, mos = +0.5 → 1
  return clamp01((mos + 0.5));
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

export const DEFAULT_WEIGHTS = { q: 35, v: 35, g: 30 };

// Orizen Score: 0..100 composite with 3 pillars.
// Q = Quality (profitability + capital efficiency + balance sheet strength)
// V = Value (multiples + DCF margin of safety)
// G = Growth (revenue / EPS / FCF)
/**
 * Heavy computation: pre-computes all ranks for the given rows.
 * This is expensive (many sorts) and should only run when the underlying data changes.
 */
export function computeRankedRows(rows) {
  if (!rows.length) return { rows, ranks: {} };

  // Quality inputs
  const rRoic  = rankCol(rows, 'roic', false);
  const rRoe   = rankCol(rows, 'roe', false);
  const rGross = rankCol(rows, 'gross_margin', false);
  const rOp    = rankCol(rows, 'op_margin', false);
  const rFcfM  = rankCol(rows, 'fcf_margin', false);
  const rCr    = rankCol(rows, 'current_ratio', false);
  const rNd    = rankCol(rows, 'net_debt_ebitda', true);
  const rDe    = rankCol(rows, 'debt_equity', true);

  // Value inputs
  const rEvGp  = rankCol(rows, 'ev_gp', true);
  const rEvEb  = rankCol(rows, 'ev_ebitda', true);
  const rPe    = rankCol(rows, 'pe', true);
  const rFcfY  = rankCol(rows, 'fcf_yield', false);
  const rDcf   = rows.map((r) => dcfMarginOfSafety(r.price, r.dcf));

  // Growth inputs
  const rRev   = rankCol(rows, 'revenue_growth', false);
  const rEps   = rankCol(rows, 'eps_growth', false);
  const rFcfG  = rankCol(rows, 'fcf_growth', false);

  return {
    rows,
    ranks: {
      q: [rRoic, rRoe, rGross, rOp, rFcfM, rCr, rNd, rDe],
      v: [rEvGp, rEvEb, rPe, rFcfY, rDcf],
      g: [rRev, rEps, rFcfG],
    },
  };
}

/**
 * Lightweight: applies weights to already-ranked data.
 * This is cheap and can run on every slider change.
 */
export function applyWeights(ranked, weights = DEFAULT_WEIGHTS) {
  const { rows, ranks } = ranked;
  if (!rows.length) return rows;

  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const [rRoic, rRoe, rGross, rOp, rFcfM, rCr, rNd, rDe] = ranks.q;
  const [rEvGp, rEvEb, rPe, rFcfY, rDcf] = ranks.v;
  const [rRev, rEps, rFcfG] = ranks.g;

  return rows.map((r, i) => {
    const qScore = avg([rRoic[i], rRoe[i], rGross[i], rOp[i], rFcfM[i], rCr[i], rNd[i], rDe[i]]);
    const vScore = avg([rEvGp[i], rEvEb[i], rPe[i], rFcfY[i], rDcf[i]]);
    const gScore = avg([rRev[i], rEps[i], rFcfG[i]]);

    let num = 0, denom = 0;
    if (qScore != null) { num += qScore * w.q; denom += w.q; }
    if (vScore != null) { num += vScore * w.v; denom += w.v; }
    if (gScore != null) { num += gScore * w.g; denom += w.g; }
    const score = denom > 0 ? num / denom : null;

    const effectiveWeights = {
      q: (qScore != null && denom > 0) ? w.q / denom : 0,
      v: (vScore != null && denom > 0) ? w.v / denom : 0,
      g: (gScore != null && denom > 0) ? w.g / denom : 0,
    };

    const r40 = ruleOf40(r);

    return {
      ...r,
      qScore,
      vScore,
      gScore,
      score,
      effectiveWeights,
      rule_of_40: r40.score,
      passes_rule_of_40: r40.passes,
    };
  });
}

/** Legacy API - kept for compatibility */
export function computeScores(rows, weights = DEFAULT_WEIGHTS) {
  const ranked = computeRankedRows(rows);
  return applyWeights(ranked, weights);
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
