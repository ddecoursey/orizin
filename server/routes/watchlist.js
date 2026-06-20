import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  devAlertsTestEnabled,
  getAlertsForUser,
  injectTestAlert,
  markAlertsRead,
} from '../watchlistAlerts.js';
import { refreshQuotesForSymbols, WATCHLIST_QUOTES_MAX } from '../watchlistQuotes.js';

const router = Router();

const quotesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many watchlist quote requests — slow down a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  validate: { trustProxy: false },
});

// GET /api/watchlist/alerts?since=<ms>
router.get('/watchlist/alerts', (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json(getAlertsForUser(req.userId, since));
});

// POST /api/watchlist/alerts/read  { readThrough?: ms }
router.post('/watchlist/alerts/read', (req, res) => {
  const readThrough = Number(req.body?.readThrough) || Date.now();
  markAlertsRead(req.userId, readThrough);
  res.json({ ok: true });
});

// POST /api/watchlist/alerts/test — development only (preview in-app toast)
router.post('/watchlist/alerts/test', (req, res) => {
  if (!devAlertsTestEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  const type = ['price', 'news', 'conviction'].includes(req.body?.type) ? req.body.type : 'price';
  const result = injectTestAlert(req.userId, { symbol: req.body?.symbol, type });
  res.json({ ok: true, ...result });
});

// POST /api/watchlist/quotes  { symbols: string[] }
// Minimal payload for watchlist sync — live quote refresh when stale, no full stock row.
router.post('/watchlist/quotes', quotesLimiter, async (req, res) => {
  const raw = req.body?.symbols;
  if (!Array.isArray(raw) || !raw.length) {
    return res.status(400).json({ error: 'symbols required' });
  }
  if (raw.length > WATCHLIST_QUOTES_MAX) {
    return res.status(400).json({ error: `At most ${WATCHLIST_QUOTES_MAX} symbols` });
  }
  try {
    const quotes = await refreshQuotesForSymbols(raw);
    res.json({ quotes });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Quote refresh failed' });
  }
});

export default router;