import { getStock, saveQuote, touchQuote } from './db.js';
import { fetchQuote } from './fmp.js';
import { marketSession } from './marketHours.js';

export const WATCHLIST_QUOTE_STALE_MS = 5 * 60 * 1000;
export const WATCHLIST_QUOTES_MAX = 50;
export const WATCHLIST_QUOTES_LIVE_MAX = 20;

export function quoteFieldsFromRow(row) {
  if (!row?.symbol) return null;
  return {
    symbol: row.symbol,
    price: row.price ?? null,
    volume: row.volume ?? null,
    mcap: row.mcap ?? null,
    price_updated_at: row.price_updated_at ?? null,
  };
}

/** Refresh stale watchlist quotes from FMP; always returns the minimal quote payload. */
export async function refreshQuotesForSymbols(
  symbols,
  { staleMs = WATCHLIST_QUOTE_STALE_MS, maxLive = WATCHLIST_QUOTES_LIVE_MAX } = {},
) {
  const unique = [
    ...new Set(
      (symbols || [])
        .map((s) => String(s || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, WATCHLIST_QUOTES_MAX);

  const now = Date.now();
  const session = marketSession();
  const marketActive = session === 'open' || session === 'pre' || session === 'after';
  const needLive = [];

  for (const sym of unique) {
    const row = getStock(sym);
    if (!row) continue;
    const stale = !row.price_updated_at || now - row.price_updated_at > staleMs;
    if (stale && marketActive) needLive.push(sym);
  }

  await Promise.all(
    needLive.slice(0, maxLive).map(async (sym) => {
      try {
        const q = await fetchQuote(sym);
        if (q?.price != null) saveQuote(sym, q);
        else touchQuote(sym);
      } catch {
        touchQuote(sym);
      }
    }),
  );

  return unique.map((sym) => quoteFieldsFromRow(getStock(sym))).filter(Boolean);
}