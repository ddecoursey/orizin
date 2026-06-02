import * as db from './db.js';

// Admin-only middleware. Extracted to avoid circular imports with routes.
// Used to gate universe refresh, data gathers, and debug admin controls.
export function requireAdmin(req, res, next) {
  try {
    // Prefer DB users
    const user = db.getUserByUsername(req.userId);
    if (user && user.is_admin) {
      return next();
    }

    // Legacy fallback: when using AUTH_PASSWORD and no DB users yet,
    // treat the authenticated user as admin.
    const hasUsersNow = (db.userCount?.() ?? 0) > 0;
    const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
    if (!hasUsersNow && req.userId && AUTH_PASSWORD) {
      return next();
    }
  } catch (e) {
    console.error('[auth] requireAdmin error:', e);
  }
  return res.status(403).json({ error: 'Admin access required' });
}
