import { Router } from "express";
import bcrypt from 'bcryptjs';
import * as db from "../db.js";

const router = Router();

// All routes below require authentication (middleware is applied in index.js)

// GET /api/users - List all users (admin only for now)
router.get("/users", (req, res) => {
  const currentUser = db.getUserByUsername(req.userId);
  if (!currentUser || !currentUser.is_admin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const users = db.listUsers().map(u => ({
    username: u.username,
    created_at: u.created_at,
    is_admin: !!u.is_admin
  }));
  res.json({ users });
});

// POST /api/users - Create a new user (admin only)
router.post("/users", (req, res) => {
  try {
    const currentUser = db.getUserByUsername(req.userId);
    if (!currentUser || !currentUser.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const result = db.createUser(username, password, false);
    
    if (result.success) {
      res.json({ ok: true, username });
    } else {
      res.status(400).json({ error: result.error || "Failed to create user" });
    }
  } catch (err) {
    console.error("[users] POST /users error:", err);
    res.status(500).json({ error: "Internal server error while creating user" });
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

    const deleted = db.default.prepare('DELETE FROM users WHERE username = ?').run(username);
    
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

    // Update password
    const hash = bcrypt.hashSync(newPassword, 10);
    db.default.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);

    res.json({ ok: true });
  } catch (err) {
    console.error("[users] change-password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;