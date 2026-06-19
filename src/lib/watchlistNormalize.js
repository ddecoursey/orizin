// Shared watchlist normalization (client settings + server sanitize stay aligned).

export const MAX_WATCHLISTS = 1;
export const MAX_WATCHLIST_SYMBOLS = 200;

export function defaultWatchlists() {
  return [{ id: "default", name: "Watchlist", symbols: [], updatedAt: Date.now() }];
}

/** One watchlist per user; legacy multi-list payloads merge into default. */
export function normalizeWatchlists(raw) {
  if (!Array.isArray(raw) || !raw.length) return defaultWatchlists();
  const seen = new Set();
  const symbols = [];
  let updatedAt = Date.now();
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    if (typeof w.updatedAt === "number") updatedAt = Math.max(updatedAt, w.updatedAt);
    if (!Array.isArray(w.symbols)) continue;
    for (const s of w.symbols) {
      const sym = String(s || "").trim().toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      symbols.push(sym);
    }
  }
  return [{
    id: "default",
    name: "Watchlist",
    symbols: symbols.slice(0, MAX_WATCHLIST_SYMBOLS),
    updatedAt,
  }];
}

/** Collect legacy per-tab pins (used only in migration tests). */
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

/** Migration helper — kept for tests; pins no longer merge into watchlists in the app. */
export function migratePinsIntoDefaultWatchlist(lists, tabs) {
  const norm = normalizeWatchlists(lists);
  const legacyPins = pinsFromTabs(tabs);
  const defaultWl = norm[0];
  if (!legacyPins.length || !defaultWl || defaultWl.symbols.length) return norm;
  return [{
    ...defaultWl,
    symbols: [...new Set([...defaultWl.symbols, ...legacyPins])].slice(0, MAX_WATCHLIST_SYMBOLS),
    updatedAt: Date.now(),
  }];
}