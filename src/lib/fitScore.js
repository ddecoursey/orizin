// Fit Score — how well a stock aligns with THIS user's portfolio, goals, and
// theses. Deliberately separate from the Orizin Score (quality/value/growth):
// the Orizin Score says "is this a good company?", the Fit Score says "is this
// right for ME?". It's independent of the Q/V/G weights, so it only recomputes
// when the universe or the user's portfolio/goals/theses change — not on every
// weight drag.

const STOPWORDS = new Set(
  ("the a an and or of to in for on with will would could should i my our we be is are as that this it its at by " +
    "from grow growth keep believe think company stock stocks market more most into over under than then them they " +
    "their have has had not no yes about going long term value great good year years next new").split(" "),
);

// Build the per-user context once (sector weights, holdings, goal text, thesis
// keywords). `stocks` is the universe, used to map each holding to its sector.
export function buildFitContext({ portfolios = [], goals = [], theses = [], stocks = [] }) {
  const sectorOf = new Map();
  for (const s of stocks) if (s.symbol) sectorOf.set(s.symbol.toUpperCase(), s.sector || null);

  const heldSymbols = new Set();
  const sectorDollars = new Map();
  let totalDollars = 0;
  for (const p of portfolios) {
    for (const h of p.holdings || []) {
      const t = String(h.ticker || h.symbol || "").trim().toUpperCase();
      if (!t || t === "MISC") continue;
      heldSymbols.add(t);
      const dollars = Number(h.dollars) || 0;
      if (dollars > 0) {
        totalDollars += dollars;
        const sec = sectorOf.get(t) || "Unknown";
        sectorDollars.set(sec, (sectorDollars.get(sec) || 0) + dollars);
      }
    }
  }
  const sectorWeight = new Map();
  if (totalDollars > 0) for (const [sec, d] of sectorDollars) sectorWeight.set(sec, d / totalDollars);

  const goalText = goals.filter(Boolean).join(" ").toLowerCase();

  const thesisTokens = new Set();
  for (const t of theses) {
    for (const raw of String(t || "").split(/[^A-Za-z0-9]+/)) {
      const w = raw.toLowerCase();
      const isAcronym = raw.length === 2 && raw === raw.toUpperCase() && /[A-Z]/.test(raw); // AI, EV
      if ((w.length >= 3 && !STOPWORDS.has(w)) || isAcronym) thesisTokens.add(w);
    }
  }

  return {
    heldSymbols,
    sectorWeight,
    hasSectorWeights: sectorWeight.size > 0,
    goalText,
    thesisTokens,
    hasContext: heldSymbols.size > 0 || goalText.length > 0 || thesisTokens.size > 0,
  };
}

// Compute a 0–100 fit score + human reasons for one stock. Returns
// { score, reasons, needsContext, held }.
export function computeFit(row, ctx) {
  if (!ctx || !ctx.hasContext) {
    return {
      score: null,
      needsContext: true,
      reasons: ["Add goals, theses, or a portfolio to get a personalized fit score."],
    };
  }

  const sym = (row.symbol || "").toUpperCase();
  let score = 50;
  const reasons = [];

  // ── Portfolio fit ──
  const held = ctx.heldSymbols.has(sym);
  if (held) reasons.push("Already in your portfolio");
  if (ctx.hasSectorWeights && row.sector) {
    const w = ctx.sectorWeight.get(row.sector) || 0;
    if (w >= 0.35) {
      score -= 16;
      reasons.push(`Adds to heavy ${row.sector} exposure (${Math.round(w * 100)}% of portfolio)`);
    } else if (w === 0) {
      score += 12;
      reasons.push(`Diversifies — no ${row.sector} yet`);
    } else if (w < 0.15) {
      score += 6;
      reasons.push(`${row.sector} is lightly weighted in your portfolio`);
    }
  }

  // ── Thesis fit (keyword overlap with name / sector / industry) ──
  if (ctx.thesisTokens.size) {
    const hay = `${row.name || ""} ${row.sector || ""} ${row.industry || ""}`.toLowerCase();
    const hayTokens = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
    const matches = [...ctx.thesisTokens].filter((t) => hayTokens.has(t));
    if (matches.length) {
      score += 18;
      reasons.push(`Matches your thesis: ${matches.slice(0, 2).join(", ")}`);
    }
  }

  // ── Goal fit (light heuristics on the goal text) ──
  const g = ctx.goalText;
  if (g) {
    if (/(income|dividend|yield|retire)/.test(g)) {
      if (row.div_yield > 0.02) {
        score += 12;
        reasons.push(`Income goal · ${(row.div_yield * 100).toFixed(1)}% dividend yield`);
      } else if (row.div_yield == null || row.div_yield < 0.005) {
        score -= 8;
        reasons.push("Little/no dividend (income goal)");
      }
    }
    if (/(growth|grow|compound|aggressive)/.test(g) && row.revenue_growth > 0.15) {
      score += 10;
      reasons.push(`Growth goal · ${(row.revenue_growth * 100).toFixed(0)}% revenue growth`);
    }
    if (/(value|cheap|undervalued|bargain)/.test(g) && row.pe > 0 && row.pe < 15) {
      score += 8;
      reasons.push(`Value goal · low P/E (${row.pe.toFixed(1)})`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!reasons.length) reasons.push("Neutral — no strong alignment signals");
  return { score, needsContext: false, reasons, held };
}
