import { Router } from 'express';
import {
  devAlertsTestEnabled,
  getAlertsForUser,
  injectTestAlert,
  markAlertsRead,
} from '../watchlistAlerts.js';

const router = Router();

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

export default router;