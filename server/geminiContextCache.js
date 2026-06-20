// Server-wide explicit Gemini cachedContents for Ori chat. One cache per chat
// model (value + lite) holds the byte-stable ORI_SYSTEM_STATIC block so every
// user's personalized suffix is billed at the cached-input rate for that prefix.

import { geminiKeys, valueModel, liteModel } from "./geminiJson.js";
import { ORI_SYSTEM_STATIC } from "./oriSystemStatic.js";

const CACHE_URL = "https://generativelanguage.googleapis.com/v1beta/cachedContents";
const CACHE_DISPLAY = "orizen-ori-chat-static-v2";

/** @type {Map<string, { name: string, expireTime?: string }>} */
const chatCachesByModel = new Map();

export function chatContextCacheEnabled() {
  return process.env.GEMINI_CONTEXT_CACHE_ENABLED !== "false";
}

export function cacheTtlSeconds() {
  const hours = Number(process.env.GEMINI_CONTEXT_CACHE_TTL_HOURS);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 3600);
  return 3600;
}

/** Cached content resource name for a chat model, or null if unavailable. */
export function getChatContextCacheName(model) {
  if (!chatContextCacheEnabled()) return null;
  return chatCachesByModel.get(model)?.name || null;
}

function chatModels() {
  return [valueModel(), liteModel()];
}

async function createChatCache(apiKey, model) {
  const ttl = `${cacheTtlSeconds()}s`;
  const res = await fetch(`${CACHE_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: `${CACHE_DISPLAY}-${model}`,
      systemInstruction: {
        parts: [{ text: ORI_SYSTEM_STATIC }],
      },
      ttl,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`create ${model} failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Create (or refresh) explicit context caches for each chat model on the primary key.
 * Safe to call repeatedly — replaces in-memory names on success.
 */
export async function ensureChatContextCaches() {
  if (!chatContextCacheEnabled()) return;
  const keys = geminiKeys();
  if (!keys.length) return;

  const apiKey = keys[0];
  for (const model of chatModels()) {
    try {
      const data = await createChatCache(apiKey, model);
      if (data?.name) {
        chatCachesByModel.set(model, { name: data.name, expireTime: data.expireTime });
        const tokens = data.usageMetadata?.totalTokenCount;
        console.log(
          `[geminiCache] Ori chat context cache ready: ${model}` +
            (tokens != null ? ` (${tokens} cached tokens)` : "") +
            `, ttl ${cacheTtlSeconds()}s`,
        );
      }
    } catch (e) {
      console.warn(`[geminiCache] ${e.message}`);
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
 * Build the Gemini stream body for one chat model. Uses explicit cachedContent when
 * bootstrapped; otherwise falls back to the two-part system_instruction split.
 */
export function buildChatGeminiBody(model, dynamicContext, geminiContents) {
  const generationConfig = { maxOutputTokens: 8192 };
  const cacheName = getChatContextCacheName(model);
  if (cacheName) {
    return {
      cachedContent: cacheName,
      system_instruction: { parts: [{ text: dynamicContext }] },
      contents: geminiContents,
      generationConfig,
    };
  }
  return {
    system_instruction: {
      parts: [{ text: ORI_SYSTEM_STATIC }, { text: dynamicContext }],
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
export function _setChatContextCacheForTests(model, name) {
  chatCachesByModel.set(model, { name });
}