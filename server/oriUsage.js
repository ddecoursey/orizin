// ── Ori (Gemini) per-user usage: fair-use limiter + accounting ───────────────
// Ori is the Pro feature, and every Ori action (a chat turn, or a cache-MISS
// Game Plan generation) spends Gemini tokens — which are not free. To keep a
// single heavy user from costing more than their $10/mo, Pro accounts get a
// generous daily + monthly allotment of Ori "requests". Admins, the local-dev
// `default` user, and legacy env-auth instances are unlimited.
//
// We track BOTH a request count (what the limiter enforces — simple and legible
// for users) and raw Gemini token counts (input / output / cache-served), so the
// account panel can show real volume and how much the context cache saved.
//
// Limits are env-overridable so the owner can retune without a code change.

import {
  getUserByUsername,
  userCount,
  incrementOriUsage,
  getOriUsageDay,
  getOriUsageRange,
  pruneOriUsage,
} from "./db.js";
import { etSessionDate } from "./marketHours.js";

// Positive integer from env, else the default. A non-positive / garbage value
// falls back to the default rather than silently locking every Pro user out.
function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// Two overlapping windows: the daily cap stops a single-day blowout; the monthly
// cap bounds the total bill (a sustained ~20/day). Weekly would be redundant
// between these two, so we don't enforce it.
export function oriLimits() {
  return {
    daily: envInt("ORI_DAILY_LIMIT", 50),
    monthly: envInt("ORI_MONTHLY_LIMIT", 750),
  };
}

const todayKey = () => etSessionDate();                 // 'YYYY-MM-DD' (ET)
const monthStartKey = (day = todayKey()) => `${day.slice(0, 7)}-01`;

// Admins / local-dev / legacy env-auth never hit the meter. Mirrors the access
// rules in access.js (hasOriAccess) so "can use Ori" and "is metered" agree.
export function isOriUnlimited(userId) {
  if (!userId || userId === "default") return true; // auth disabled (local dev)
  try {
    const user = getUserByUsername(userId);
    if (!user) return userCount() === 0; // legacy env-password mode
    return !!user.is_admin;
  } catch {
    return true; // never let a bookkeeping error block a paying user
  }
}

// Normalize a Gemini usageMetadata blob (from streaming or generateContent) into
// our column deltas. Missing/garbage fields degrade to 0.
function tokensFrom(usage) {
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  return {
    promptTokens: n(usage?.promptTokenCount),
    cachedTokens: n(usage?.cachedContentTokenCount),
    outputTokens: n(usage?.candidatesTokenCount),
  };
}

/**
 * Is this user allowed to spend another Ori request right now?
 * @returns {{ ok: true, unlimited?: boolean } | { ok: false, scope, limit, used, message }}
 */
export function checkOriQuota(userId) {
  if (isOriUnlimited(userId)) return { ok: true, unlimited: true };
  const limits = oriLimits();
  const day = todayKey();
  const today = getOriUsageDay(userId, day);
  if (today.requests >= limits.daily) {
    return {
      ok: false,
      scope: "day",
      limit: limits.daily,
      used: today.requests,
      message: `You've reached today's Ori limit (${limits.daily} requests). It resets at midnight ET.`,
    };
  }
  const month = getOriUsageRange(userId, monthStartKey(day), day);
  if (month.requests >= limits.monthly) {
    return {
      ok: false,
      scope: "month",
      limit: limits.monthly,
      used: month.requests,
      message: `You've reached your monthly Ori limit (${limits.monthly} requests). It resets on the 1st.`,
    };
  }
  return { ok: true };
}

/**
 * Record one billable Ori generation. Call this only when a REAL Gemini call
 * happened (a chat turn, or a cache-miss Game Plan) — never on a cache hit.
 * @param {string} userId
 * @param {{ kind: 'chat' | 'plan', usage?: object }} opts
 */
export function recordOriUsage(userId, { kind, usage } = {}) {
  if (!userId) return;
  try {
    const t = tokensFrom(usage);
    incrementOriUsage(userId, todayKey(), {
      requests: 1,
      chatRequests: kind === "chat" ? 1 : 0,
      planRequests: kind === "plan" ? 1 : 0,
      promptTokens: t.promptTokens,
      cachedTokens: t.cachedTokens,
      outputTokens: t.outputTokens,
    });
  } catch (e) {
    // Usage accounting must never break the actual feature.
    console.warn("[oriUsage] record failed:", e.message);
  }
}

function shapeWindow(row) {
  const prompt = row.prompt_tokens || 0;
  const cached = row.cached_tokens || 0;
  return {
    requests: row.requests || 0,
    chatRequests: row.chat_requests || 0,
    planRequests: row.plan_requests || 0,
    promptTokens: prompt,
    cachedTokens: cached,
    outputTokens: row.output_tokens || 0,
    // Share of input tokens the context cache served (0..1). Only meaningful
    // once there's been some input volume.
    cacheHitRate: prompt > 0 ? Math.min(1, cached / prompt) : 0,
  };
}

/** Everything the account panel needs to render the usage meters. */
export function getOriUsageSummary(userId) {
  const day = todayKey();
  const limits = oriLimits();
  const unlimited = isOriUnlimited(userId);
  return {
    unlimited,
    limits,
    today: day,
    month: day.slice(0, 7),
    day: shapeWindow(getOriUsageDay(userId, day)),
    monthTotals: shapeWindow(getOriUsageRange(userId, monthStartKey(day), day)),
  };
}

// Housekeeping: ledger rows are tiny, but keep ~3 months and drop the rest so the
// table can't grow without bound. Safe to call on a schedule.
export function pruneOldOriUsage(keepDays = 95) {
  const cutoff = etSessionDate(new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000));
  pruneOriUsage(cutoff);
}
