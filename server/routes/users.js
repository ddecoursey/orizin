import { Router } from "express";
import * as db from "../db.js";
import { EMAIL_RE, displayNameFor } from "../userProfile.js";
import { refreshSessionCookie } from "../session.js";
import { getOriUsageSummary } from "../oriUsage.js";

const router = Router();

// All routes below require authentication (middleware is applied in index.js)

// PATCH /api/users/me — update own profile fields (notification email).
router.patch("/users/me", (req, res) => {
  try {
    const user = db.getUserByUsername(req.userId);
    if (!user) return res.status(404).json({ error: "Account not found" });

    const { notificationEmail } = req.body || {};
    if (notificationEmail !== undefined) {
      const trimmed = String(notificationEmail).trim();
      if (trimmed && !EMAIL_RE.test(trimmed)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      db.setUserNotificationEmail(req.userId, trimmed || null);
    }

    const updated = db.getUserByUsername(req.userId);
    const settings = db.getUserSettings(req.userId);
    res.json({
      ok: true,
      notificationEmail: updated.notification_email || null,
      nickname: settings.nickname || null,
      displayName: displayNameFor(updated, settings),
    });
  } catch (err) {
    console.error("[users] PATCH /users/me error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/users - List all users (admin only for now)
router.get("/users", (req, res) => {
  const currentUser = db.getUserByUsername(req.userId);
  if (!currentUser || !currentUser.is_admin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const nicknames = new Map();
  for (const row of db.listAllUserSettingsRows()) {
    try {
      const data = JSON.parse(row.data || "{}");
      const nick = typeof data.nickname === "string" ? data.nickname.trim() : "";
      if (nick) nicknames.set(row.user_id, nick.slice(0, 64));
    } catch {
      // ignore malformed settings rows
    }
  }

  const chatStats = db.chatStatsByUser();
  const users = db.listUsersWithActivity().map((u) => {
    const loginEmail = u.email || (EMAIL_RE.test(u.username) ? u.username : null);
    const lastActive = u.last_active_at || null;
    const ori = getOriUsageSummary(u.username);
    const chat = chatStats.get(u.username) || { sessions: 0, lastChatAt: null };
    return {
      username: u.username,
      email: loginEmail,
      nickname: nicknames.get(u.username) || null,
      plan: db.normalizePlan(u.plan),
      subscription_status: u.subscription_status || null,
      pro_until: u.pro_until || null,
      created_at: u.created_at,
      is_admin: !!u.is_admin,
      last_login_at: u.last_login_at || null,
      last_login_ip: u.last_login_ip || null,
      login_count: u.login_count || 0,
      last_active_at: lastActive,
      online: lastActive && Date.now() - lastActive < 15 * 60 * 1000,
      chat_sessions: chat.sessions,
      last_chat_at: chat.lastChatAt,
      ori_today_requests: ori.day.requests,
      ori_month_requests: ori.monthTotals.requests,
    };
  });
  res.json({ users });
});

// POST /api/users - Create a new user (admin only)
router.post("/users", (req, res) => {
  try {
    const currentUser = db.getUserByUsername(req.userId);
    if (!currentUser || !currentUser.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { username, password, isAdmin } = req.body || {};
    const email = String(username || "").trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const result = db.createUser(email, password, !!isAdmin, email);

    if (result.success) {
      res.json({ ok: true, username: email, isAdmin: !!isAdmin });
    } else {
      res.status(400).json({ error: result.error || "Failed to create user" });
    }
  } catch (err) {
    console.error("[users] POST /users error:", err);
    res.status(500).json({ error: "Internal server error while creating user" });
  }
});

// PATCH /api/users/:username - Update a user's admin role and/or plan (admin only).
// Body may contain { isAdmin } and/or { plan: 'free'|'pro'|'ultimate' }.
// 'ultimate' = Starfarer (admin-granted higher Ori limits; not sold via PayPal).
router.patch("/users/:username", (req, res) => {
  try {
    const currentUser = db.getUserByUsername(req.userId);
    if (!currentUser || !currentUser.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const username = req.params.username;
    const target = db.getUserByUsername(username);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const body = req.body || {};

    if ('plan' in body) {
      const raw = String(body.plan || '').toLowerCase();
      if (!['free', 'pro', 'ultimate', 'starfarer', 'voyager', 'traveler'].includes(raw)) {
        return res.status(400).json({ error: "plan must be 'free', 'pro', or 'ultimate'" });
      }
      db.setUserPlan(username, raw);
    }

    if ('isAdmin' in body) {
      const isAdmin = !!body.isAdmin;
      // Don't allow removing the last remaining admin (would lock everyone out
      // of user management).
      if (!isAdmin && target.is_admin && db.adminCount() <= 1) {
        return res.status(400).json({ error: "Cannot remove the last admin" });
      }
      db.setUserAdmin(username, isAdmin);
    }

    const updated = db.getUserByUsername(username);
    res.json({
      ok: true,
      username,
      isAdmin: !!updated.is_admin,
      plan: db.normalizePlan(updated.plan),
    });
  } catch (err) {
    console.error("[users] PATCH error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE /api/users/:username - Remove a user (admin only)
router.delete("/users/:username", (req, res) => {
  try {
    const currentUser = db.getUserByUsername(req.userId);
    if (!currentUser || !currentUser.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const username = req.params.username;

    // Prevent deleting the last user (would lock everyone out)
    if (db.userCount() <= 1) {
      return res.status(400).json({ error: "Cannot delete the last remaining user" });
    }

    // Prevent deleting the last admin (would leave the app with no one who can
    // manage users / trigger refreshes — same lockout the demote path guards).
    const target = db.getUserByUsername(username);
    if (target && target.is_admin && db.adminCount() <= 1) {
      return res.status(400).json({ error: "Cannot delete the last remaining admin" });
    }

    const deleted = db.deleteUserCascade(username);

    if (deleted.changes > 0) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    console.error("[users] DELETE error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// POST /api/users/change-password - Change own password
router.post("/users/change-password", (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const username = req.userId; // set by auth middleware

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    // Verify current password
    const user = db.verifyUserPassword(username, currentPassword);
    if (!user) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    db.setUserPassword(username, newPassword);
    const updated = db.getUserByUsername(username);
    refreshSessionCookie(res, req, updated);

    res.json({ ok: true });
  } catch (err) {
    console.error("[users] change-password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;