import { Router } from "express";
import { getUserSettings, patchUserSettings, markWatchlistQuoteDue, deleteWatchlistAlertState } from "../db.js";
import { refreshQuotesForSymbols } from "../watchlistQuotes.js";
import { normalizeWatchlists } from "../../src/lib/watchlistNormalize.js";
import { sanitizeWatchlistAlerts } from "../../src/lib/watchlistAlertsConfig.js";
import { invalidateWatchlistUnionCache } from "../watchlistSymbols.js";

const router = Router();

const ALLOWED_KEYS = new Set([
  "tabs", "activeTab", "weights", "risk", "sort", "theme", "sidebarCollapsed",
  "portfolios", "goals", "theses", "oriMemory", "watchlists", "activeWatchlistId",
  "watchlistAlerts", "nickname",
]);
const MAX_NICKNAME_LEN = 64;
const MAX_WATCHLIST_PAYLOAD_LISTS = 20;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TABS = 30;
const MAX_ORI_MEMORY = 80;
const MAX_STRING_LEN = 4000;
const MAX_ARRAY_LEN = 200;

function sanitizeSettings(partial) {
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return null;
  const bodySize = JSON.stringify(partial).length;
  if (bodySize > MAX_BODY_BYTES) return null;

  const out = {};
  for (const [k, v] of Object.entries(partial)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (k === "tabs") {
      if (!Array.isArray(v) || v.length > MAX_TABS) continue;
      out.tabs = v.slice(0, MAX_TABS).map((t) => {
        if (!t || typeof t !== "object") return null;
        const name = typeof t.name === "string" ? t.name.slice(0, 28) : "Screener";
        return { ...t, name };
      }).filter(Boolean);
      continue;
    }
    if (k === "oriMemory") {
      if (!Array.isArray(v)) continue;
      out.oriMemory = v.slice(0, MAX_ORI_MEMORY).map((item) => {
        if (typeof item === "string") return { text: item.slice(0, 500) };
        if (item && typeof item === "object" && typeof item.text === "string") {
          return { ...item, text: item.text.slice(0, 500) };
        }
        return null;
      }).filter(Boolean);
      continue;
    }
    if (k === "goals" || k === "theses") {
      if (!Array.isArray(v) || v.length > MAX_ARRAY_LEN) return null;
      if (v.some((s) => typeof s === "string" && s.length > MAX_STRING_LEN)) return null;
      out[k] = v.slice(0, MAX_ARRAY_LEN).map((s) =>
        typeof s === "string" ? s.slice(0, MAX_STRING_LEN) : s,
      );
      continue;
    }
    if (k === "portfolios") {
      if (!Array.isArray(v) || v.length > 20) continue;
      out.portfolios = v;
      continue;
    }
    if (k === "weights" && v && typeof v === "object") {
      const w = {};
      for (const p of ["q", "v", "g"]) {
        const n = Number(v[p]);
        if (Number.isFinite(n)) w[p] = Math.max(0, Math.min(100, n));
      }
      if (Object.keys(w).length) out.weights = w;
      continue;
    }
    if (k === "risk" && ["conservative", "balanced", "aggressive"].includes(v)) {
      out.risk = v;
      continue;
    }
    if (k === "sort" && v && typeof v === "object") {
      const key = typeof v.key === "string" ? v.key.slice(0, 32) : null;
      const dir = v.dir === 1 || v.dir === -1 ? v.dir : null;
      if (key && dir) out.sort = { key, dir };
      continue;
    }
    if (k === "theme" && typeof v === "string" && v.length <= 16) {
      out.theme = v;
      continue;
    }
    if (k === "sidebarCollapsed" && typeof v === "boolean") {
      out.sidebarCollapsed = v;
      continue;
    }
    if (k === "activeTab" && typeof v === "string" && v.length <= 64) {
      out.activeTab = v;
      continue;
    }
    if (k === "activeWatchlistId") {
      out.activeWatchlistId = "default";
      continue;
    }
    if (k === "watchlists") {
      if (!Array.isArray(v) || v.length > MAX_WATCHLIST_PAYLOAD_LISTS) continue;
      out.watchlists = normalizeWatchlists(v);
      continue;
    }
    if (k === "watchlistAlerts" && v && typeof v === "object") {
      out.watchlistAlerts = sanitizeWatchlistAlerts(v);
      continue;
    }
    if (k === "nickname" && typeof v === "string") {
      const nick = v.trim().slice(0, MAX_NICKNAME_LEN);
      out.nickname = nick;
      continue;
    }
  }
  return Object.keys(out).length ? out : {};
}

function diffNewWatchlistSymbols(prevLists, nextLists) {
  const prev = new Set(normalizeWatchlists(prevLists)[0]?.symbols || []);
  const next = normalizeWatchlists(nextLists)[0]?.symbols || [];
  return next.filter((s) => !prev.has(s));
}

function diffRemovedWatchlistSymbols(prevLists, nextLists) {
  const next = new Set(normalizeWatchlists(nextLists)[0]?.symbols || []);
  const prev = normalizeWatchlists(prevLists)[0]?.symbols || [];
  return prev.filter((s) => !next.has(s));
}

// All routes require authentication — the /api middleware in index.js sets
// req.userId so settings are always scoped to the logged-in user.

// GET /api/settings — the current user's full settings blob.
router.get("/settings", (req, res) => {
  res.json({ data: getUserSettings(req.userId) });
});

// PUT /api/settings — shallow-merge the provided keys into the stored blob.
// Body is a partial object, e.g. { tabs, activeTab } or { theme }.
router.put("/settings", (req, res) => {
  const partial = sanitizeSettings(req.body);
  if (partial === null) {
    return res.status(400).json({ error: "Invalid or oversized settings payload" });
  }

  const prev = partial.watchlists ? getUserSettings(req.userId) : null;

  const merged = patchUserSettings(req.userId, partial);

  if (partial.watchlists) {
    invalidateWatchlistUnionCache();
    const added = diffNewWatchlistSymbols(prev?.watchlists, merged.watchlists);
    const removed = diffRemovedWatchlistSymbols(prev?.watchlists, merged.watchlists);
    if (added.length) {
      markWatchlistQuoteDue(added);
      refreshQuotesForSymbols(added).catch(() => {});
    }
    for (const sym of removed) deleteWatchlistAlertState(req.userId, sym);
  }

  res.json({ data: merged });
});

export default router;