// Thematic rank names for Orizin tiers. Server plans stay free | pro | ultimate;
// UI shows rank + familiar label (Free / Pro / Ultimate) side by side.

export const RANKS = {
  traveler: {
    id: "traveler",
    plan: "free",
    name: "Traveler",
    label: "Free",
    tagline: "Explore the market",
    accentText: "text-slate-300",
    accentBg: "bg-slate-800/80",
    accentBorder: "border-slate-600/50",
    ringGradient: "from-slate-400 to-blue-500",
    ringStroke: "rgba(148,163,184,0.65)",
    fabGlow: "rgba(148,163,184,0.45)",
    fabHelmet: {
      visorDeep: "#1e3a8a",
      visor: "#3b82f6",
      visorBright: "#93c5fd",
      glow: "rgba(148,163,184,0.42)",
      focus: "#94a3b8",
    },
    dotClass: "bg-slate-400",
    headerAccent: "from-transparent via-slate-400/72 to-transparent",
  },
  voyager: {
    id: "voyager",
    plan: "pro",
    name: "Voyager",
    label: "Pro",
    tagline: "Ori at your side",
    accentText: "text-violet-300",
    accentBg: "bg-violet-900/60",
    accentBorder: "border-violet-700/50",
    ringGradient: "from-violet-400 to-fuchsia-500",
    ringStroke: "rgba(167,139,250,0.75)",
    fabGlow: "rgba(129,140,248,0.55)",
    fabHelmet: {
      visorDeep: "#4c1d95",
      visor: "#7c3aed",
      visorBright: "#c4b5fd",
      glow: "rgba(129,140,248,0.48)",
      focus: "#a78bfa",
    },
    dotClass: "bg-violet-400",
    headerAccent: "from-transparent via-violet-400/85 to-transparent",
  },
  starfarer: {
    id: "starfarer",
    plan: "ultimate",
    name: "Starfarer",
    label: "Ultimate",
    tagline: "Maximum Ori — coming soon",
    comingSoon: true,
    accentText: "text-amber-200",
    accentBg: "bg-amber-950/50",
    accentBorder: "border-amber-700/40",
    ringGradient: "from-amber-300 to-orange-500",
    ringStroke: "rgba(251,191,36,0.75)",
    fabGlow: "rgba(251,191,36,0.5)",
    fabHelmet: {
      visorDeep: "#92400e",
      visor: "#f59e0b",
      visorBright: "#fde68a",
      glow: "rgba(251,191,36,0.48)",
      focus: "#fbbf24",
    },
    dotClass: "bg-amber-400",
    headerAccent: "from-transparent via-amber-400/85 to-transparent",
  },
  admin: {
    id: "admin",
    plan: "admin",
    name: "Helmsman",
    label: "Admin",
    tagline: "Full access",
    accentText: "text-emerald-300",
    accentBg: "bg-emerald-900/60",
    accentBorder: "border-emerald-700/50",
    ringGradient: "from-emerald-400 to-teal-500",
    ringStroke: "rgba(52,211,153,0.75)",
    fabGlow: "rgba(52,211,153,0.5)",
    fabHelmet: {
      visorDeep: "#064e3b",
      visor: "#059669",
      visorBright: "#6ee7b7",
      glow: "rgba(52,211,153,0.45)",
      focus: "#34d399",
    },
    dotClass: "bg-emerald-400",
    headerAccent: "from-transparent via-emerald-400/85 to-transparent",
  },
};

/** Session plan from API: free | pro | ultimate. */
export function parseSessionPlan(plan) {
  const p = String(plan || "free").toLowerCase();
  if (p === "ultimate" || p === "starfarer") return "ultimate";
  if (p === "pro" || p === "voyager") return "pro";
  return "free";
}

export function hasOriAccess({ plan = "free", isAdmin = false } = {}) {
  return isAdmin || parseSessionPlan(plan) !== "free";
}

/** Resolve display rank from session plan + admin flag. */
export function resolveRank({ plan = "free", isAdmin = false } = {}) {
  if (isAdmin) return RANKS.admin;
  const p = String(plan || "free").toLowerCase();
  if (p === "ultimate" || p === "starfarer") return RANKS.starfarer;
  if (p === "pro" || p === "voyager") return RANKS.voyager;
  return RANKS.traveler;
}

export function rankForPlan(plan) {
  return resolveRank({ plan, isAdmin: false });
}

/** Upgrade CTA copy — rank name with label for clarity. */
export function upgradeCta(rank = RANKS.voyager, price = "$10/mo") {
  return `Become a ${rank.name} (${rank.label}) — ${price}`;
}