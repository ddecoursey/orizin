import * as db from './db.js';
import { fetchStockNews } from './fmp.js';
import { quickConviction } from '../src/lib/verdict.js';
import { normalizeWatchlists } from '../src/lib/watchlistNormalize.js';
import { sanitizeWatchlistAlerts } from '../src/lib/watchlistAlertsConfig.js';
import { marketSession, etSessionDate } from './marketHours.js';
import { sendEmail, watchlistDigestEmail, watchlistUrgentEmail } from './email.js';

const COOLDOWN_MS = 4 * 60 * 60 * 1000;
const CONVICTION_DELTA = 8;
const NEWS_CACHE_MS = 30 * 60 * 1000;
const MAX_DIGEST_ITEMS = 10;
const MAX_NEWS_PER_SYMBOL = 3;
const MAX_URGENT_EMAILS_DAY = 2;

const newsCache = new Map();

function userEmail(user) {
  if (!user) return null;
  const e = user.email || user.username;
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function priceThresholdPct(prefs, session) {
  const base = prefs.priceThresholdPct ?? 5;
  return session === 'open' ? base : base + 2;
}

function canFire(cooldowns, type, now) {
  const last = cooldowns?.[type];
  return !last || now - last >= COOLDOWN_MS;
}

function markCooldown(cooldowns, type, now) {
  return { ...cooldowns, [type]: now };
}

async function cachedNews(symbol) {
  const hit = newsCache.get(symbol);
  if (hit && Date.now() - hit.at < NEWS_CACHE_MS) return hit.items;
  const items = await fetchStockNews(symbol, { limit: 8 });
  newsCache.set(symbol, { at: Date.now(), items });
  return items;
}

function convictionForRow(row) {
  const c = quickConviction(row);
  return c != null && Number.isFinite(c) ? Math.round(c) : null;
}

function ensureBaseline(state, row, sessionDate) {
  const price = row?.price;
  if (!Number.isFinite(price)) return state;
  if (state.baseline_session_date !== sessionDate || state.baseline_price == null) {
    return {
      ...state,
      baseline_price: price,
      baseline_session_date: sessionDate,
      last_price: price,
    };
  }
  return { ...state, last_price: price };
}

function queueAlert(state, alert) {
  const pending = [...(state.pending_digest || []), alert].slice(-MAX_DIGEST_ITEMS);
  return { ...state, pending_digest: pending };
}

function buildSnapshots(userId, symbols, stockMap) {
  const out = {};
  for (const sym of symbols) {
    const row = stockMap.get(sym);
    const st = db.getWatchlistAlertState(userId, sym);
    const price = row?.price;
    const baseline = st?.baseline_price;
    const pct = pctChange(baseline, price);
    out[sym] = {
      price: price ?? null,
      baselinePrice: baseline ?? null,
      pctSession: pct != null ? Math.round(pct * 10) / 10 : null,
      priceUpdatedAt: row?.price_updated_at ?? null,
      dataUpdatedAt: row?.updated_at ?? null,
    };
  }
  return out;
}

/** Scan all users' watchlists and evaluate alert rules. */
export async function runWatchlistAlertScan() {
  const session = marketSession();
  const sessionDate = etSessionDate();
  const now = Date.now();
  const rows = db.listAllUserSettingsRows();

  for (const { user_id: userId, data: raw } of rows) {
    let settings;
    try {
      settings = raw ? JSON.parse(raw) : {};
    } catch {
      continue;
    }
    const prefs = sanitizeWatchlistAlerts(settings.watchlistAlerts);
    if (!prefs.enabled) continue;

    const lists = normalizeWatchlists(settings.watchlists);
    const symbols = lists[0]?.symbols || [];
    if (!symbols.length) continue;

    const user = db.getUserByUsername?.(userId);
    const to = userEmail(user);
    let instantCandidate = null;
    let newsFetches = 0;
    const NEWS_BUDGET = 50;

    for (const sym of symbols) {
      const row = db.getStock(sym);
      if (!row || row.is_etf) continue;

      let state = db.getWatchlistAlertState(userId, sym) || {
        baseline_price: null,
        baseline_session_date: null,
        last_price: null,
        last_conviction: null,
        last_news_urls: [],
        last_alert_at: {},
        pending_digest: [],
        in_app_delivered_at: null,
      };

      state = ensureBaseline(state, row, sessionDate);
      const cooldowns = state.last_alert_at || {};

      // Price move vs session baseline
      const move = pctChange(state.baseline_price, row.price);
      const thresh = priceThresholdPct(prefs, session);
      if (
        move != null
        && Math.abs(move) >= thresh
        && canFire(cooldowns, 'price', now)
      ) {
        const alert = {
          id: `${userId}:${sym}:price:${now}`,
          type: 'price',
          symbol: sym,
          title: `${sym} ${move >= 0 ? 'up' : 'down'} ${Math.abs(move).toFixed(1)}%`,
          message: `Now ${row.price?.toFixed?.(2) ?? row.price} vs session open ${state.baseline_price?.toFixed?.(2) ?? state.baseline_price}`,
          pct: Math.round(move * 10) / 10,
          ts: now,
        };
        const urgent = prefs.emailInstant && Math.abs(move) >= (prefs.instantThresholdPct ?? 8);
        state = queueAlert(state, alert);
        state.last_alert_at = markCooldown(cooldowns, 'price', now);
        cooldowns.price = now;
        if (urgent) instantCandidate = alert;
      }

      // Conviction shift
      const conv = convictionForRow(row);
      if (
        conv != null
        && state.last_conviction != null
        && Math.abs(conv - state.last_conviction) >= CONVICTION_DELTA
        && canFire(cooldowns, 'conviction', now)
      ) {
        const delta = conv - state.last_conviction;
        const alert = {
          id: `${userId}:${sym}:conviction:${now}`,
          type: 'conviction',
          symbol: sym,
          title: `${sym} conviction ${delta >= 0 ? 'rose' : 'fell'} to ${conv}`,
          message: `Was ${state.last_conviction}, now ${conv} (${delta >= 0 ? '+' : ''}${delta})`,
          conviction: conv,
          ts: now,
        };
        state = queueAlert(state, alert);
        state.last_alert_at = markCooldown(state.last_alert_at, 'conviction', now);
      }
      if (conv != null) state.last_conviction = conv;

      // News (deduped by URL)
      if (canFire(cooldowns, 'news', now) && newsFetches < NEWS_BUDGET) {
        try {
          newsFetches++;
          const articles = await cachedNews(sym);
          const seen = new Set(state.last_news_urls || []);
          const fresh = articles.filter((a) => a.url && !seen.has(a.url));
          if (fresh.length) {
            const top = fresh[0];
            const alert = {
              id: `${userId}:${sym}:news:${now}`,
              type: 'news',
              symbol: sym,
              title: `${sym}: ${top.title}`,
              message: top.publisher || top.site || 'News',
              url: top.url,
              ts: now,
            };
            state = queueAlert(state, alert);
            state.last_alert_at = markCooldown(state.last_alert_at, 'news', now);
            const urls = [...seen, ...fresh.map((a) => a.url)].slice(-20);
            state.last_news_urls = urls;
          }
        } catch {
          // skip news for this symbol
        }
      }

      db.saveWatchlistAlertState(userId, sym, state);
    }

    // Instant urgent email (price only, capped per day)
    if (instantCandidate && to && prefs.emailInstant) {
      const dayKey = `wl_urgent:${userId}:${sessionDate}`;
      const sent = Number(db.getMeta?.(dayKey) || 0);
      if (sent < MAX_URGENT_EMAILS_DAY) {
        const tpl = watchlistUrgentEmail({
          symbol: instantCandidate.symbol,
          movePct: instantCandidate.pct,
          price: db.getStock(instantCandidate.symbol)?.price,
        });
        const res = await sendEmail({ to, ...tpl });
        if (res?.ok) db.setMeta?.(dayKey, String(sent + 1));
      }
    }
  }
}

export function getAlertsForUser(userId, since = 0) {
  const settings = db.getUserSettings(userId);
  const prefs = sanitizeWatchlistAlerts(settings.watchlistAlerts);
  const lists = normalizeWatchlists(settings.watchlists);
  const symbols = lists[0]?.symbols || [];
  const stockMap = new Map(symbols.map((s) => [s, db.getStock(s)]));

  const alerts = [];
  let unread = 0;
  for (const st of db.listWatchlistAlertStatesForUser(userId)) {
    const pending = st.pending_digest || [];
    unread += pending.length;
    for (const a of pending) {
      if (a.ts > since) alerts.push(a);
    }
  }
  alerts.sort((a, b) => b.ts - a.ts);

  return {
    alerts: prefs.inApp ? alerts : [],
    unread,
    snapshots: buildSnapshots(userId, symbols, stockMap),
    prefs,
  };
}

export function markAlertsRead(userId, beforeTs = Date.now()) {
  for (const st of db.listWatchlistAlertStatesForUser(userId)) {
    const pending = (st.pending_digest || []).filter((a) => a.ts > beforeTs);
    if (pending.length !== (st.pending_digest || []).length) {
      db.saveWatchlistAlertState(userId, st.symbol, {
        pending_digest: pending,
        in_app_delivered_at: Date.now(),
      });
    }
  }
}

export async function flushDailyDigests() {
  const sessionDate = etSessionDate();
  const rows = db.listAllUserSettingsRows();

  for (const { user_id: userId, data: raw } of rows) {
    let settings;
    try {
      settings = raw ? JSON.parse(raw) : {};
    } catch {
      continue;
    }
    const prefs = sanitizeWatchlistAlerts(settings.watchlistAlerts);
    if (!prefs.enabled || !prefs.emailDigest) continue;

    const user = db.getUserByUsername?.(userId);
    const to = userEmail(user);
    if (!to) continue;

    const digestKey = `wl_digest:${userId}:${sessionDate}`;
    if (db.getMeta?.(digestKey)) continue;

    const items = [];
    for (const st of db.listWatchlistAlertStatesForUser(userId)) {
      const recent = (st.pending_digest || []).slice(-MAX_DIGEST_ITEMS);
      for (const a of recent) items.push(a);
    }
    if (!items.length) continue;

    // Suppress items already shown in-app in the last 2h
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const filtered = items.filter((a) => {
      const st = db.getWatchlistAlertState(userId, a.symbol);
      return !(st?.in_app_delivered_at && st.in_app_delivered_at >= cutoff && a.ts <= st.in_app_delivered_at);
    }).slice(0, MAX_DIGEST_ITEMS);

    if (!filtered.length) {
      db.setMeta?.(digestKey, '1');
      continue;
    }

    const tpl = watchlistDigestEmail({ items: filtered, date: sessionDate });
    const res = await sendEmail({ to, ...tpl });
    if (res?.ok || res?.skipped) {
      db.setMeta?.(digestKey, '1');
      for (const st of db.listWatchlistAlertStatesForUser(userId)) {
        db.saveWatchlistAlertState(userId, st.symbol, { pending_digest: [] });
      }
    }
  }
}

let scanTimer = null;
let digestTimer = null;

export function startWatchlistAlertJobs() {
  if (scanTimer) return;

  const runScan = () => {
    runWatchlistAlertScan().catch((e) => console.error('[watchlist-alerts] scan failed:', e.message));
  };

  runScan();
  scanTimer = setInterval(runScan, 5 * 60 * 1000);
  scanTimer.unref?.();

  const scheduleDigest = () => {
    const now = new Date();
    const et = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const parts = Object.fromEntries(et.map((p) => [p.type, p.value]));
    const mins = Number(parts.hour) * 60 + Number(parts.minute);
    const target = 8 * 60;
    if (mins >= target && mins < target + 5) {
      flushDailyDigests().catch((e) => console.error('[watchlist-digest] failed:', e.message));
    }
  };

  digestTimer = setInterval(scheduleDigest, 60 * 1000);
  digestTimer.unref?.();
}