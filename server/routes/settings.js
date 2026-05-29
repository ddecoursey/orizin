import { Router } from "express";
import { getUserSettings, patchUserSettings } from "../db.js";

const router = Router();

// All routes require authentication — the /api middleware in index.js sets
// req.userId so settings are always scoped to the logged-in user.

// GET /api/settings — the current user's full settings blob.
router.get("/settings", (req, res) => {
  res.json({ data: getUserSettings(req.userId) });
});

// PUT /api/settings — shallow-merge the provided keys into the stored blob.
// Body is a partial object, e.g. { tabs, activeTab } or { theme }.
router.put("/settings", (req, res) => {
  const partial = req.body && typeof req.body === "object" ? req.body : {};
  const merged = patchUserSettings(req.userId, partial);
  res.json({ data: merged });
});

export default router;
