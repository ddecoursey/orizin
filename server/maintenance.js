import * as db from './db.js';
import { getPriceSweepStatus } from './priceSweep.js';
import { marketSession } from './marketHours.js';

// ─────────────────────────────────────────────────────────────────────────────
// Daily data maintenance — lets the app run for years without hand-pruning.
//
// Market-data refreshes UPDATE rows in place (stocks, sparklines, kv_cache,
// ai_enrichment are all keyed by symbol), so the DB does not grow with every
// refresh. What DID grow without bound, and what this job bounds:
//
//   dark listings     delisted / renamed symbols stayed in `stocks` forever,
//                     showed stale prices in the screener and kept costing
//                     background FMP calls. Removed after STOCK_RETENTION_DAYS
//                     (default 45) with no price from any source. Guarded:
//                     only while the price sweep is healthy, only after this
//                     database has been tracked for a full retention window,
//                     never within 3 days of a restart, never for a symbol any
//                     user watches / holds / uses in a strategy, and at most
//                     ~2% of the universe per day.
//   orphan data       sparklines + analyst data for symbols no longer listed
//                     (30-day grace, so Deep Research on an off-universe symbol
//                     keeps its cached chart for a while).
//   universe blobs    a 1–2 MB cached universe per scope / market-cap floor in
//                     `meta`, never deleted; dropped once past their 24 h TTL.
//   email counters    one `email_sent:<day>` row per day; kept 30 days.
//   kv_cache          detail + Ori caches older than 14 days (was already
//                     purged daily in routes/stocks.js; consolidated here).
//   chat sessions     newest 200 per user.
//   sim. orders       newest 1,000 finished orders per user.
//   alert state       rows for symbols a user no longer watches.
//   SQLite            PRAGMA optimize + WAL truncate daily; a VACUUM on a
//                     closed-market Sunday only when ≥25% / ≥64 MB is free.
//
// Already bounded elsewhere (hourly in index.js): expired sessions, login
// events (90 d), Ori usage ledger (~95 d), billing checkout tokens.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;

function envInt(name, dflt, lo, hi) {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : dflt));
}

export function retentionConfig(env = process.env) {
  const read = (name, dflt, lo, hi) => {
    const v = Number.parseInt(env[name] || '', 10);
    return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : dflt));
  };
  return {
    stockDays: read('STOCK_RETENTION_DAYS', 45, 14, 3650),
    orphanDays: 30,
    cacheDays: 14,
    metaCacheHours: 48,
    emailDays: 30,
    chatSessionsPerUser: read('CHAT_SESSIONS_PER_USER', 200, 20, 5000),
    ordersPerUser: 1000,
    vacuum: env.MAINTENANCE_VACUUM !== 'false',
  };
}

// Every symbol some user still depends on: watchlists, portfolio holdings and
// strategy universes / paper holdings. Retention never removes these listings.
export function referencedSymbols(rows = db.listAllUserSettingsRows()) {
  const all = new Set();
  const watchedByUser = new Map();
  const add = (set, s) => {
    const sym = String(s || '').trim().toUpperCase();
    if (sym) set.add(sym);
  };
  for (const row of rows) {
    let data;
    try { data = JSON.parse(row.data || '{}'); } catch { continue; }
    const watched = new Set();
    for (const wl of Array.isArray(data.watchlists) ? data.watchlists : []) {
      for (const s of Array.isArray(wl?.symbols) ? wl.symbols : []) add(watched, s);
    }
    watchedByUser.set(row.user_id, watched);
    for (const s of watched) all.add(s);
    for (const p of Array.isArray(data.portfolios) ? data.portfolios : []) {
      for (const h of Array.isArray(p?.holdings) ? p.holdings : []) add(all, h?.ticker);
    }
    for (const st of Array.isArray(data.strategies) ? data.strategies : []) {
      for (const s of Array.isArray(st?.universe?.symbols) ? st.universe.symbols : []) add(all, s);
      for (const h of Array.isArray(st?.paper?.holdings) ? st.paper.holdings : []) add(all, h?.symbol);
    }
  }
  return { all, watchedByUser };
}

/** Remove listings nothing has priced in `stockDays`, under strict guards. */
export function pruneDarkListings({
  now = Date.now(),
  stockDays,
  keep = new Set(),
  sweep = getPriceSweepStatus(),
  stockCount = db.getStockCount(),
  trackingSince = trackingStart(now),
  uptimeMs = process.uptime() * 1000,
} = {}) {
  // Only trust "no price for N days" while the universe price sweep is
  // actually landing; during an FMP outage every row would look dark.
  const sweepHealthy = sweep?.lastAt && now - sweep.lastAt < 36 * 60 * 60 * 1000 && (sweep.lastCount || 0) >= 500;
  if (!sweepHealthy) return { removed: 0, skipped: 'price sweep not healthy' };
  // price_seen_at only means something once this code has watched prices for
  // the whole retention window (it was backfilled from older clocks), and the
  // per-symbol quote rotation needs a few days after a restart to reach every
  // listing the sweep doesn't cover (OTC / foreign).
  if (now - trackingSince < stockDays * DAY) return { removed: 0, skipped: 'still inside the first retention window' };
  if (uptimeMs < 3 * DAY) return { removed: 0, skipped: 'server up less than 3 days' };
  // Never more than ~2% of the universe in one day (min 50, max 300).
  const cap = Math.max(50, Math.min(300, Math.floor(stockCount * 0.02)));
  const candidates = db.getDarkListings(now - stockDays * DAY, cap * 3).filter((s) => !keep.has(s)).slice(0, cap);
  const removed = candidates.length ? db.deleteListings(candidates) : 0;
  return { removed, symbols: candidates.slice(0, 25) };
}

// When retention tracking began (first maintenance run on this database).
function trackingStart(now) {
  try {
    const at = Number(db.getMeta('retention_tracking_since'));
    if (Number.isFinite(at) && at > 0) return at;
    db.setMeta('retention_tracking_since', now);
  } catch { /* fall through */ }
  return now;
}

function step(report, name, fn) {
  try {
    report[name] = fn();
  } catch (e) {
    report[name] = { error: String(e?.message || e).slice(0, 200) };
  }
}

export function runMaintenance({ now = Date.now(), config = retentionConfig(), allowVacuum = false } = {}) {
  const started = Date.now();
  const report = { at: now };
  const refs = referencedSymbols();

  step(report, 'darkListings', () => pruneDarkListings({ now, stockDays: config.stockDays, keep: refs.all }));
  step(report, 'orphanMarketData', () => db.pruneOrphanMarketData(now - config.orphanDays * DAY));
  step(report, 'kvCache', () => ({ removed: db.kvPurgeOlderThan(config.cacheDays * DAY) }));
  step(report, 'metaCaches', () => {
    const emailBeforeDay = new Date(now - config.emailDays * DAY).toISOString().slice(0, 10);
    return { removed: db.pruneStaleMetaCaches(now - config.metaCacheHours * 60 * 60 * 1000, { emailBeforeDay }) };
  });
  step(report, 'chatSessions', () => ({ removed: db.capChatSessionsPerUser(config.chatSessionsPerUser) }));
  step(report, 'brokerageOrders', () => ({ removed: db.capBrokerageOrdersPerUser(config.ordersPerUser) }));
  step(report, 'watchlistAlertState', () => ({ removed: db.pruneWatchlistAlertStates(refs.watchedByUser) }));
  step(report, 'sqlite', () => db.sqliteHousekeeping({ vacuum: allowVacuum && config.vacuum }));

  report.durationMs = Date.now() - started;
  try { db.setMeta('maintenance_last', JSON.stringify(report)); } catch { /* status only */ }
  return report;
}

export function getMaintenanceStatus() {
  try {
    const raw = db.getMeta('maintenance_last');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// A full VACUUM rewrites the whole file and briefly blocks writers, so it only
// runs on a Sunday while the US market is closed, at most once a week.
function vacuumWindow(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now);
  if (day !== 'Sun' || marketSession(now) !== 'closed') return false;
  const last = Number(db.getMeta('maintenance_vacuum_at'));
  return !Number.isFinite(last) || now.getTime() - last > 6 * DAY;
}

let timer = null;
function tick() {
  const allowVacuum = vacuumWindow();
  const report = runMaintenance({ allowVacuum });
  if (report.sqlite?.vacuumed) db.setMeta('maintenance_vacuum_at', Date.now());
  const removed = Object.entries(report)
    .map(([k, v]) => (v && typeof v === 'object' && Number(v.removed) > 0 ? `${k}=${v.removed}` : null))
    .filter(Boolean);
  console.log(`[maintenance] done in ${report.durationMs}ms${removed.length ? ` — removed ${removed.join(', ')}` : ''}${report.sqlite?.vacuumed ? ' — vacuumed' : ''}`);
}

export function startMaintenance() {
  if (timer || process.env.MAINTENANCE_ENABLED === 'false') return;
  const intervalMs = envInt('MAINTENANCE_INTERVAL_HOURS', 24, 1, 168) * 60 * 60 * 1000;
  setTimeout(() => { try { tick(); } catch (e) { console.error('[maintenance] failed:', e.message); } }, FIRST_RUN_DELAY_MS).unref?.();
  timer = setInterval(() => { try { tick(); } catch (e) { console.error('[maintenance] failed:', e.message); } }, intervalMs);
  timer.unref?.();
}

export function stopMaintenance() {
  if (timer) clearInterval(timer);
  timer = null;
}
