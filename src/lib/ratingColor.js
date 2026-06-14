// FMP rating letter → colors + ordinal rank. FMP's top grade is "S" (above A),
// then A, B, C, D, F. Shared by the Ratings Snapshot and the screener column.

export function gradeColor(rating) {
  const g = (rating || "").trim().charAt(0).toUpperCase();
  switch (g) {
    case "S": return { bg: "#166534", fg: "#bbf7d0" }; // best — richer green than A
    case "A": return { bg: "#14532d", fg: "#86efac" };
    case "B": return { bg: "#1e3a2f", fg: "#6ee7b7" };
    case "C": return { bg: "#713f12", fg: "#fde68a" };
    case "D": return { bg: "#7c2d12", fg: "#fed7aa" };
    default:  return { bg: "#7f1d1d", fg: "#fca5a5" }; // F / unknown
  }
}

// Higher = better, for sorting. Missing/unknown → 0 (sorts to the bottom).
export const RATING_RANK = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 };
export function ratingRank(rating) {
  return RATING_RANK[(rating || "").trim().charAt(0).toUpperCase()] || 0;
}
