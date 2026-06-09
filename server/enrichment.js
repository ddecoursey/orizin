import * as db from './db.js';
import {
  fetchKeyMetrics,
  fetchRatios,
  fetchHistoricalPricesLight,
  fetchProfile,
  fetchQuote,
  profileToRow,
} from './fmp.js';
import { logError } from './logger.js';
import { marketSession } from './marketHours.js';

// Background continuous enrichment manager.
// Runs at low sustained rate (e.g. 150-200 rpm) to keep the universe fresh
// without user-triggered long jobs, and spends quota where it matters:
//
//   market OPEN   → missing-data backlog + live quote refresh (top names every
//                   ~30 min, the whole priced universe on a ~6 h rotation) +
//                   stale-fundamentals refresh with whatever budget is left.
//   pre/after     → backlog + a slow price rotation (catch the open/close moves).
//   CLOSED        → backlog + fundamentals only, at a reduced pace. No quote
//                   churn overnight or on weekends — prices aren't moving, so
//                   those FMP calls would be pure waste.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Price refresh tiers (regular session)
const TOP_TIER_COUNT = 500;                 // biggest names by mcap
const TOP_TIER_STALE_MS = 30 * 60 * 1000;   // refresh their quotes every ~30 min
const TAIL_STALE_MS = 6 * 60 * 60 * 1000;   // everything else ~ once per session
const EXTENDED_STALE_MS = 2 * 60 * 60 * 1000; // pre/after-hours top-tier pace

class EnrichmentManager {
  constructor() {
    this.running = false;
    this.targetRpm = parseInt(process.env.BACKGROUND_ENRICH_RPM || '150', 10);
    this.concurrency = 2; // low to be nice to FMP
    this.processed = 0;
    this.quotesRefreshed = 0;
    this.errors = 0;
    this.lastSymbol = null;
    this.lastUpdate = null;
    this.recentActivity = []; // { symbol, status: 'ok'|'err', ts, message? } last 30
    this._pacerNext = 0;
    this._loopPromise = null;
    this._stopped = false;
  }

  setRpm(rpm) {
    this.targetRpm = Math.max(20, Math.min(250, Math.floor(rpm)));
  }

  getStatus() {
    const missing = db.getMissingEnrichCount ? db.getMissingEnrichCount() : 0;
    return {
      running: this.running,
      targetRpm: this.targetRpm,
      concurrency: this.concurrency,
      processed: this.processed,
      quotesRefreshed: this.quotesRefreshed || 0,
      errors: this.errors,
      lastSymbol: this.lastSymbol,
      lastUpdate: this.lastUpdate,
      missingCount: missing,
      marketSession: marketSession(),
      recent: this.recentActivity.slice(0, 15),
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._stopped = false;
    console.log(`[Enrichment] Background job starting at ${this.targetRpm} rpm`);
    this._loopPromise = this._runLoop();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this._stopped = true;
    console.log('[Enrichment] Background job stopping...');
  }

  async _claimSlot() {
    const minMs = Math.floor(60000 / this.targetRpm);
    const now = Date.now();
    let wait = this._pacerNext - now;
    if (wait > 0) {
      await sleep(wait);
    }
    this._pacerNext = Date.now() + minMs;
  }

  _logActivity(symbol, status, message = null) {
    const entry = {
      symbol,
      status, // 'ok' or 'err'
      ts: Date.now(),
      message: message ? String(message).slice(0, 120) : null,
    };
    this.recentActivity.unshift(entry);
    if (this.recentActivity.length > 30) this.recentActivity.pop();
  }

  // refresh=true (maintenance pass): re-fetch km/rat even if already present, so
  // stale metrics on enriched rows actually get updated.
  async _processOne(symbol, refresh = false) {
    const row = db.getStock(symbol);
    if (!row) return;

    let didWork = false;
    // Freshest mcap for this symbol — updated by the profile backfill below so the
    // km-derived metrics use it instead of the stale snapshot (which is null for a
    // symbol that only just arrived via the list-based universe refresh).
    let mcap = row.mcap ?? null;

    // Backfill basic profile data (price, mcap, sector, industry, exchange, country, etc.)
    // if missing. This is needed because the list-based universe refresh only provides
    // symbol + name (for performance with 38k+ entities). Force gather and this
    // background now populate the missing fields via profile.
    const needsBasic = !row.price || !row.mcap || !row.sector || row.sector === '—';
    if (needsBasic) {
      try {
        const prof = await fetchProfile(symbol, { maxRetries: 1, timeoutMs: 10000 });
        if (prof) {
          const profRow = profileToRow(prof);
          db.saveScreenerBatch([profRow]);
          if (profRow.mcap != null) mcap = profRow.mcap;
          didWork = true;
        }
      } catch (e) {
        console.warn(`[BackgroundEnrich] Profile backfill failed for ${symbol}:`, e.message);
      }
    }

    const needKm = refresh || !row.has_km;
    const needRat = refresh || !row.has_rat;

    try {
      if (needKm) {
        const km = await fetchKeyMetrics(symbol, { maxRetries: 2, timeoutMs: 12000 });
        if (km) {
          if (km._haveEv && km._ev && mcap) {
            // same derivations as main enrich
            const ev = km._ev;
            if (km.earnings_yield != null && km.ev_sales != null)
              km.net_margin = (mcap * km.earnings_yield * km.ev_sales) / ev;
            if (km.fcf_yield != null && km.ev_sales != null)
              km.fcf_margin = (mcap * km.fcf_yield * km.ev_sales) / ev;
            if (km.ev_sales != null) km.ps = (mcap * km.ev_sales) / ev;
          }
          delete km._ev;
          delete km._haveEv;
          db.saveKm(symbol, km);
          didWork = true;
        }
      }

      if (needRat) {
        const rat = await fetchRatios(symbol, { maxRetries: 2, timeoutMs: 12000 });
        if (rat) {
          const updated = db.getStock(symbol);
          if (updated?.ev_sales != null && rat.gross_margin != null && rat.gross_margin > 0)
            rat.ev_gp = updated.ev_sales / rat.gross_margin;
          db.saveRat(symbol, rat);
          didWork = true;
        }
      }

      // Occasionally refresh a sparkline if very old (background maintenance)
      const spark = db.getSparkline ? db.getSparkline(symbol, 45) : null;
      const sparkAge = spark ? (Date.now() - (spark.updated_at || 0)) : Infinity;
      if (sparkAge > 7 * 24 * 3600 * 1000) { // older than 7 days
        try {
          const data = await fetchHistoricalPricesLight(symbol, 45);
          if (data && data.length) {
            db.saveSparkline(symbol, 45, data);
          }
        } catch (e) {
          // non-fatal for background
        }
      }

      if (didWork) {
        this.processed++;
        this.lastSymbol = symbol;
        this.lastUpdate = new Date().toISOString();
        this._logActivity(symbol, 'ok');
      }
    } catch (e) {
      const errMsg = e.message || String(e);
      this.errors++;
      this._logActivity(symbol, 'err', errMsg);
      // Only log non-429 to the debug log during background (429s are normal pacer)
      if (!errMsg.includes('429') && !errMsg.includes('Too Many')) {
        logError(`[BackgroundEnrich] ${symbol}`, { symbol, error: errMsg });
      }
    }

    // If the attempt produced no new data (un-enrichable symbol, or a maintenance
    // pass that returned nothing), still advance updated_at so the rotation moves on
    // and this symbol enters its cooldown — otherwise the loop re-selects it forever.
    // Enrichable symbols already advanced it via saveKm/saveRat/saveScreenerBatch.
    if (!didWork) {
      try { db.touchStock?.(symbol); } catch {}
    }
  }

  // One quote call: update price/volume/mcap + price_updated_at only (never
  // updated_at, which drives the fundamentals rotation).
  async _refreshQuote(symbol) {
    try {
      const q = await fetchQuote(symbol);
      if (q && q.price != null) {
        db.saveQuote(symbol, q);
        this.quotesRefreshed = (this.quotesRefreshed || 0) + 1;
        this.lastSymbol = symbol;
        this.lastUpdate = new Date().toISOString();
      } else {
        // No quote (delisted/unsupported) — advance its clock so the rotation
        // doesn't re-pick it all day.
        db.touchQuote?.(symbol);
      }
    } catch (e) {
      db.touchQuote?.(symbol);
      this.errors++;
      this._logActivity(symbol, 'err', e.message);
    }
  }

  // Build this tick's work list based on the current US market session.
  _buildWork() {
    const session = marketSession();
    const work = [];

    // 1. Missing core data is always first priority (smaller slice when the
    //    market is open so quotes get budget too).
    const missingBudget = session === 'open' ? 4 : 8;
    const missing = db.getMissingEnrichDue ? db.getMissingEnrichDue(missingBudget) : [];
    for (const s of missing) work.push({ symbol: s, kind: 'enrich', refresh: false });

    // 2. Live quotes while the market is trading (and a slower trickle in
    //    pre/after hours to capture the open/close). Nothing overnight/weekends.
    if (session === 'open') {
      const top = db.getTopPriceRefreshDue?.(TOP_TIER_COUNT, TOP_TIER_STALE_MS, 8) || [];
      const tail = db.getAnyPriceRefreshDue?.(TAIL_STALE_MS, 6) || [];
      const seen = new Set(work.map((w) => w.symbol));
      for (const s of [...top, ...tail]) {
        if (seen.has(s)) continue;
        seen.add(s);
        work.push({ symbol: s, kind: 'quote' });
      }
    } else if (session === 'pre' || session === 'after') {
      const top = db.getTopPriceRefreshDue?.(TOP_TIER_COUNT, EXTENDED_STALE_MS, 4) || [];
      const seen = new Set(work.map((w) => w.symbol));
      for (const s of top) {
        if (seen.has(s)) continue;
        seen.add(s);
        work.push({ symbol: s, kind: 'quote' });
      }
    }

    // 3. Spare budget → refresh the stalest already-enriched fundamentals.
    if (work.length < 12) {
      const stale = db.getStaleEnriched ? db.getStaleEnriched(12 - work.length) : [];
      const seen = new Set(work.map((w) => w.symbol));
      for (const s of stale) {
        if (seen.has(s)) continue;
        seen.add(s);
        work.push({ symbol: s, kind: 'enrich', refresh: true });
      }
    }

    return { session, work };
  }

  async _runLoop() {
    while (!this._stopped) {
      try {
        const { session, work } = this._buildWork();

        if (work.length === 0) {
          // Nothing missing, nothing stale, no quotes due — idle. Check back
          // sooner during trading hours, lazily when the market is closed.
          await sleep(session === 'open' ? 15000 : 60000);
          continue;
        }

        const batch = work.slice(0, this.concurrency * 6);
        for (const item of batch) {
          if (this._stopped) break;
          await this._claimSlot();
          if (item.kind === 'quote') {
            await this._refreshQuote(item.symbol);
          } else {
            await this._processOne(item.symbol, item.refresh);
          }
        }

        // Throttle the outer loop a little so we don't spin when queue is small.
        // Off-hours runs at half pace — the backlog isn't urgent at 2 AM.
        const base = Math.max(3000, Math.floor(60000 / this.targetRpm) * 2);
        await sleep(session === 'closed' ? base * 2 : base);
      } catch (loopErr) {
        console.error('[Enrichment] Background loop error (will continue):', loopErr);
        await sleep(10000);
      }
    }
    console.log('[Enrichment] Background job stopped.');
  }
}

export const enrichmentManager = new EnrichmentManager();

// Helper to start on boot (called from index.js)
export function startBackgroundEnrichmentIfEnabled() {
  const enabled = process.env.ENABLE_BACKGROUND_ENRICH !== 'false';
  if (enabled) {
    enrichmentManager.start();
  } else {
    console.log('[Enrichment] Background enrichment disabled via env');
  }
}
