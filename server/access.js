import { reconcileUserPlan, getUserByUsername } from "./db.js";

// Explicit opt-in to bypass the Pro gate while developing (so the owner can
// exercise Ori on their own box without marking their account Pro). Off by
// default — set ORI_DEV_OPEN=1 in your local .env. Never set this on a deployed
// QA/prod environment; those stay strictly Pro-gated.
const ORI_DEV_OPEN = process.env.ORI_DEV_OPEN === "1" || process.env.ORI_DEV_OPEN === "true";

// ── Plan gating ─────────────────────────────────────────────────────────────
// Ori (the chat AND the Ori-powered Game Plan layer) is the Pro-tier feature:
// free accounts get the full screener / research / deterministic Game Plan;
// Pro ($10/month) unlocks Ori's intelligence. Admins always have access, as do
// the legacy single-user / env-auth modes (no user rows). Shared by the chat
// route and the game-plan route so the gate can't drift between them.
export function hasOriAccess(userId) {
  if (!userId || userId === "default") return true; // auth disabled (local dev)
  if (ORI_DEV_OPEN) return true; // explicit dev override
  try {
    const user = reconcileUserPlan(userId) || getUserByUsername(userId);
    if (!user) return true; // legacy AUTH_PASSWORD session — no DB user rows
    return !!user.is_admin || user.plan === "pro";
  } catch {
    return false;
  }
}
