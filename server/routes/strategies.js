import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createHash } from "node:crypto";
import { hasOriAccess } from "../access.js";
import { geminiGenerateJson, modelTier } from "../geminiJson.js";
import { checkOriQuota, recordOriUsage } from "../oriUsage.js";
import { getStrategyMarketSignals } from "../strategyMarketSignals.js";
import { getStrategyContextNames } from "../db.js";
import { STRATEGY_METRICS } from "../../src/lib/strategies.js";

const router = Router();

const strategyOriLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

const strategySignalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

const SIGNAL_FAMILIES = new Set(["sectorPerformance", "sectorPe", "industryPerformance", "industryPe", "movers"]);
const GENERATION_CACHE_TTL_MS = 5 * 60 * 1000;
const generationCache = new Map();
const generationInflight = new Map();
let contextNamesCache = { at: 0, sectors: new Set(), industries: new Set() };

function cleanNames(values, limit) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => String(value || "").trim())
    .filter((value) => /^[A-Za-z0-9&.,'() /-]{1,100}$/.test(value)))].slice(0, limit);
}

function knownContextNames() {
  if (Date.now() - contextNamesCache.at < 5 * 60 * 1000) return contextNamesCache;
  const names = getStrategyContextNames();
  contextNamesCache = {
    at: Date.now(),
    sectors: new Set(names.sectors),
    industries: new Set(names.industries),
  };
  return contextNamesCache;
}

function generationCacheKey(userId, payload) {
  return createHash("sha256").update(`${userId}\n${JSON.stringify(payload)}`).digest("hex");
}

function readGenerationCache(key) {
  const hit = generationCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > GENERATION_CACHE_TTL_MS) {
    generationCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeGenerationCache(key, value) {
  generationCache.set(key, { at: Date.now(), value });
  if (generationCache.size > 500) generationCache.delete(generationCache.keys().next().value);
}

const RULE_METRICS = Object.entries(STRATEGY_METRICS).filter(([, metric]) => !metric.legacy).map(([key]) => key);

const RULE_SCHEMA = {
  type: "OBJECT",
  properties: {
    metric: { type: "STRING", enum: RULE_METRICS },
    operator: { type: "STRING", enum: [">", ">=", "<", "<=", "between", "=", "!="] },
    value: { type: "NUMBER" },
    value2: { type: "NUMBER" },
    lookbackDays: { type: "INTEGER" },
    label: { type: "STRING" },
  },
  required: ["metric", "operator", "value", "label"],
};

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    description: { type: "STRING" },
    symbols: { type: "ARRAY", items: { type: "STRING" } },
    sectors: { type: "ARRAY", items: { type: "STRING" } },
    includeEtfs: { type: "BOOLEAN" },
    rules: {
      type: "ARRAY",
      items: RULE_SCHEMA,
    },
    branches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          match: { type: "STRING", enum: ["all", "any"] },
          conditions: { type: "ARRAY", items: RULE_SCHEMA },
          action: { type: "STRING", enum: ["overweight", "normal", "underweight", "exclude"] },
          multiplier: { type: "NUMBER" },
        },
        required: ["name", "match", "conditions", "action", "multiplier"],
      },
    },
    rankingMetric: { type: "STRING", enum: RULE_METRICS },
    maxPositions: { type: "INTEGER" },
    maxPositionPct: { type: "NUMBER" },
    cashReservePct: { type: "NUMBER" },
    rebalance: { type: "STRING", enum: ["Daily", "Weekly", "Every 2 weeks", "Monthly", "Quarterly"] },
    allowOri: { type: "BOOLEAN" },
    minOriConfidence: { type: "INTEGER" },
    oriBrief: { type: "STRING" },
    benchmark: { type: "STRING" },
    summary: { type: "STRING" },
  },
  required: [
    "name", "description", "symbols", "sectors", "includeEtfs", "rules", "branches",
    "rankingMetric", "maxPositions", "maxPositionPct", "cashReservePct",
    "rebalance", "allowOri", "minOriConfidence", "oriBrief", "benchmark", "summary",
  ],
};

const EVALUATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    picks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          symbol: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["symbol", "reason"],
      },
    },
    confidence: { type: "INTEGER" },
    explanation: { type: "STRING" },
    uncertainty: { type: "STRING" },
  },
  required: ["picks", "confidence", "explanation", "uncertainty"],
};

const DRAFT_SYSTEM = `You are Ori's strategy translator. Turn a plain-English investing idea into a small, understandable paper-trading strategy.

Hard requirements:
- Use only the supplied metric enum. Percent metrics are decimals: 15% is 0.15, -2% is -0.02.
- Boolean metrics use numeric value 1 for true and 0 for false with operator '='.
- For metrics with a window, set lookbackDays between 2 and 252 trading days.
- Write 1 to 6 rules. Each label must explain the rule in plain English.
- Optionally write up to 4 ordered WHEN/THEN branches. A branch may overweight (multiplier above 1), underweight (below 1), keep normal weight (1), or exclude (0). First match wins; ELSE is normal weight.
- Fixed rules always define eligibility. If AI judgment is enabled, Ori may rank only candidates that passed every rule.
- Keep max position at or below 35%, keep at least 5% cash unless the user explicitly requests more, and never imply live trading.
- Prefer a simple strategy that can be explained over a complicated one.
- When existing YAML is supplied, revise it according to the instruction and preserve choices the user did not ask to change.
- The summary must say what the rules decide and exactly what Ori is allowed to decide.`;

const EVALUATION_SYSTEM = `You are Ori acting inside a bounded paper strategy. Every supplied candidate already passed all fixed rules.

You may only rank the supplied candidates. You cannot add a symbol, waive a rule, alter position limits, or recommend live execution. Choose no more than the stated maximum positions. Use the brief to break close calls, be explicit about uncertainty, and keep every reason under 180 characters.`;

function cleanSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : null;
}

function candidatePayload(value) {
  if (!value || typeof value !== "object") return null;
  const symbol = cleanSymbol(value.symbol);
  if (!symbol) return null;
  const numeric = (field) => Number.isFinite(Number(value[field])) ? Number(value[field]) : null;
  return {
    symbol,
    name: String(value.name || symbol).slice(0, 100),
    sector: String(value.sector || "Other").slice(0, 80),
    conviction: numeric("conviction"),
    rsi14: numeric("rsi14"),
    momentum90: numeric("momentum90"),
    roic: numeric("roic"),
    revenueGrowth: numeric("revenueGrowth"),
    fcfYield: numeric("fcfYield"),
    beta: numeric("beta"),
    averageReturn: numeric("averageReturn"),
    returnStdDev: numeric("returnStdDev"),
    annualizedVolatility: numeric("annualizedVolatility"),
    maxDrawdown: numeric("maxDrawdown"),
    allocationBranch: String(value.allocationBranch || "").slice(0, 120) || null,
  };
}

async function generateMetered(userId, options) {
  const quota = checkOriQuota(userId);
  if (!quota.ok) {
    throw Object.assign(new Error(quota.message), { code: "ori_limit", scope: quota.scope });
  }
  const result = await geminiGenerateJson(options);
  await recordOriUsage(userId, { kind: "chat", usage: result.usage, model: result.model });
  return result;
}

function respondGenerationError(res, error) {
  if (error.code === "ori_limit") res.status(429).json({ error: error.message, code: "ori_limit", scope: error.scope });
  else if (error.code === "no_key") res.status(503).json({ error: "Ori is not configured on this server." });
  else if (error.code === "overloaded") res.status(503).json({ error: "Ori is busy right now. Try again in a moment." });
  else if (error.code === "bad_json") res.status(502).json({ error: "Ori could not produce valid strategy logic. Try simplifying the request." });
  else res.status(502).json({ error: "Ori could not complete the strategy request." });
}

router.post("/strategies/signals", strategySignalLimiter, async (req, res) => {
  const known = knownContextNames();
  const sectors = cleanNames(req.body?.sectors, 12).filter((name) => known.sectors.has(name));
  const industries = cleanNames(req.body?.industries, 8).filter((name) => known.industries.has(name));
  const families = Array.isArray(req.body?.families)
    ? [...new Set(req.body.families.filter((family) => SIGNAL_FAMILIES.has(family)))]
    : [];
  if (!families.length) return res.json({ generatedAt: Date.now(), sectorPerformance: {}, sectorPe: {}, industryPerformance: {}, industryPe: {}, movers: null });
  try {
    const signals = await getStrategyMarketSignals({ sectors, industries, families });
    res.json(signals);
  } catch (error) {
    console.warn("[strategies] market signals failed:", error.message);
    res.status(502).json({ error: "Could not load strategy market signals." });
  }
});

router.post("/strategies/ori/draft", strategyOriLimiter, async (req, res) => {
  if (!hasOriAccess(req.userId)) {
    return res.status(402).json({ error: "Ori strategy decisions are a Pro feature.", code: "upgrade_required" });
  }
  const idea = typeof req.body?.idea === "string" ? req.body.idea.trim().slice(0, 4000) : "";
  const currentYaml = typeof req.body?.currentYaml === "string" ? req.body.currentYaml.trim().slice(0, 12000) : "";
  if (idea.length < 12) return res.status(400).json({ error: "Describe the strategy in a little more detail." });
  const draftInput = { kind: "draft", idea, currentYaml };
  const cacheKey = generationCacheKey(req.userId, draftInput);
  const cachedDraft = readGenerationCache(cacheKey);
  if (cachedDraft) return res.json({ ...cachedDraft, cache: "hit" });
  const generationOptions = {
    system: DRAFT_SYSTEM,
    prompt: currentYaml
      ? `Revise the existing paper strategy according to the instruction.\n\nInstruction:\n${idea}\n\nExisting Strategy YAML:\n${currentYaml}`
      : `Build this paper strategy:\n${idea}`,
    schema: DRAFT_SCHEMA,
    temperature: 0.25,
    maxOutputTokens: 1800,
    thinkingLevel: "low",
  };
  let generation = generationInflight.get(cacheKey);
  if (!generation) {
    generation = generateMetered(req.userId, generationOptions).finally(() => generationInflight.delete(cacheKey));
    generationInflight.set(cacheKey, generation);
  }
  let result;
  try {
    result = await generation;
  } catch (error) {
    respondGenerationError(res, error);
    return;
  }
  const responseBody = { draft: result.data, model: result.model, tier: modelTier(result.model) };
  writeGenerationCache(cacheKey, responseBody);
  res.json({ ...responseBody, cache: "miss" });
});

router.post("/strategies/ori/evaluate", strategyOriLimiter, async (req, res) => {
  if (!hasOriAccess(req.userId)) {
    return res.status(402).json({ error: "Ori strategy decisions are a Pro feature.", code: "upgrade_required" });
  }
  const candidates = Array.isArray(req.body?.candidates)
    ? req.body.candidates.map(candidatePayload).filter(Boolean).slice(0, 15)
    : [];
  if (!candidates.length) return res.status(400).json({ error: "No rule-approved candidates were supplied." });
  const maxPositions = Math.max(1, Math.min(15, Number(req.body?.maxPositions) || 5));
  const minConfidence = Math.max(50, Math.min(95, Number(req.body?.minConfidence) || 65));
  const brief = String(req.body?.brief || "Rank the strongest durable candidates.").slice(0, 1000);
  const evaluationInput = { maxPositions, minConfidence, brief, candidates };
  const cacheKey = generationCacheKey(req.userId, { kind: "evaluation", ...evaluationInput });
  const cachedDecision = readGenerationCache(cacheKey);
  if (cachedDecision) return res.json({ ...cachedDecision, cache: "hit" });
  const generationOptions = {
    system: EVALUATION_SYSTEM,
    prompt: JSON.stringify(evaluationInput),
    schema: EVALUATION_SCHEMA,
    temperature: 0.2,
    maxOutputTokens: 900,
    thinkingLevel: "low",
  };
  let generation = generationInflight.get(cacheKey);
  if (!generation) {
    generation = generateMetered(req.userId, generationOptions).finally(() => generationInflight.delete(cacheKey));
    generationInflight.set(cacheKey, generation);
  }
  let result;
  try {
    result = await generation;
  } catch (error) {
    respondGenerationError(res, error);
    return;
  }

  const allowed = new Set(candidates.map((candidate) => candidate.symbol));
  const seen = new Set();
  const picks = (Array.isArray(result.data?.picks) ? result.data.picks : []).map((pick) => {
    const symbol = cleanSymbol(pick?.symbol);
    if (!symbol || !allowed.has(symbol) || seen.has(symbol)) return null;
    seen.add(symbol);
    return { symbol, reason: String(pick.reason || "Selected from the rule-approved finalists.").slice(0, 240) };
  }).filter(Boolean).slice(0, maxPositions);

  const responseBody = {
    decision: {
      picks,
      confidence: Math.max(0, Math.min(100, Number(result.data?.confidence) || 0)),
      explanation: String(result.data?.explanation || "").slice(0, 500),
      uncertainty: String(result.data?.uncertainty || "").slice(0, 500),
      metConfidenceFloor: Number(result.data?.confidence) >= minConfidence,
    },
    model: result.model,
    tier: modelTier(result.model),
  };
  writeGenerationCache(cacheKey, responseBody);
  res.json({ ...responseBody, cache: "miss" });
});

export default router;
