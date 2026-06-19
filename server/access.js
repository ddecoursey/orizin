import { reconcileUserPlan, getUserByUsername, userCount } from "./db.js";

// Explicit opt-in to bypass the Pro gate while developing (so the owner can
// exercise Ori on their own box without marking their account Pro). Off by
// default — set ORI_DEV_OPEN=1 in your local .env. Never set this on a deployed
// QA/prod environment; those stay strictly Pro-gated.
const ORI_DEV_OPEN = process.env.ORI_DEV_OPEN === "1" || process.env.ORI_DEV_OPEN === "true";
const IS_PRODUCTION =
  process.env.NODE_ENV === "production"
  || process.env.APP_ENV === "production"
  || process.env.RAILWAY_ENVIRONMENT === "production";

// ── Plan gating ─────────────────────────────────────────────────────────────
// Ori (the chat AND the Ori-powered Game Plan layer) is the Pro-tier feature:
// free accounts get the full screener / research / deterministic Game Plan;
// Pro ($10/month) unlocks Ori's intelligence. Admins always have access, as do
// the legacy single-user / env-auth modes (no user rows). Shared by the chat
// route and the game-plan route so the gate can't drift between them.
export function hasOriAccess(userId) {
  if (!userId || userId === "default") return true; // auth disabled (local dev)
  if (ORI_DEV_OPEN) {
    if (IS_PRODUCTION) return false; // never bypass Pro gate in production
    return true;
  }
  try {
    const user = reconcileUserPlan(userId) || getUserByUsername(userId);
    if (!user) {
      // Legacy env-password mode only when the DB has no user rows at all.
      // A valid session with no matching user (e.g. after admin delete) is denied.
      return userCount() === 0;
    }
    return !!user.is_admin || user.plan === "pro";
  } catch {
    return false;
  }
}
