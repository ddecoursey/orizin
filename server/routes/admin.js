import { Router } from "express";
import * as db from "../db.js";
import { requireAdmin } from "../auth.js";
import { getOriUsageSummary } from "../oriUsage.js";
import { inactivityMs } from "../session.js";
import { etSessionDate } from "../marketHours.js";
import { EMAIL_RE } from "../userProfile.js";
import { microsToUsd, fmtUsd } from "../geminiTokens.js";

const PRO_NET_USD = Number(process.env.PRO_NET_REVENUE_USD) || 9.2;

const router = Router();

const ONLINE_MS = 15 * 60 * 1000;

function relTime(ms) {
  if (!ms) return null;
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function shapeUserRow(u, nicknames, chatStats) {
  const loginEmail = u.email || (EMAIL_RE.test(u.username) ? u.username : null);
  const lastActive = u.last_active_at || null;
  const lastLogin = u.last_login_at || null;
  const online = lastActive && Date.now() - lastActive < ONLINE_MS;
  const chat = chatStats.get(u.username) || { sessions: 0, lastChatAt: null };
  const ori = getOriUsageSummary(u.username);

  let sessionMinutes = null;
  if (online && lastLogin && lastActive) {
    sessionMinutes = Math.max(1, Math.round((lastActive - lastLogin) / 60000));
  }

  return {
    username: u.username,
    email: loginEmail,
    nickname: nicknames.get(u.username) || null,
    plan: db.normalizePlan(u.plan),
    is_admin: !!u.is_admin,
    created_at: u.created_at,
    last_login_at: lastLogin,
    last_login_ip: u.last_login_ip || null,
    login_count: u.login_count || 0,
    last_active_at: lastActive,
    online,
    sessionMinutes,
    lastLoginAgo: relTime(lastLogin),
    lastActiveAgo: relTime(lastActive),
    chatSessions: chat.sessions,
    lastChatAt: chat.lastChatAt,
    lastChatAgo: relTime(chat.lastChatAt),
    subscription_status: u.subscription_status || null,
    pro_until: u.pro_until || null,
    oriUnlimited: ori.unlimited,
    oriToday: ori.day,
    oriWeek: ori.weekTotals,
    oriMonth: ori.monthTotals,
    oriLimits: ori.limits,
    oriSession: ori.session,
    oriCostToday: ori.day.cost,
    oriCostMonth: ori.monthTotals.cost,
    estMarginMonthUsd: u.plan === "pro" && !u.is_admin
      ? Math.max(0, PRO_NET_USD - (ori.monthTotals.cost?.totalUsd || 0))
      : null,
  };
}

// GET /api/admin/observability — admin dashboard: users, activity, Ori usage.
router.get("/admin/observability", requireAdmin, (req, res) => {
  try {
    const nicknames = new Map();
    for (const row of db.listAllUserSettingsRows()) {
      try {
        const data = JSON.parse(row.data || "{}");
        const nick = typeof data.nickname === "string" ? data.nickname.trim() : "";
        if (nick) nicknames.set(row.user_id, nick.slice(0, 64));
      } catch { /* ignore */ }
    }

    const chatStats = db.chatStatsByUser();
    const users = db.listUsersWithActivity().map((u) => shapeUserRow(u, nicknames, chatStats));
    const today = etSessionDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const dayStart = new Date(`${today}T00:00:00-05:00`).getTime();
    const geminiCostMonthMicros = db.sumOriCostAllUsers(monthStart, today);
    const geminiCostTodayMicros = db.sumOriCostAllUsers(today, today);

    const recentLogins = db.listRecentLoginEvents(50).map((e) => ({
      user_id: e.user_id,
      at: e.at,
      ip: e.ip,
      kind: e.kind,
      ago: relTime(e.at),
    }));

    res.json({
      generatedAt: Date.now(),
      inactivityMinutes: Math.round(inactivityMs() / 60000),
      onlineWindowMinutes: Math.round(ONLINE_MS / 60000),
      summary: {
        totalUsers: users.length,
        adminUsers: users.filter((u) => u.is_admin).length,
        proUsers: users.filter((u) => u.plan === "pro").length,
        starfarerUsers: users.filter((u) => u.plan === "ultimate").length,
        onlineNow: users.filter((u) => u.online).length,
        activeToday: users.filter((u) => u.last_active_at && u.last_active_at >= dayStart).length,
        loginsToday: recentLogins.filter((e) => e.at >= dayStart).length,
        geminiCostTodayUsd: microsToUsd(geminiCostTodayMicros),
        geminiCostMonthUsd: microsToUsd(geminiCostMonthMicros),
        geminiCostMonthLabel: fmtUsd(microsToUsd(geminiCostMonthMicros)),
        proNetRevenueUsd: PRO_NET_USD,
      },
      users,
      recentLogins,
    });
  } catch (err) {
    console.error("[admin] observability error:", err);
    res.status(500).json({ error: "Failed to load observability data" });
  }
});

// GET /api/admin/users/:username — detailed profile for one user.
router.get("/admin/users/:username", requireAdmin, (req, res) => {
  try {
    const u = db.getUserByUsername(req.params.username);
    if (!u) return res.status(404).json({ error: "User not found" });

    const nicknames = new Map();
    const settings = db.getUserSettings(u.username);
    if (settings?.nickname) nicknames.set(u.username, settings.nickname);

    const chatStats = db.chatStatsByUser();
    const profile = shapeUserRow(u, nicknames, chatStats);
    const loginHistory = db.listLoginEventsForUser(u.username, 25).map((e) => ({
      at: e.at,
      ip: e.ip,
      user_agent: e.user_agent,
      kind: e.kind,
      ago: relTime(e.at),
    }));

    res.json({ ...profile, loginHistory });
  } catch (err) {
    console.error("[admin] user detail error:", err);
    res.status(500).json({ error: "Failed to load user details" });
  }
});

export default router;