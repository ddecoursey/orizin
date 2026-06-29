// The 7 structured intangible sub-factors Ori rates (see server/liteIntangibles.js
// and server/gamePlanPromptShared.js). The snake_case keys are the canonical
// machine names Ori returns in xFactors; these are the human-readable labels for
// UI display (GamePlan X-Factors list, OriTip screener tooltip).

export const INTANGIBLE_FACTOR_LABELS = {
  future_growth_potential: "Future Growth Potential",
  future_importance: "Future Importance",
  moat_strength: "Moat Strength",
  pricing_power_distribution: "Pricing Power / Distribution",
  management_execution: "Management Execution",
  ecosystem_dependence: "Ecosystem Dependence",
  innovation_velocity: "Innovation Velocity",
};

const LEGACY_INTANGIBLE_FACTOR_LABELS = {
  platform_infrastructure_potential: "Pricing Power / Distribution",
};

// Display label for an xFactor name. Handles the new snake_case keys, plus older
// cached Ori reviews that stored free-text human-readable factor names (e.g.
// "Market Dominance / Moat") — those are returned unchanged.
export function prettyFactorLabel(factor) {
  if (typeof factor !== "string" || !factor) return "";
  if (INTANGIBLE_FACTOR_LABELS[factor]) return INTANGIBLE_FACTOR_LABELS[factor];
  if (LEGACY_INTANGIBLE_FACTOR_LABELS[factor]) return LEGACY_INTANGIBLE_FACTOR_LABELS[factor];
  if (factor.includes("_")) {
    return factor.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return factor; // legacy human-readable cached value
}
