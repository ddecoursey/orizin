// ── Ori (Gemini) per-user usage: fair-use limiter + accounting ───────────────
// Ori is the Pro feature, and every Ori action (a chat turn, or a cache-MISS
// Game Plan generation) spends Gemini tokens — which are not free. To keep a
// single heavy user from costing more than their $10/mo, Pro accounts get a
// layered allotment similar to Anthropic's Claude Pro: a rolling session window,
// plus daily / weekly / monthly caps. Admins, the local-dev `default` user, and
// legacy env-auth instances are unlimited.
//
// We track BOTH a request count (what the limiter enforces — simple and legible
// for users) and raw Gemini token counts (input / output / cache-served), so the
// account panel can show real volume and how much the context cache saved.
//
// Limits are env-overridable so the owner can retune without a code change.

import {
  getUserByUsername,
  normalizePlan,
  userCount,
  incrementOriUsage,
  insertOriUsageEvent,
  countOriUsageEventsSince,
  oldestOriUsageEventSince,
  getOriUsageDay,
  getOriUsageRange,
  pruneOriUsage,
  pruneOriUsageEvents,
} from "./db.js";
import { etSessionDate } from "./marketHours.js";
import { valueModel, frontierModel } from "./geminiJson.js";
import {
  resolveTokenCounts,
  estimateCostUsd,
  costBreakdownFromTotals,
} from "./geminiTokens.js";

// Positive integer from env, else the default. A non-positive / garbage value
// falls back to the default rather than silently locking every Pro user out.
function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

const SESSION_HOURS_DEFAULT = 5;

// Layered caps modeled on Claude Pro's session + weekly + monthly structure,
// scaled for a $10/mo plan (~half of Claude Pro's $20). Defaults are tighter
// than the original 50/day + 750/month rollout.
export function oriLimits() {
  const sessionHours = envInt("ORI_SESSION_HOURS", SESSION_HOURS_DEFAULT);
  return {
    session: envInt("ORI_SESSION_LIMIT", 18),
    sessionHours,
    daily: envInt("ORI_DAILY_LIMIT", 25),
    weekly: envInt("ORI_WEEKLY_LIMIT", 70),
    monthly: envInt("ORI_MONTHLY_LIMIT", 280),
  };
}

/** Starfarer (ultimate) — admin-granted; ~2× Voyager caps by default, env-tunable. */
export function oriLimitsForPlan(plan) {
  const base = oriLimits();
  if (normalizePlan(plan) !== 'ultimate') return base;
  return {
    session: envInt("ORI_STARFARER_SESSION_LIMIT", base.session * 2),
    sessionHours: base.sessionHours,
    daily: envInt("ORI_STARFARER_DAILY_LIMIT", base.daily * 2),
    weekly: envInt("ORI_STARFARER_WEEKLY_LIMIT", base.weekly * 2),
    monthly: envInt("ORI_STARFARER_MONTHLY_LIMIT", base.monthly * 2),
  };
}

function limitsForUser(userId) {
  if (isOriUnlimited(userId)) return oriLimits();
  const user = getUserByUsername(userId);
  return oriLimitsForPlan(user?.plan);
}

export function sessionWindowMs(hours = oriLimits().sessionHours) {
  return hours * 60 * 60 * 1000;
}

const todayKey = () => etSessionDate();                 // 'YYYY-MM-DD' (ET)
const monthStartKey = (day = todayKey()) => `${day.slice(0, 7)}-01`;

/** ET calendar day `n` days before `dayKey` (inclusive range helper). */
function dayKeyDaysAgo(dayKey, n) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - n);
  return etSessionDate(t);
}

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

function limitMessage(scope, limit, used, extra = "") {
  const msgs = {
    session: `You've reached your ${oriLimits().sessionHours}-hour Ori limit (${limit} requests). ${extra}Try again when the window resets.`,
    day: `You've reached today's Ori limit (${limit} requests). It resets at midnight ET.`,
    week: `You've reached your weekly Ori limit (${limit} requests). It resets every 7 days.`,
    month: `You've reached your monthly Ori limit (${limit} requests). It resets on the 1st.`,
  };
  return msgs[scope] || `Ori usage limit reached (${limit}).`;
}

function sessionResetsAt(userId, sinceMs) {
  const oldest = oldestOriUsageEventSince(userId, sinceMs);
  if (!oldest) return null;
  return oldest + sessionWindowMs();
}

/**
 * Is this user allowed to spend another Ori request right now?
 * @returns {{ ok: true, unlimited?: boolean } | { ok: false, scope, limit, used, resetsAt?, message }}
 */
export function checkOriQuota(userId) {
  if (isOriUnlimited(userId)) return { ok: true, unlimited: true };
  const limits = limitsForUser(userId);
  const day = todayKey();
  const windowMs = sessionWindowMs(limits.sessionHours);
  const since = Date.now() - windowMs;
  const sessionUsed = countOriUsageEventsSince(userId, since);

  if (sessionUsed >= limits.session) {
    const resetsAt = sessionResetsAt(userId, since);
    const resetHint = resetsAt
      ? `Resets around ${new Date(resetsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET. `
      : "";
    return {
      ok: false,
      scope: "session",
      limit: limits.session,
      used: sessionUsed,
      resetsAt,
      message: limitMessage("session", limits.session, sessionUsed, resetHint),
    };
  }

  const today = getOriUsageDay(userId, day);
  if (today.requests >= limits.daily) {
    return {
      ok: false,
      scope: "day",
      limit: limits.daily,
      used: today.requests,
      message: limitMessage("day", limits.daily, today.requests),
    };
  }

  const weekStart = dayKeyDaysAgo(day, 6);
  const week = getOriUsageRange(userId, weekStart, day);
  if (week.requests >= limits.weekly) {
    return {
      ok: false,
      scope: "week",
      limit: limits.weekly,
      used: week.requests,
      message: limitMessage("week", limits.weekly, week.requests),
    };
  }

  const month = getOriUsageRange(userId, monthStartKey(day), day);
  if (month.requests >= limits.monthly) {
    return {
      ok: false,
      scope: "month",
      limit: limits.monthly,
      used: month.requests,
      message: limitMessage("month", limits.monthly, month.requests),
    };
  }
  return { ok: true };
}

/**
 * Record one billable Ori generation. Call this only when a REAL Gemini call
 * happened (a chat turn, or a cache-miss Game Plan) — never on a cache hit.
 * Uses inference usageMetadata when present; otherwise free countTokens (GetTokens).
 * @param {string} userId
 * @param {{ kind: 'chat' | 'plan', usage?: object, model?: string, fallback?: object }} opts
 */
export async function recordOriUsage(userId, { kind, usage, model, fallback } = {}) {
  if (!userId) return;
  try {
    const isPlan = kind === "plan";
    const usedModel = model || (isPlan ? frontierModel() : valueModel());
    const t = await resolveTokenCounts({ usage, model: usedModel, fallback });
    const cost = estimateCostUsd(usedModel, t);
    const at = Date.now();
    const delta = {
      requests: 1,
      chatRequests: isPlan ? 0 : 1,
      planRequests: isPlan ? 1 : 0,
      promptTokens: t.promptTokens,
      cachedTokens: t.cachedTokens,
      outputTokens: t.outputTokens,
      thoughtsTokens: t.thoughtsTokens || 0,
      costUsdMicros: cost.totalUsdMicros,
    };
    if (isPlan) {
      delta.planPromptTokens = t.promptTokens;
      delta.planCachedTokens = t.cachedTokens;
      delta.planOutputTokens = t.outputTokens;
      delta.planThoughtsTokens = t.thoughtsTokens || 0;
      delta.planCostUsdMicros = cost.totalUsdMicros;
    } else {
      delta.chatPromptTokens = t.promptTokens;
      delta.chatCachedTokens = t.cachedTokens;
      delta.chatOutputTokens = t.outputTokens;
      delta.chatThoughtsTokens = t.thoughtsTokens || 0;
      delta.chatCostUsdMicros = cost.totalUsdMicros;
    }
    incrementOriUsage(userId, todayKey(), delta);
    insertOriUsageEvent(userId, isPlan ? "plan" : "chat", at);
    if (t.source === "countTokens") {
      console.log(`[oriUsage] countTokens fallback for ${userId} (${kind}): ${t.promptTokens}+${t.outputTokens} tok → ${cost.totalUsd.toFixed(4)} USD`);
    }
  } catch (e) {
    // Usage accounting must never break the actual feature.
    console.warn("[oriUsage] record failed:", e.message);
  }
}

function shapeWindow(row) {
  const prompt = row.prompt_tokens || 0;
  const cached = row.cached_tokens || 0;
  const cost = costBreakdownFromTotals(row);
  return {
    requests: row.requests || 0,
    chatRequests: row.chat_requests || 0,
    planRequests: row.plan_requests || 0,
    promptTokens: prompt,
    cachedTokens: cached,
    outputTokens: row.output_tokens || 0,
    thoughtsTokens: (row.chat_thoughts_tokens || 0) + (row.plan_thoughts_tokens || 0),
    // Share of input tokens the context cache served (0..1). Only meaningful
    // once there's been some input volume.
    cacheHitRate: prompt > 0 ? Math.min(1, cached / prompt) : 0,
    cost,
  };
}

/** Everything the account panel needs to render the usage meters. */
export function getOriUsageSummary(userId) {
  const day = todayKey();
  const unlimited = isOriUnlimited(userId);
  const limits = limitsForUser(userId);
  const user = unlimited ? null : getUserByUsername(userId);
  const planTier = unlimited ? null : normalizePlan(user?.plan);
  const windowMs = sessionWindowMs(limits.sessionHours);
  const since = Date.now() - windowMs;
  const sessionUsed = unlimited ? 0 : countOriUsageEventsSince(userId, since);
  const weekStart = dayKeyDaysAgo(day, 6);
  return {
    unlimited,
    limits,
    planTier,
    today: day,
    month: day.slice(0, 7),
    session: {
      used: sessionUsed,
      limit: limits.session,
      hours: limits.sessionHours,
      resetsAt: unlimited ? null : sessionResetsAt(userId, since),
    },
    day: shapeWindow(getOriUsageDay(userId, day)),
    weekTotals: shapeWindow(getOriUsageRange(userId, weekStart, day)),
    monthTotals: shapeWindow(getOriUsageRange(userId, monthStartKey(day), day)),
  };
}

// Housekeeping: ledger rows are tiny, but keep ~3 months and drop the rest so the
// table can't grow without bound. Event rows only need ~1 week of history.
export function pruneOldOriUsage(keepDays = 95) {
  const cutoff = etSessionDate(new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000));
  pruneOriUsage(cutoff);
  pruneOriUsageEvents(Date.now() - 8 * 24 * 60 * 60 * 1000);
}