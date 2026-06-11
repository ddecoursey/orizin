// Billing constants — single source of truth for the upgrade flow.
// Payment is currently manual: the user pays via the donate link and the
// admin flips their account to Pro in User Management. When a real payment
// processor (Stripe etc.) lands, this is the only place the link changes.

export const DONATE_URL =
  "https://www.paypal.com/donate/?business=WSFPNM5GZ25GU&no_recurring=0&item_name=Orizen+Pro+subscription&currency_code=USD";

export const PRO_PRICE_LABEL = "$10/month";

export const PRO_FEATURES = [
  "Chat with Ori — portfolio-aware AI analyst",
  "Personalized memory across conversations",
  "Filter recommendations & deep-dive handoffs",
];

export const FREE_FEATURES = [
  "Full screener with Orizen Scores",
  "Deep Research pages",
  "Portfolios, goals & theses",
  "Watchlists, compare & news",
];
