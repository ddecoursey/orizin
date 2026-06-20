import { normalizeWatchlists } from '../src/lib/watchlistNormalize.js';
import * as db from './db.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_UNION = Number(process.env.WATCHLIST_ENRICH_MAX_UNION) || 500;

let cached = { symbols: [], at: 0 };

export function invalidateWatchlistUnionCache() {
  cached = { symbols: [], at: 0 };
}

/** Union of all symbols on any user's watchlist (deduped, capped). */
export function getUnionWatchlistSymbols({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached.symbols.length && now - cached.at < CACHE_TTL_MS) {
    return cached.symbols;
  }

  const rows = db.listAllUserSettingsRows?.() || [];
  const set = new Set();
  for (const row of rows) {
    try {
      const data = row.data ? JSON.parse(row.data) : {};
      const lists = normalizeWatchlists(data.watchlists);
      for (const sym of lists[0]?.symbols || []) set.add(sym);
    } catch {
      // skip malformed blobs
    }
  }

  let symbols = [...set];
  if (symbols.length > MAX_UNION) {
    console.warn(`[watchlist] Union has ${symbols.length} symbols; capping at ${MAX_UNION}`);
    symbols = symbols.slice(0, MAX_UNION);
  }

  cached = { symbols, at: now };
  return symbols;
}