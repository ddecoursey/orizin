// Pure screener display helpers — tested in isolation.

const COL_KEYS = [
  "pin", "symbol", "sector", "mcap", "price", "conviction", "durabilityProxy", "trend",
];

/** Column keys shown in the screener table (Conviction for all tiers). */
export function displayColKeys() {
  return COL_KEYS;
}

/** Map sort key to row field. */
export function resolveSortField(sortKey) {
  return sortKey;
}

/** Column definitions — Conviction for every user; Pro adds Ori badge in cells. */
export function tierColumnDefs(cols) {
  return cols;
}