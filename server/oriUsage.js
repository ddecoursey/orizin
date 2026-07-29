// ── Ori (Gemini) per-user usage: fair-use limiter + accounting ───────────────
// Ori is the Pro feature, and every Ori action (a chat turn, or a cache-MISS
// Game Plan generation) spends Gemini tokens — which are not free. To keep a
// single heavy user from costing more than their $10/mo, Pro accounts get a
// layered allotment similar to Anthropic's Claude Pro: a rolling session window,
// plus daily / weekly / monthly caps. Local-dev `default` and legacy env-auth
// instances are unlimited; admin bypass is an explicit operational opt-in.
//
// We track BOTH an upstream generation count (what the limiter enforces) and raw
// Gemini token counts (input / output / cache-served), so a two-generation live
// data turn cannot hide behind one user-facing chat action.
//
// Limits are env-overridable so the owner can retune without a code change.

import {
  getUserByUsername,
  normalizePlan,
  userCount,
  recordOriUsageLedger,
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

// Node handles requests concurrently while Gemini calls are in flight. Count a
// request from the moment it is admitted, not only after Gemini returns, so a
// burst cannot pass the same stale quota snapshot many times.
const pendingOriRequests = new Map();
export const BACKGROUND_ORI_USAGE_ID = "__orizin_background__";

function pendingCount(userId) {
  return pendingOriRequests.get(userId) || 0;
}

// Positive integer from env, else the default. A non-positive / garbage value
// falls back to the default rather than silently locking every Pro user out.
function envInt(name, dflt) {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function envUsd(name, dflt) {
  const n = Number(process.env[name]);
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
    dailyCostUsd: envUsd("ORI_DAILY_COST_LIMIT_USD", 0.75),
    weeklyCostUsd: envUsd("ORI_WEEKLY_COST_LIMIT_USD", 2.50),
    monthlyCostUsd: envUsd("ORI_MONTHLY_COST_LIMIT_USD", 6.00),
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
    dailyCostUsd: envUsd("ORI_STARFARER_DAILY_COST_LIMIT_USD", base.dailyCostUsd * 2),
    weeklyCostUsd: envUsd("ORI_STARFARER_WEEKLY_COST_LIMIT_USD", base.weeklyCostUsd * 2),
    monthlyCostUsd: envUsd("ORI_STARFARER_MONTHLY_COST_LIMIT_USD", base.monthlyCostUsd * 2),
  };
}

function limitsForUser(userId) {
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

// Local-dev / legacy env-auth remain unmetered. Admins retain Ori access but are
// metered by default so QA/owner testing cannot bypass cost controls; operators
// can explicitly restore the old behavior with ORI_ADMIN_UNLIMITED=true.
export function isOriUnlimited(userId) {
  if (!userId || userId === "default") return true; // auth disabled (local dev)
  try {
    const user = getUserByUsername(userId);
    if (!user) return userCount() === 0; // legacy env-password mode
    return !!user.is_admin && process.env.ORI_ADMIN_UNLIMITED === "true";
  } catch {
    return false;
  }
}

function limitMessage(scope, limit, used, extra = "") {
  const msgs = {
    session: `You've reached your ${oriLimits().sessionHours}-hour Ori limit (${limit} generation units). ${extra}Try again when the window resets.`,
    day: `You've reached today's Ori limit (${limit} generation units). It resets at midnight ET.`,
    week: `You've reached your weekly Ori limit (${limit} generation units). It resets every 7 days.`,
    month: `You've reached your monthly Ori limit (${limit} generation units). It resets on the 1st.`,
    cost_day: `You've reached today's Ori compute budget ($${Number(limit).toFixed(2)}). It resets at midnight ET.`,
    cost_week: `You've reached your weekly Ori compute budget ($${Number(limit).toFixed(2)}).`,
    cost_month: `You've reached your monthly Ori compute budget ($${Number(limit).toFixed(2)}). It resets on the 1st.`,
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
function checkOriQuotaFromLedger(userId, requestedUnits = 1) {
  if (isOriUnlimited(userId)) return { ok: true, unlimited: true };
  const limits = limitsForUser(userId);
  const units = Math.max(1, Math.min(3, Math.floor(Number(requestedUnits) || 1)));
  const pending = pendingCount(userId);
  const day = todayKey();
  const windowMs = sessionWindowMs(limits.sessionHours);
  const since = Date.now() - windowMs;
  const sessionUsed = countOriUsageEventsSince(userId, since) + pending;

  if (sessionUsed + units > limits.session) {
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
  const dailyUsed = today.requests + pending;
  if (dailyUsed + units > limits.daily) {
    return {
      ok: false,
      scope: "day",
      limit: limits.daily,
      used: dailyUsed,
      message: limitMessage("day", limits.daily, dailyUsed),
    };
  }
  if ((today.cost_usd_micros || 0) / 1e6 >= limits.dailyCostUsd) {
    return {
      ok: false,
      scope: "cost_day",
      limit: limits.dailyCostUsd,
      used: (today.cost_usd_micros || 0) / 1e6,
      message: limitMessage("cost_day", limits.dailyCostUsd),
    };
  }

  const weekStart = dayKeyDaysAgo(day, 6);
  const week = getOriUsageRange(userId, weekStart, day);
  const weeklyUsed = week.requests + pending;
  if (weeklyUsed + units > limits.weekly) {
    return {
      ok: false,
      scope: "week",
      limit: limits.weekly,
      used: weeklyUsed,
      message: limitMessage("week", limits.weekly, weeklyUsed),
    };
  }
  if ((week.cost_usd_micros || 0) / 1e6 >= limits.weeklyCostUsd) {
    return {
      ok: false,
      scope: "cost_week",
      limit: limits.weeklyCostUsd,
      used: (week.cost_usd_micros || 0) / 1e6,
      message: limitMessage("cost_week", limits.weeklyCostUsd),
    };
  }

  const month = getOriUsageRange(userId, monthStartKey(day), day);
  const monthlyUsed = month.requests + pending;
  if (monthlyUsed + units > limits.monthly) {
    return {
      ok: false,
      scope: "month",
      limit: limits.monthly,
      used: monthlyUsed,
      message: limitMessage("month", limits.monthly, monthlyUsed),
    };
  }
  if ((month.cost_usd_micros || 0) / 1e6 >= limits.monthlyCostUsd) {
    return {
      ok: false,
      scope: "cost_month",
      limit: limits.monthlyCostUsd,
      used: (month.cost_usd_micros || 0) / 1e6,
      message: limitMessage("cost_month", limits.monthlyCostUsd),
    };
  }
  return { ok: true };
}

export function checkOriQuota(userId, { units = 1 } = {}) {
  try {
    return checkOriQuotaFromLedger(userId, units);
  } catch (error) {
    console.warn("[oriUsage] quota verification failed:", error.message);
    return {
      ok: false,
      scope: "metering",
      message: "Ori usage could not be verified. Please try again in a moment.",
    };
  }
}

/** Atomically check the current process's ledger view and reserve one call. */
export function acquireOriQuota(userId, { units = 1 } = {}) {
  const requestedUnits = Math.max(1, Math.min(3, Math.floor(Number(units) || 1)));
  const quota = checkOriQuota(userId, { units: requestedUnits });
  if (!quota.ok || quota.unlimited) return { ...quota, reservation: null };

  const reservation = { userId, units: requestedUnits, released: false };
  pendingOriRequests.set(userId, pendingCount(userId) + requestedUnits);
  return { ...quota, reservation };
}

/** Idempotently release an in-flight quota reservation. */
export function releaseOriQuota(reservation) {
  if (!reservation || reservation.released) return;
  reservation.released = true;
  const count = pendingCount(reservation.userId);
  if (count <= reservation.units) pendingOriRequests.delete(reservation.userId);
  else pendingOriRequests.set(reservation.userId, count - reservation.units);
}

/**
 * Record one billable Ori generation. Call this only when a REAL Gemini call
 * happened (a chat turn, or a cache-miss Game Plan) — never on a cache hit.
 * Uses inference usageMetadata when present; otherwise free countTokens (GetTokens).
 * @param {string} userId
 * @param {{ kind: 'chat' | 'plan', usage?: object, model?: string, fallback?: object }} opts
 */
export async function recordOriUsage(userId, {
  kind,
  usage,
  model,
  fallback,
  generations,
  serviceTier = "standard",
} = {}) {
  if (!userId) return false;
  try {
    const isPlan = kind === "plan";
    const defaultModel = model || (isPlan ? frontierModel() : valueModel());
    const entries = Array.isArray(generations) && generations.length
      ? generations.slice(0, 3)
      : [{ usage, model: defaultModel, fallback, serviceTier }];
    const totals = {
      promptTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      thoughtsTokens: 0,
      costUsdMicros: 0,
    };
    let usedCountTokens = false;
    for (const generation of entries) {
      const generationModel = generation?.model || defaultModel;
      const generationServiceTier = generation?.serviceTier || serviceTier;
      const t = await resolveTokenCounts({
        usage: generation?.usage,
        model: generationModel,
        fallback: generation?.fallback,
      });
      const cost = estimateCostUsd(generationModel, t, {
        serviceTier: generationServiceTier,
      });
      totals.promptTokens += t.promptTokens;
      totals.cachedTokens += t.cachedTokens;
      totals.outputTokens += t.outputTokens;
      totals.thoughtsTokens += t.thoughtsTokens || 0;
      totals.costUsdMicros += cost.totalUsdMicros;
      usedCountTokens ||= t.source === "countTokens";
    }
    const generationCount = entries.length;
    const at = Date.now();
    const delta = {
      requests: generationCount,
      chatRequests: isPlan ? 0 : 1,
      planRequests: isPlan ? 1 : 0,
      promptTokens: totals.promptTokens,
      cachedTokens: totals.cachedTokens,
      outputTokens: totals.outputTokens,
      thoughtsTokens: totals.thoughtsTokens,
      costUsdMicros: totals.costUsdMicros,
    };
    if (isPlan) {
      delta.planPromptTokens = totals.promptTokens;
      delta.planCachedTokens = totals.cachedTokens;
      delta.planOutputTokens = totals.outputTokens;
      delta.planThoughtsTokens = totals.thoughtsTokens;
      delta.planCostUsdMicros = totals.costUsdMicros;
    } else {
      delta.chatPromptTokens = totals.promptTokens;
      delta.chatCachedTokens = totals.cachedTokens;
      delta.chatOutputTokens = totals.outputTokens;
      delta.chatThoughtsTokens = totals.thoughtsTokens;
      delta.chatCostUsdMicros = totals.costUsdMicros;
    }
    recordOriUsageLedger(
      userId,
      todayKey(),
      delta,
      isPlan ? "plan" : "chat",
      at,
      generationCount,
    );
    if (usedCountTokens) {
      console.log(
        `[oriUsage] countTokens fallback (${kind}): ${totals.promptTokens}+${totals.outputTokens} tok → ${(totals.costUsdMicros / 1e6).toFixed(4)} USD`,
      );
    }
    return true;
  } catch (e) {
    // Usage accounting must never break the actual feature.
    console.warn("[oriUsage] record failed:", e.message);
    return false;
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
  const limits = unlimited ? oriLimits() : limitsForUser(userId);
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
