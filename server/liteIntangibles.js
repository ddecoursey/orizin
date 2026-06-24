// Background screener trickle: compact lite intangibles (fundamentals + profile + headlines).

/** Slim system prompt — intangibles layer only, no full Game Plan narrative. */
export const LITE_TRICKLE_SYSTEM = `You are Ori, Orizin's analyst. For ONE stock, judge the non-financial, future-potential factors the numbers miss, so the screener can nudge Conviction.

Be critical, honest, and evidence-driven — move with the evidence, not the story. Most companies overstate their advantages, so require specific evidence for high scores; narrative, size, popularity, and brand aren't themselves evidence. But don't penalize a company for being early or investing heavily — real advantages can exist before they show up in the financials. Don't confuse current dominance with future dominance.

Rate these 7 factors (score 0–100, rating strong/moderate/weak/none, one company-specific note):
future_growth_potential, future_importance, moat_strength, platform_infrastructure_potential, management_execution, ecosystem_dependence, innovation_velocity.

- categoryScores: all 7 keys, scored honestly.
- intangiblesScore (0–100): weighted read — growth 20, importance 20, moat 15, platform 15, management 10, ecosystem 10, innovation 10. Anchors: 50 = average public company, 70 = strong evidence of durable advantage, 80+ = rare. Most cluster 40–60.
- convictionDelta (-20..20): a small nudge; the data is the anchor.
- bottomLine: one plain, specific sentence.
- Educational analysis only — not financial advice.
Return ONLY JSON matching the schema. Keep all string fields short.`;

const CATEGORY_SCORE_ITEM = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER" },
    rating: { type: "STRING", enum: ["strong", "moderate", "weak", "none"] },
    note: { type: "STRING" },
  },
  required: ["score", "rating"],
  propertyOrdering: ["score", "rating", "note"],
};

export const LITE_TRICKLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    bottomLine: { type: "STRING" },
    intangiblesScore: { type: "INTEGER" },
    intangiblesRationale: { type: "STRING" },
    categoryScores: {
      type: "OBJECT",
      properties: {
        future_growth_potential: CATEGORY_SCORE_ITEM,
        future_importance: CATEGORY_SCORE_ITEM,
        moat_strength: CATEGORY_SCORE_ITEM,
        platform_infrastructure_potential: CATEGORY_SCORE_ITEM,
        management_execution: CATEGORY_SCORE_ITEM,
        ecosystem_dependence: CATEGORY_SCORE_ITEM,
        innovation_velocity: CATEGORY_SCORE_ITEM,
      },
      required: ["future_growth_potential", "future_importance", "moat_strength", "platform_infrastructure_potential", "management_execution", "ecosystem_dependence", "innovation_velocity"],
      propertyOrdering: ["future_growth_potential", "future_importance", "moat_strength", "platform_infrastructure_potential", "management_execution", "ecosystem_dependence", "innovation_velocity"],
    },
    convictionDelta: { type: "INTEGER" },
    horizonView: { type: "STRING", enum: ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"] },
    actionView: { type: "STRING" },
  },
  // NOTE: no xFactors here — the UI's xFactors array is DERIVED from categoryScores
  // in sanitizeLiteIntangibles (one source of truth, fewer output tokens, and the
  // displayed factors can never disagree with the scored categories).
  required: ["bottomLine", "intangiblesScore", "intangiblesRationale", "categoryScores", "convictionDelta"],
  propertyOrdering: ["bottomLine", "intangiblesScore", "intangiblesRationale", "categoryScores", "convictionDelta", "horizonView", "actionView"],
};

export function hasClientGamePlanContext(stats, verdict) {
  const s = stats && typeof stats === "object" ? stats : {};
  const v = verdict && typeof verdict === "object" ? verdict : {};
  const statKeys = Object.keys(s).filter((k) => s[k] != null && s[k] !== "");
  const verdictKeys = Object.keys(v).filter((k) => v[k] != null && v[k] !== "");
  return statKeys.length > 0 || verdictKeys.length > 0;
}

/** Map a SQLite stocks row (+ optional ai_enrichment) into lite trickle stats. */
export function stockRowToLiteStats(row, enrichment = null) {
  if (!row && !enrichment) return {};
  const price = row?.price;
  const target = enrichment?.target_consensus ?? row?.target_consensus ?? null;
  const upside =
    target != null && price != null && Number(price) > 0
      ? ((Number(target) - Number(price)) / Number(price)) * 100
      : null;
  return {
    price,
    mcap: row?.mcap,
    beta: row?.beta,
    pe: row?.pe,
    ps: row?.ps,
    pb: row?.pb,
    fcf_yield: row?.fcf_yield,
    roic: row?.roic,
    roe: row?.roe,
    net_margin: row?.net_margin,
    op_margin: row?.op_margin,
    gross_margin: row?.gross_margin,
    fcf_margin: row?.fcf_margin,
    revenue_growth: row?.revenue_growth,
    eps_growth: row?.eps_growth,
    debt_equity: row?.debt_equity,
    net_debt_ebitda: row?.net_debt_ebitda,
    div_yield: row?.div_yield,
    roa: row?.roa,
    ev_ebitda: row?.ev_ebitda,
    sector: row?.sector,
    industry: row?.industry,
    target,
    targetUpsidePct: upside,
  };
}

export function buildLiteTricklePrompt({ symbol, profile, news, stats }) {
  const p = profile || {};
  const s = stats || {};
  const num = (x, suf = "") => (x == null || !Number.isFinite(Number(x)) ? "—" : `${Number(x)}${suf}`);
  const pctf = (x) => (x == null || !Number.isFinite(Number(x)) ? "—" : `${(Number(x) * 100).toFixed(1)}%`);
  const clean = (x, max = 160) => (typeof x === "string" ? x.replace(/[\u0000-\u001F\u007F]+/g, " ").trim().slice(0, max) : "");
  const headlines = (Array.isArray(news) ? news : [])
    .slice(0, 5)
    .map((n) => `• ${n.publishedDate ? String(n.publishedDate).slice(0, 10) + " " : ""}${clean(n.title, 160)}`)
    .join("\n");
  const targetLine =
    s.target != null
      ? `Analyst consensus target ${num(s.target)}${s.targetUpsidePct != null ? ` (${s.targetUpsidePct >= 0 ? "+" : ""}${s.targetUpsidePct.toFixed(0)}% vs price)` : ""}`
      : null;

  return `STOCK: ${symbol}${p.companyName ? ` — ${clean(p.companyName, 60)}` : ""}
${clean(s.sector || p.sector, 32) || "—"} / ${clean(s.industry || p.industry, 32) || "—"} · ${num(s.mcap)} cap · ${num(s.price)} · β ${num(s.beta)}

FUNDAMENTALS (screener DB):
Val P/E ${num(s.pe)} P/S ${num(s.ps)} FCF ${pctf(s.fcf_yield)} | Qual ROIC ${pctf(s.roic)} ROA ${pctf(s.roa)} op ${pctf(s.op_margin)} | Gr rev ${pctf(s.revenue_growth)} EPS ${pctf(s.eps_growth)}
D/E ${num(s.debt_equity)} ND/EB ${num(s.net_debt_ebitda)}${targetLine ? `\n${targetLine}` : ""}

PROFILE:
${p.description ? String(p.description).slice(0, 750) : "(none)"}

HEADLINES:
${headlines || "(none)"}

Fill the JSON schema with a compact intangibles read for the screener.`;
}

const INTANGIBLES_CATEGORY_KEYS = [
  "future_growth_potential",
  "future_importance",
  "moat_strength",
  "platform_infrastructure_potential",
  "management_execution",
  "ecosystem_dependence",
  "innovation_velocity",
];

const INTANGIBLES_WEIGHTS = {
  future_growth_potential: 0.20,
  future_importance: 0.20,
  moat_strength: 0.15,
  platform_infrastructure_potential: 0.15,
  management_execution: 0.10,
  ecosystem_dependence: 0.10,
  innovation_velocity: 0.10,
};

export function sanitizeLiteIntangibles(o) {
  if (!o || typeof o !== "object") return null;
  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  const str = (v, max = 280) => (typeof v === "string" ? v.slice(0, max) : "");
  const STRENGTH = ["strong", "moderate", "weak", "none"];

  // Sanitize categoryScores (7 structured categories).
  const rawCat = o.categoryScores && typeof o.categoryScores === "object" ? o.categoryScores : {};
  const categoryScores = {};
  for (const k of INTANGIBLES_CATEGORY_KEYS) {
    const c = rawCat[k] && typeof rawCat[k] === "object" ? rawCat[k] : {};
    categoryScores[k] = {
      score: clampInt(c.score, 0, 100, 40),
      rating: STRENGTH.includes(c.rating) ? c.rating : "moderate",
      note: str(c.note, 100),
    };
  }

  // If intangiblesScore is absent/invalid, derive it from categoryScores.
  let intangiblesScore = clampInt(o.intangiblesScore, 0, 100, -1);
  if (intangiblesScore < 0) {
    intangiblesScore = Math.round(
      INTANGIBLES_CATEGORY_KEYS.reduce((sum, k) => sum + categoryScores[k].score * INTANGIBLES_WEIGHTS[k], 0)
    );
  }

  // xFactors (the UI display list) is DERIVED from categoryScores — single source
  // of truth, so what the screener shows always matches the scored categories.
  // Strongest categories first so OriTip's "top 3" surfaces the best of them.
  const xFactors = INTANGIBLES_CATEGORY_KEYS
    .map((k) => ({ factor: k, strength: categoryScores[k].rating, note: categoryScores[k].note, _score: categoryScores[k].score }))
    .filter((x) => x.strength !== "none")
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...x }) => x);
  const HOR = ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"];
  return {
    bottomLine: str(o.bottomLine, 200),
    intangiblesScore,
    intangiblesRationale: str(o.intangiblesRationale, 320),
    categoryScores,
    xFactors,
    convictionDelta: clampInt(o.convictionDelta, -20, 20, 0),
    horizonView: HOR.includes(o.horizonView) ? o.horizonView : null,
    actionView: str(o.actionView, 60),
    // UI / mergeOriIntoVerdict tolerate absent narrative fields on lite cache.
    bullCase: "",
    bearCase: "",
    futurePotential: "",
    whatWouldChangeMyMind: "",
    keyFactors: [],
    macroTailwinds: [],
    macroHeadwinds: [],
    riskLevel: "moderate",
  };
}