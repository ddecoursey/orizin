import { Router } from 'express';
import { getAlertsForUser, markAlertsRead } from '../watchlistAlerts.js';

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

export default router;