// Shared watchlist normalization (client settings + server sanitize stay aligned).

export const MAX_WATCHLISTS = 12;
export const MAX_WATCHLIST_SYMBOLS = 200;

export function defaultWatchlists() {
  return [{ id: "default", name: "Watchlist", symbols: [], updatedAt: Date.now() }];
}

export function normalizeWatchlists(raw) {
  if (!Array.isArray(raw) || !raw.length) return defaultWatchlists();
  return raw.slice(0, MAX_WATCHLISTS).map((w) => {
    if (!w || typeof w !== "object") return null;
    const id = typeof w.id === "string" ? w.id.slice(0, 64) : null;
    const name = typeof w.name === "string" ? w.name.slice(0, 28) : "Watchlist";
    const symbols = Array.isArray(w.symbols)
      ? [...new Set(w.symbols.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))].slice(0, MAX_WATCHLIST_SYMBOLS)
      : [];
    if (!id) return null;
    return { id, name, symbols, updatedAt: w.updatedAt || Date.now() };
  }).filter(Boolean);
}

/** Collect legacy per-tab pins for one-time migration into the default watchlist. */
export function pinsFromTabs(tabs) {
  const out = new Set();
  for (const t of tabs || []) {
    for (const s of t?.state?.pins || []) {
      const sym = String(s || "").trim().toUpperCase();
      if (sym) out.add(sym);
    }
  }
  return [...out];
}

/** Migration: merge tab pins into default list when default is empty. */
export function migratePinsIntoDefaultWatchlist(lists, tabs) {
  const norm = normalizeWatchlists(lists);
  const legacyPins = pinsFromTabs(tabs);
  const defaultWl = norm.find((w) => w.id === "default");
  if (!legacyPins.length || !defaultWl || defaultWl.symbols.length) return norm;
  return norm.map((w) =>
    w.id === "default" ? { ...w, symbols: legacyPins, updatedAt: Date.now() } : w,
  );
}