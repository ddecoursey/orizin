// Billing constants — copy + feature lists for the upgrade flow.
//
// The PayPal client id, plan id, and environment (sandbox/live) are NOT kept
// here. They are served at runtime from GET /api/billing/config (sourced from
// server env vars), so secrets never live in the client bundle or the repo and
// the same build works for both sandbox (local) and live (Railway).
//
// The PayPal JS SDK is loaded *dynamically* by UpgradeModal using the
// server-provided clientId (never a static script tag in index.html). This
// prevents loading a sandbox SDK on production deploys, which was causing
// parse errors and blank pages when the PayPal button tried to initialize.

export const PRO_PRICE_LABEL = "$10/month";

export const PRO_FEATURES = [
  "Chat with Ori — portfolio-aware AI analyst",
  "Personalized memory across conversations",
  "Filter recommendations & deep-dive handoffs",
];

export const FREE_FEATURES = [
  "Full screener with Conviction scores",
  "Deep Research pages",
  "Portfolios, goals & theses",
  "Watchlists, compare & news",
];

// Legacy one-off donation link — kept only as a manual fallback.
export const DONATE_URL =
  "https://www.paypal.com/donate/?business=WSFPNM5GZ25GU&no_recurring=0&item_name=Orizin+Pro+subscription&currency_code=USD";
