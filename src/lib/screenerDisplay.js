// Pure screener display helpers (tier columns, watchlist filter) — tested in isolation.

const COL_KEYS_PRO = [
  "pin", "symbol", "sector", "mcap", "price", "conviction", "durabilityProxy", "trend",
];

/** Column keys shown in the table: Pro keeps Conviction; free swaps to Orizin. */
export function displayColKeys(canUseOri) {
  if (canUseOri) return COL_KEYS_PRO;
  return COL_KEYS_PRO.map((k) => (k === "conviction" ? "orizin" : k));
}

/** Map sort key to row field (free users sort "orizin" on fundamentals score). */
export function resolveSortField(sortKey) {
  return sortKey === "orizin" ? "score" : sortKey;
}

/** Swap conviction column definition to Orizin for free tier tables. */
export function tierColumnDefs(cols, canUseOri) {
  if (canUseOri) return cols;
  return cols.map((c) =>
    c.key === "conviction" ? { ...c, key: "orizin", label: "Orizin" } : c,
  );
}

