// Server-wide explicit Gemini cachedContents for Ori chat. One cache per chat
// model + view holds the byte-stable Ori static block so per-request dynamic
// context is billed at the cached-input rate for that prefix.

import { geminiKeys, valueModel, liteModel, thinkingConfigFor, chatThinkingLevel } from "./geminiJson.js";
import { oriStaticForView } from "./oriSystemStatic.js";

const CACHE_URL = "https://generativelanguage.googleapis.com/v1beta/cachedContents";
const CACHE_DISPLAY = "orizen-ori-chat-static-v3";

/** @type {Map<string, { name: string, expireTime?: string }>} */
const chatCachesByModel = new Map();

function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function chatContextCacheEnabled() {
  return process.env.GEMINI_CONTEXT_CACHE_ENABLED !== "false";
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

function chatModels() {
  return [valueModel(), liteModel()];
}

export function chatMaxOutputTokens(view = "screener") {
  if (view === "deep-research") return envInt("ORI_CHAT_MAX_OUTPUT_DR", 4500);
  if (view === "portfolio-goals") return envInt("ORI_CHAT_MAX_OUTPUT_PORTFOLIO", 3500);
  return envInt("ORI_CHAT_MAX_OUTPUT_SCREENER", 3500);
}

async function createChatCache(apiKey, model, view) {
  const ttl = `${cacheTtlSeconds()}s`;
  const staticText = oriStaticForView(view);
  const res = await fetch(`${CACHE_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: `${CACHE_DISPLAY}-${cacheKey(model, view)}`,
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

/**
 * Create (or refresh) explicit context caches for each chat model × view on the primary key.
 */
export async function ensureChatContextCaches() {
  if (!chatContextCacheEnabled()) return;
  const keys = geminiKeys();
  if (!keys.length) return;

  const apiKey = keys[0];
  const views = ["screener", "deep-research"];
  for (const model of chatModels()) {
    for (const view of views) {
      try {
        const data = await createChatCache(apiKey, model, view);
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
  if (!chatContextCacheEnabled()) return;
  const ttlSec = cacheTtlSeconds();
  const refreshMs = Math.max(5 * 60_000, Math.floor(ttlSec * 0.8) * 1000);
  setInterval(() => {
    ensureChatContextCaches().catch((e) => {
      console.warn("[geminiCache] refresh failed:", e.message);
    });
  }, refreshMs).unref?.();
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
 * bootstrapped; otherwise falls back to the two-part system_instruction split.
 */
export function buildChatGeminiBody(model, dynamicContext, geminiContents, view = "screener") {
  const generationConfig = { maxOutputTokens: chatMaxOutputTokens(view) };
  // Cap reasoning on the chat tier (default low) so thinking tokens don't dominate
  // the per-turn output bill. Applies to both the cached and fallback bodies below.
  const tc = thinkingConfigFor(model, chatThinkingLevel());
  if (tc) Object.assign(generationConfig, tc);
  const staticText = oriStaticForView(view);
  const cacheName = getChatContextCacheName(model, view);
  if (cacheName) {
    return {
      cachedContent: cacheName,
      contents: contentsWithDynamicContext(dynamicContext, geminiContents),
      generationConfig,
    };
  }
  return {
    system_instruction: {
      parts: [{ text: staticText }, { text: dynamicContext }],
    },
    contents: geminiContents,
    generationConfig,
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