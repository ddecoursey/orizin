// Background screener trickle: compact lite intangibles (fundamentals + profile + headlines).

/** Slim system prompt — intangibles layer only, no full Game Plan narrative. */
export const LITE_TRICKLE_SYSTEM = `You are Ori's screener intangibles engine for Orizin. Judge non-financial / future-potential factors for ONE stock so the screener can nudge Conviction.

Rules:
- Be specific to THIS company using the profile and headlines provided.
- xFactors: only factors that apply (moat, TAM/optionality, management, brand, regulatory/macro). Rate strong/moderate/weak/none with a one-line note. Omit irrelevant factors.
- intangiblesScore (0-100): honest roll-up of xFactors — high only with concrete reason.
- convictionDelta (-20..20): small nudge vs the fundamentals snapshot; data is the anchor.
- bottomLine: one sentence plain-English takeaway for the screener tooltip.
- Educational analysis only — not financial advice.
Return ONLY JSON matching the schema. Keep string fields short.`;

export const LITE_TRICKLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    bottomLine: { type: "STRING" },
    intangiblesScore: { type: "INTEGER" },
    intangiblesRationale: { type: "STRING" },
    xFactors: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          factor: { type: "STRING" },
          strength: { type: "STRING", enum: ["strong", "moderate", "weak", "none"] },
          note: { type: "STRING" },
        },
        required: ["factor", "strength"],
        propertyOrdering: ["factor", "strength", "note"],
      },
    },
    convictionDelta: { type: "INTEGER" },
    horizonView: { type: "STRING", enum: ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"] },
    actionView: { type: "STRING" },
  },
  required: ["bottomLine", "intangiblesScore", "intangiblesRationale", "xFactors", "convictionDelta"],
  propertyOrdering: ["bottomLine", "intangiblesScore", "intangiblesRationale", "xFactors", "convictionDelta", "horizonView", "actionView"],
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
  const score = row?.score != null ? Math.round(Number(row.score) * 100) : null;
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
    orizinScore: score,
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
Val P/E ${num(s.pe)} P/S ${num(s.ps)} FCF ${pctf(s.fcf_yield)} | Qual ROIC ${pctf(s.roic)} op ${pctf(s.op_margin)} | Gr rev ${pctf(s.revenue_growth)} EPS ${pctf(s.eps_growth)}
Orizin ${num(s.orizinScore)}/100 · D/E ${num(s.debt_equity)} ND/EB ${num(s.net_debt_ebitda)}${targetLine ? `\n${targetLine}` : ""}

PROFILE:
${p.description ? String(p.description).slice(0, 750) : "(none)"}

HEADLINES:
${headlines || "(none)"}

Fill the JSON schema with a compact intangibles read for the screener.`;
}

export function sanitizeLiteIntangibles(o) {
  if (!o || typeof o !== "object") return null;
  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  const str = (v, max = 280) => (typeof v === "string" ? v.slice(0, max) : "");
  const STRENGTH = ["strong", "moderate", "weak", "none"];
  const xFactors = (Array.isArray(o.xFactors) ? o.xFactors : [])
    .map((x) => ({
      factor: str(x?.factor, 48),
      strength: STRENGTH.includes(x?.strength) ? x.strength : "moderate",
      note: str(x?.note, 100),
    }))
    .filter((x) => x.factor && x.strength !== "none")
    .slice(0, 5);
  const HOR = ["trade", "oneYr", "threeYr", "fiveYr", "tenYr"];
  return {
    bottomLine: str(o.bottomLine, 200),
    intangiblesScore: clampInt(o.intangiblesScore, 0, 100, 50),
    intangiblesRationale: str(o.intangiblesRationale, 320),
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