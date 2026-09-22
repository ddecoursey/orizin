import { applyQuoteBatch, getMeta, setMeta } from './db.js';
import { fetchScreenerQuotes } from './fmp.js';
import { marketSession } from './marketHours.js';

// ─────────────────────────────────────────────────────────────────────────────
// Universe price sweep.
//
// The background enrichment job refreshes quotes one symbol per /quote call, so
// with a ~10k-row universe most names were only re-priced every ~6 hours, and a
// name last quoted at 1 PM kept that intraday price all night and all weekend.
// This sweep re-prices EVERY listed row from the paged company screener in a
// handful of calls, on a session-aware cadence:
//
//   open        every PRICE_SWEEP_OPEN_MIN   (default 10 min)
//   pre / after every PRICE_SWEEP_EXT_MIN    (default 30 min — catches the close)
//   closed      every PRICE_SWEEP_CLOSED_MIN (default 6 h — settles the close)
//
// plus one sweep whenever the session changes (open → after captures the close
// promptly). The per-symbol quote rotation stays as the fallback for anything
// the screener does not return (OTC / foreign listings) and as the live path for
// watchlists and the stock open in Deep Research.
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 60 * 1000;
const CHECK_EVERY_MS = MIN;
// A per-symbol quote younger than this when the sweep lands is kept — it is at
// least as fresh as the screener's snapshot.
const KEEP_LIVE_QUOTE_MS = 2 * MIN;

function envMinutes(name, dflt, lo, hi) {
  const v = Number(process.env[name]);
  const minutes = Number.isFinite(v) && v > 0 ? v : dflt;
  return Math.max(lo, Math.min(hi, minutes)) * MIN;
}

export function sweepIntervalMs(session) {
  if (session === 'open') return envMinutes('PRICE_SWEEP_OPEN_MIN', 10, 3, 120);
  if (session === 'pre' || session === 'after') return envMinutes('PRICE_SWEEP_EXT_MIN', 30, 5, 240);
  return envMinutes('PRICE_SWEEP_CLOSED_MIN', 360, 30, 24 * 60);
}

/** Pure scheduling decision — exported for tests. */
export function priceSweepDue({ session, lastAt, lastSession, now = Date.now() }) {
  if (!lastAt) return true;
  if (lastSession && lastSession !== session) return true;
  return now - lastAt >= sweepIntervalMs(session);
}

export function priceSweepEnabled(env = process.env) {
  if (env.PRICE_SWEEP_ENABLED === 'false') return false;
  // The E2E harness and "no background work" deployments turn this off too.
  if (env.ENABLE_BACKGROUND_ENRICH === 'false' && env.PRICE_SWEEP_ENABLED !== 'true') return false;
  const key = env.FMP_API_KEY;
  return !!key && key !== 'your_fmp_api_key_here';
}

const state = {
  running: false,
  lastAt: null,
  lastSession: null,
  lastCount: 0,
  lastReturned: 0,
  lastDurationMs: null,
  lastError: null,
  timer: null,
};

function hydrateFromMeta() {
  const at = Number(getMeta('price_sweep_at'));
  if (Number.isFinite(at) && at > 0) state.lastAt = at;
  state.lastSession = getMeta('price_sweep_session') || null;
}

export function getPriceSweepStatus() {
  return {
    enabled: !!state.timer,
    running: state.running,
    lastAt: state.lastAt,
    lastSession: state.lastSession,
    lastCount: state.lastCount,
    lastReturned: state.lastReturned,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError,
  };
}

/**
 * Run one sweep now. Concurrent callers share a single pass; returns the
 * number of rows re-priced (0 when a sweep was already running).
 */
export async function runPriceSweep({ fetchQuotes = fetchScreenerQuotes, now = () => Date.now() } = {}) {
  if (state.running) return 0;
  state.running = true;
  const started = now();
  const session = marketSession(new Date(started));
  try {
    const quotes = await fetchQuotes();
    const at = now();
    const updated = applyQuoteBatch(quotes, { at, skipNewerThan: at - KEEP_LIVE_QUOTE_MS });
    state.lastAt = at;
    state.lastSession = session;
    state.lastCount = updated;
    state.lastReturned = quotes.length;
    state.lastDurationMs = at - started;
    state.lastError = null;
    setMeta('price_sweep_at', at);
    setMeta('price_sweep_session', session);
    console.log(`[priceSweep] ${session}: re-priced ${updated} rows from ${quotes.length} screener quotes in ${Math.round((at - started) / 1000)}s`);
    return updated;
  } catch (e) {
    // Record the attempt so a failing upstream is retried on the normal cadence
    // instead of every minute, but keep lastAt so the UI still shows real age.
    state.lastError = String(e?.message || e).slice(0, 200);
    state.lastSession = session;
    state.lastAttemptAt = started;
    console.warn('[priceSweep] failed:', state.lastError);
    return 0;
  } finally {
    state.running = false;
  }
}

async function tick() {
  const now = Date.now();
  const session = marketSession(new Date(now));
  // After a failure, wait a normal interval from the failed attempt.
  const lastAt = Math.max(state.lastAt || 0, state.lastAttemptAt || 0) || null;
  if (!priceSweepDue({ session, lastAt, lastSession: state.lastSession, now })) return;
  await runPriceSweep();
}

export function startPriceSweep() {
  if (state.timer || !priceSweepEnabled()) {
    if (!state.timer) console.log('[priceSweep] disabled');
    return;
  }
  try { hydrateFromMeta(); } catch { /* fresh DB */ }
  // First check shortly after boot, off the startup path.
  setTimeout(() => { tick().catch(() => {}); }, 15_000).unref?.();
  state.timer = setInterval(() => { tick().catch(() => {}); }, CHECK_EVERY_MS);
  state.timer.unref?.();
  console.log('[priceSweep] universe price sweep scheduled');
}

export function stopPriceSweep() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/** Test hook. */
export function _resetPriceSweepForTests() {
  stopPriceSweep();
  Object.assign(state, {
    running: false, lastAt: null, lastSession: null, lastCount: 0, lastReturned: 0,
    lastDurationMs: null, lastError: null, lastAttemptAt: null,
  });
}
