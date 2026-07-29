// Server-wide explicit Gemini cachedContents for Ori chat. One cache per chat
// model + view holds the byte-stable Ori static block so per-request dynamic
// context is billed at the cached-input rate for that prefix.

import {
  geminiKeys,
  valueModel,
  liteModel,
  thinkingConfigFor,
  chatThinkingLevel,
  liteThinkingLevel,
  isProductionEnv,
} from "./geminiJson.js";
import { oriStaticForView } from "./oriSystemStatic.js";

const CACHE_URL = "https://generativelanguage.googleapis.com/v1beta/cachedContents";
const CACHE_DISPLAY = "orizin-ori-chat-static-v4";

/** @type {Map<string, { name: string, expireTime?: string }>} */
const chatCachesByModel = new Map();

function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function chatContextCacheEnabled() {
  return process.env.GEMINI_CONTEXT_CACHE_ENABLED !== "false";
}

/** QA/dev stay storage-free unless explicitly opted in. */
export function chatContextCacheEnvironmentEnabled() {
  return isProductionEnv() || process.env.GEMINI_CONTEXT_CACHE_NONPROD_ENABLED === "true";
}

export function cacheTtlSeconds() {
  const hours = Number(process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 3600);
  return 24 * 3600;
}

function cacheKey(model, view) {
  return view === "deep-research" ? `${model}:dr` : model;
}

/** Cached content resource name for a chat model + view, or null if unavailable. */
export function getChatContextCacheName(model, view = "screener") {
  if (!chatContextCacheEnabled()) return null;
  return chatCachesByModel.get(cacheKey(model, view))?.name || null;
}

export function chatCacheModels() {
  return process.env.GEMINI_CONTEXT_CACHE_LITE_ENABLED === "true"
    ? [valueModel(), liteModel()]
    : [valueModel()];
}

export function chatCacheViews() {
  const configured = String(process.env.GEMINI_CONTEXT_CACHE_VIEWS || "screener")
    .split(",")
    .map((view) => view.trim())
    .filter((view) => ["screener", "deep-research"].includes(view));
  return configured.length ? [...new Set(configured)] : ["screener"];
}

export function chatMaxOutputTokens(view = "screener") {
  if (view === "deep-research") return envInt("ORI_CHAT_MAX_OUTPUT_DR", 3000);
  if (view === "portfolio-goals") return envInt("ORI_CHAT_MAX_OUTPUT_PORTFOLIO", 2000);
  return envInt("ORI_CHAT_MAX_OUTPUT_SCREENER", 2000);
}

export function fmpPlanningMaxOutputTokens() {
  return envInt("ORI_FMP_PLANNING_MAX_OUTPUT", 384);
}

function cacheDisplayName(model, view) {
  return `${CACHE_DISPLAY}-${cacheKey(model, view)}`;
}

async function createChatCache(apiKey, model, view) {
  const ttl = `${cacheTtlSeconds()}s`;
  const staticText = oriStaticForView(view);
  const res = await fetch(`${CACHE_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: cacheDisplayName(model, view),
      systemInstruction: {
        parts: [{ text: staticText }],
      },
      ttl,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`create ${cacheKey(model, view)} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function listChatCaches(apiKey) {
  const found = [];
  let pageToken = "";
  do {
    const url = new URL(CACHE_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`list caches failed ${res.status}`);
    const data = await res.json();
    found.push(...(Array.isArray(data?.cachedContents) ? data.cachedContents : []));
    pageToken = String(data?.nextPageToken || "");
  } while (pageToken);
  return found;
}

async function extendChatCache(apiKey, cache) {
  const url = new URL(`${CACHE_URL}/${cache.name.replace(/^cachedContents\//, "")}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("updateMask", "ttl");
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: `${cacheTtlSeconds()}s` }),
  });
  if (!res.ok) throw new Error(`refresh ${cache.name} failed ${res.status}`);
  return res.json();
}

async function deleteChatCache(apiKey, cache) {
  const name = String(cache?.name || "");
  if (!/^cachedContents\/[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error("refusing to delete invalid cache name");
  }
  const url = new URL(`${CACHE_URL}/${name.replace(/^cachedContents\//, "")}`);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete duplicate ${name} failed ${res.status}`);
  }
}

function matchingCaches(caches, model, view) {
  const displayName = cacheDisplayName(model, view);
  return caches
    .filter((cache) =>
      cache?.displayName === displayName
      && String(cache?.model || "").replace(/^models\//, "") === model)
    .sort((a, b) => Date.parse(b.expireTime || 0) - Date.parse(a.expireTime || 0));
}

/**
 * Reuse and extend explicit caches instead of creating a fresh paid resource on
 * every process start/refresh. Production caches only the value-model screener
 * prompt by default; QA/dev and the rare lite fallback are opt-in.
 */
export async function ensureChatContextCaches() {
  if (!chatContextCacheEnabled() || !chatContextCacheEnvironmentEnabled()) return;
  const keys = geminiKeys();
  if (!keys.length) return;

  const apiKey = keys[0];
  let existing;
  try {
    existing = await listChatCaches(apiKey);
  } catch (error) {
    console.warn(`[geminiCache] ${error.message}; cache creation skipped to avoid duplicates`);
    return;
  }
  for (const model of chatCacheModels()) {
    for (const view of chatCacheViews()) {
      try {
        const matches = matchingCaches(existing, model, view);
        const current = matches[0] || null;
        // Simultaneous rolling-deploy processes can both list before either
        // creates, leaving duplicate paid resources. Keep the newest exact v4
        // model/view match and remove only its redundant siblings.
        for (const duplicate of matches.slice(1)) {
          await deleteChatCache(apiKey, duplicate);
          console.log(`[geminiCache] removed duplicate ${cacheKey(model, view)} cache`);
        }
        const data = current
          ? await extendChatCache(apiKey, current)
          : await createChatCache(apiKey, model, view);
        if (data?.name) {
          const key = cacheKey(model, view);
          chatCachesByModel.set(key, { name: data.name, expireTime: data.expireTime });
          const tokens = data.usageMetadata?.totalTokenCount;
          console.log(
            `[geminiCache] Ori chat context cache ready: ${key}` +
              (tokens != null ? ` (${tokens} cached tokens)` : "") +
              `, ttl ${cacheTtlSeconds()}s`,
          );
        }
      } catch (e) {
        console.warn(`[geminiCache] ${e.message}`);
      }
    }
  }
}

/** Refresh caches before TTL expiry so chat never falls back mid-session. */
export function startChatContextCacheRefresh() {
  if (!chatContextCacheEnabled() || !chatContextCacheEnvironmentEnabled()) return;
  const ttlSec = cacheTtlSeconds();
  const refreshMs = Math.max(5 * 60_000, Math.floor(ttlSec * 0.8) * 1000);
  setInterval(() => {
    ensureChatContextCaches().catch((e) => {
      console.warn("[geminiCache] refresh failed:", e.message);
    });
  }, refreshMs).unref?.();
}

/**
 * Cheap, isolated FMP routing request. It intentionally excludes Ori's large
 * static prompt, user history, and screen context. Its only job is to select one
 * bounded live-data call; the final user-facing answer is generated separately
 * through the normal cached chat body.
 */
export function buildFmpPlanningGeminiBody(
  model,
  { message, view = "screener", activeSymbol = "", focusSymbols = [] } = {},
  functionDeclarations = [],
) {
  const generationConfig = { maxOutputTokens: fmpPlanningMaxOutputTokens() };
  const tc = thinkingConfigFor(model, liteThinkingLevel());
  if (tc) Object.assign(generationConfig, tc);
  const symbols = [...new Set(
    [activeSymbol, ...(Array.isArray(focusSymbols) ? focusSymbols : [])]
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean),
  )].slice(0, 5);
  return {
    system_instruction: {
      parts: [{
        text: `You are a cost-controlled financial-data router. Choose exactly one offered FMP function that best supplies the live fact explicitly requested by the user. Never answer the user, never call multiple functions, and never request unrelated background research. Current view: ${view}. Screen symbols: ${symbols.join(", ") || "none"}.`,
      }],
    },
    contents: [{
      role: "user",
      parts: [{ text: String(message || "").slice(0, 2000) }],
    }],
    generationConfig,
    tools: [{ functionDeclarations }],
    toolConfig: { functionCallingConfig: { mode: "ANY" } },
  };
}

/**
 * When using explicit cachedContent, Gemini forbids system_instruction on the
 * generate request (static instructions must live in the cache only). Inject
 * per-request dynamic context as a leading user turn + brief model ack so the
 * conversation still alternates user/model before real chat history.
 */
export function contentsWithDynamicContext(dynamicContext, geminiContents) {
  const history = Array.isArray(geminiContents) ? geminiContents : [];
  return [
    {
      role: "user",
      parts: [{
        text: `=== CURRENT REQUEST CONTEXT ===\n${dynamicContext}`,
      }],
    },
    {
      role: "model",
      parts: [{
        text: "Understood. I have the user's current screen context for this request.",
      }],
    },
    ...history,
  ];
}

/**
 * Build the Gemini stream body for one chat model. Uses explicit cachedContent when
 * bootstrapped and no per-request tools are needed; otherwise falls back to the
 * two-part system_instruction split.
 *
 * Gemini rejects GenerateContent requests that combine cachedContent with
 * request-level system_instruction, tools, or tool_config. Ori's FMP declarations
 * are selected dynamically for each question, so they cannot live in the immutable
 * server-wide cache. Tool-enabled turns therefore use the uncached request shape.
 */
export function buildChatGeminiBody(
  model,
  dynamicContext,
  geminiContents,
  view = "screener",
  functionDeclarations = [],
) {
  const generationConfig = { maxOutputTokens: chatMaxOutputTokens(view) };
  // Cap reasoning on the chat tier (default low) so thinking tokens don't dominate
  // the per-turn output bill. Applies to both the cached and fallback bodies below.
  const tc = thinkingConfigFor(model, chatThinkingLevel());
  if (tc) Object.assign(generationConfig, tc);
  const staticText = oriStaticForView(view);
  const cacheName = getChatContextCacheName(model, view);
  const hasFunctionDeclarations = Array.isArray(functionDeclarations)
    && functionDeclarations.length > 0;
  const toolFields = hasFunctionDeclarations
    ? {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      }
    : {};
  if (cacheName && !hasFunctionDeclarations) {
    return {
      cachedContent: cacheName,
      contents: contentsWithDynamicContext(dynamicContext, geminiContents),
      generationConfig,
      ...toolFields,
    };
  }
  return {
    system_instruction: {
      parts: [{ text: staticText }, { text: dynamicContext }],
    },
    contents: geminiContents,
    generationConfig,
    ...toolFields,
  };
}

/** Test hook: reset in-memory cache map. */
export function _resetChatContextCachesForTests() {
  chatCachesByModel.clear();
}

/** Test hook: seed a cache name without calling Gemini. */
export function _setChatContextCacheForTests(model, name, view = "screener") {
  chatCachesByModel.set(cacheKey(model, view), { name });
}
