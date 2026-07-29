// Gemini token counting + cost estimation.
// countTokens uses the GetTokens API (GenerativeModel.count_tokens equivalent) —
// requests are NOT billed and do not count against inference quota.

import { frontierModel, liteModel, valueModel } from "./geminiJson.js";

const COUNT_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`;

const STANDARD_PRICING = {
  "gemini-3.1-flash-lite": { inputPer1M: 0.25, cachedPer1M: 0.025, outputPer1M: 1.5 },
  "gemini-3.5-flash-lite": { inputPer1M: 0.3, cachedPer1M: 0.03, outputPer1M: 2.5 },
  "gemini-3.5-flash": { inputPer1M: 1.5, cachedPer1M: 0.15, outputPer1M: 9 },
  "gemini-3.6-flash": { inputPer1M: 1.5, cachedPer1M: 0.15, outputPer1M: 7.5 },
  "gemini-3.1-pro-preview": { inputPer1M: 2, cachedPer1M: 0.2, outputPer1M: 12 },
  "gemini-2.5-flash-lite": { inputPer1M: 0.1, cachedPer1M: 0.01, outputPer1M: 0.4 },
  "gemini-2.5-flash": { inputPer1M: 0.3, cachedPer1M: 0.03, outputPer1M: 2.5 },
  "gemini-2.5-pro": { inputPer1M: 1.25, cachedPer1M: 0.125, outputPer1M: 10 },
};

const FLEX_PRICING = {
  "gemini-3.1-flash-lite": { inputPer1M: 0.125, cachedPer1M: 0.0125, outputPer1M: 0.75 },
  "gemini-3.5-flash-lite": { inputPer1M: 0.15, cachedPer1M: 0.02, outputPer1M: 1.25 },
  "gemini-3.5-flash": { inputPer1M: 0.75, cachedPer1M: 0.08, outputPer1M: 4.5 },
  "gemini-3.6-flash": { inputPer1M: 0.75, cachedPer1M: 0.075, outputPer1M: 3.75 },
  "gemini-3.1-pro-preview": { inputPer1M: 1, cachedPer1M: 0.1, outputPer1M: 6 },
};

function standardPricing(model, fallback) {
  return STANDARD_PRICING[model] || fallback;
}

/** Paid-tier USD per 1M tokens (Gemini API standard pricing). Env-overridable. */
export function geminiPricingTable() {
  const n = (key, dflt) => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  const row = (input, cached, output) => ({ inputPer1M: input, cachedPer1M: cached, outputPer1M: output });
  const value = valueModel();
  const lite = liteModel();
  const frontier = frontierModel();
  const valueDefault = standardPricing(value, STANDARD_PRICING["gemini-3.5-flash-lite"]);
  const liteDefault = standardPricing(lite, STANDARD_PRICING["gemini-3.1-flash-lite"]);
  const frontierDefault = standardPricing(frontier, STANDARD_PRICING["gemini-3.6-flash"]);
  return {
    [value]: row(
      n("GEMINI_VALUE_INPUT_PER_1M", valueDefault.inputPer1M),
      n("GEMINI_VALUE_CACHED_PER_1M", valueDefault.cachedPer1M),
      n("GEMINI_VALUE_OUTPUT_PER_1M", valueDefault.outputPer1M),
    ),
    [lite]: row(
      n("GEMINI_LITE_INPUT_PER_1M", liteDefault.inputPer1M),
      n("GEMINI_LITE_CACHED_PER_1M", liteDefault.cachedPer1M),
      n("GEMINI_LITE_OUTPUT_PER_1M", liteDefault.outputPer1M),
    ),
    [frontier]: row(
      n("GEMINI_FRONTIER_INPUT_PER_1M", frontierDefault.inputPer1M),
      n("GEMINI_FRONTIER_CACHED_PER_1M", frontierDefault.cachedPer1M),
      n("GEMINI_FRONTIER_OUTPUT_PER_1M", frontierDefault.outputPer1M),
    ),
  };
}

export function pricingForModel(model, { serviceTier = "standard" } = {}) {
  if (serviceTier === "flex" && FLEX_PRICING[model]) return FLEX_PRICING[model];
  const table = geminiPricingTable();
  if (table[model]) return table[model];
  if (STANDARD_PRICING[model]) return STANDARD_PRICING[model];
  if (model?.includes("flash-lite")) return table[liteModel()];
  if (model?.includes("pro")) return table[frontierModel()];
  return table[valueModel()];
}

/** Normalize usageMetadata from generateContent / streamGenerateContent. */
export function tokensFromUsage(usage) {
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  const candidates = n(usage?.candidatesTokenCount);
  const thoughts = n(usage?.thoughtsTokenCount);
  return {
    promptTokens: n(usage?.promptTokenCount),
    cachedTokens: n(usage?.cachedContentTokenCount),
    outputTokens: candidates + thoughts,
    candidatesTokens: candidates,
    thoughtsTokens: thoughts,
  };
}

export function hasTokenCounts(tokens) {
  return (tokens?.promptTokens || 0) + (tokens?.outputTokens || 0) > 0;
}

/**
 * Estimate USD cost from token counts and model pricing.
 * Uncached input = prompt − cached (cached subset billed at cache rate).
 */
export function estimateCostUsd(model, tokens, { serviceTier = "standard" } = {}) {
  const t = tokens || {};
  const prompt = Math.max(0, t.promptTokens || 0);
  const cached = Math.min(prompt, Math.max(0, t.cachedTokens || 0));
  const uncached = Math.max(0, prompt - cached);
  const output = Math.max(0, t.outputTokens || 0);
  const p = pricingForModel(model, { serviceTier });
  const inputCost = (uncached / 1e6) * p.inputPer1M + (cached / 1e6) * p.cachedPer1M;
  const outputCost = (output / 1e6) * p.outputPer1M;
  const total = inputCost + outputCost;
  return {
    model: model || valueModel(),
    serviceTier,
    promptTokens: prompt,
    cachedTokens: cached,
    uncachedTokens: uncached,
    outputTokens: output,
    thoughtsTokens: Math.max(0, t.thoughtsTokens || 0),
    candidatesTokens: Math.max(0, t.candidatesTokens || (output - (t.thoughtsTokens || 0))),
    inputCostUsd: inputCost,
    cachedCostUsd: (cached / 1e6) * p.cachedPer1M,
    uncachedCostUsd: (uncached / 1e6) * p.inputPer1M,
    outputCostUsd: outputCost,
    totalUsd: total,
    totalUsdMicros: Math.round(total * 1e6),
  };
}

function pickGeminiKey() {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_BACKUP,
  ].filter((k) => k && k !== "your_gemini_api_key_here");
  return keys[0] || null;
}

/**
 * countTokens REST call — free (not billed, no inference quota).
 * @param {string} model
 * @param {{ contents?: object[], systemInstruction?: object, generationConfig?: object }} body
 */
export async function countTokens(model, body) {
  const key = pickGeminiKey();
  if (!key || !model) return 0;
  try {
    // countTokens accepts bare `contents`, but steering fields must be nested
    // inside a GenerateContentRequest. Sending systemInstruction or
    // cachedContent at the root returns 400 and would silently undercount a
    // billable generation when usageMetadata is unavailable.
    const hasGenerateConfig = !!(
      body?.systemInstruction
      || body?.cachedContent
      || body?.generationConfig
      || body?.tools
      || body?.toolConfig
    );
    const payload = hasGenerateConfig
      ? {
          generateContentRequest: {
            model: `models/${model}`,
            ...body,
          },
        }
      : body;
    const res = await fetch(`${COUNT_URL(model)}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const n = Number(data.totalTokens ?? data.totalTokenCount ?? data.promptTokenCount);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * When inference omitted usageMetadata, count input + output via GetTokens (free).
 * @param {string} model
 * @param {{ contents?: object[], systemInstruction?: object, cachedContent?: string, outputText?: string }} fallback
 */
export async function countTokensForTurn(model, fallback = {}) {
  const inputBody = {};
  if (fallback.cachedContent) inputBody.cachedContent = fallback.cachedContent;
  if (fallback.systemInstruction) inputBody.systemInstruction = fallback.systemInstruction;
  if (fallback.contents?.length) inputBody.contents = fallback.contents;

  let promptTokens = 0;
  if (inputBody.contents?.length || inputBody.systemInstruction || inputBody.cachedContent) {
    promptTokens = await countTokens(model, inputBody);
  }

  let outputTokens = 0;
  const out = String(fallback.outputText || "").trim();
  if (out) {
    outputTokens = await countTokens(model, {
      contents: [{ role: "model", parts: [{ text: out }] }],
    });
  }

  return { promptTokens, cachedTokens: 0, outputTokens };
}

/** Resolve token counts: prefer inference usageMetadata, else free countTokens. */
export async function resolveTokenCounts({ usage, model, fallback }) {
  const fromUsage = tokensFromUsage(usage);
  if (hasTokenCounts(fromUsage)) return { ...fromUsage, source: "usageMetadata" };
  if (fallback && model) {
    const counted = await countTokensForTurn(model, fallback);
    if (hasTokenCounts(counted)) return { ...counted, source: "countTokens" };
  }
  return { promptTokens: 0, cachedTokens: 0, outputTokens: 0, thoughtsTokens: 0, candidatesTokens: 0, source: "none" };
}

export function microsToUsd(micros) {
  return (Number(micros) || 0) / 1e6;
}

export function fmtUsd(amount, { digits = 2 } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.01) return `<$0.01`;
  return `$${n.toFixed(digits)}`;
}

/** Shape DB aggregates into a cost breakdown for admin / account panels. */
export function costBreakdownFromTotals({
  prompt_tokens = 0,
  cached_tokens = 0,
  output_tokens = 0,
  chat_prompt_tokens = 0,
  chat_cached_tokens = 0,
  chat_output_tokens = 0,
  chat_thoughts_tokens = 0,
  plan_prompt_tokens = 0,
  plan_cached_tokens = 0,
  plan_output_tokens = 0,
  plan_thoughts_tokens = 0,
  chat_cost_usd_micros = 0,
  plan_cost_usd_micros = 0,
  cost_usd_micros = 0,
} = {}) {
  const totalMicros = cost_usd_micros || (chat_cost_usd_micros + plan_cost_usd_micros);
  const chatCost = estimateCostUsd(valueModel(), {
    promptTokens: chat_prompt_tokens,
    cachedTokens: chat_cached_tokens,
    outputTokens: chat_output_tokens,
  });
  const planCost = estimateCostUsd(frontierModel(), {
    promptTokens: plan_prompt_tokens,
    cachedTokens: plan_cached_tokens,
    outputTokens: plan_output_tokens,
  });
  const blended = estimateCostUsd(valueModel(), {
    promptTokens: prompt_tokens,
    cachedTokens: cached_tokens,
    outputTokens: output_tokens,
  });
  const chatUsdStored = microsToUsd(chat_cost_usd_micros);
  const planUsdStored = microsToUsd(plan_cost_usd_micros);
  return {
    totalUsd: microsToUsd(totalMicros),
    totalUsdMicros: totalMicros,
    chatUsd: chat_cost_usd_micros > 0 ? chatUsdStored : chatCost.totalUsd,
    planUsd: plan_cost_usd_micros > 0 ? planUsdStored : planCost.totalUsd,
    chatCostUsdMicros: chat_cost_usd_micros,
    planCostUsdMicros: plan_cost_usd_micros,
    inputUsd: blended.uncachedCostUsd + blended.cachedCostUsd,
    uncachedInputUsd: blended.uncachedCostUsd,
    cachedInputUsd: blended.cachedCostUsd,
    outputUsd: blended.outputCostUsd,
    promptTokens: prompt_tokens,
    cachedTokens: cached_tokens,
    outputTokens: output_tokens,
    chatTokens: {
      prompt: chat_prompt_tokens,
      cached: chat_cached_tokens,
      output: chat_output_tokens,
      thoughts: chat_thoughts_tokens,
    },
    planTokens: {
      prompt: plan_prompt_tokens,
      cached: plan_cached_tokens,
      output: plan_output_tokens,
      thoughts: plan_thoughts_tokens,
    },
  };
}
