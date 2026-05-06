import { Router } from 'express';
import { saveSubscription, removeSubscription } from '../services/push.service.js';
import { requireAdmin } from '../middleware/admin-auth.js';

const router = Router();

// Public key for the client to subscribe
router.get('/keys', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ ok: false, error: 'Push not configured' });
  res.json({ ok: true, publicKey: key });
});

// Register a push subscription (protected — only admin)
router.post('/subscribe', requireAdmin, async (req, res) => {
  const { subscription, tenantId } = req.body;
  if (!subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ ok: false, error: 'Invalid subscription object' });
  }
  const tid = Number(tenantId);
  if (!tid) return res.status(400).json({ ok: false, error: 'tenantId required' });

  await saveSubscription(tid, subscription, req.headers['user-agent'] || null);
  res.json({ ok: true });
});

// Remove a push subscription
router.delete('/subscribe', requireAdmin, async (req, res) => {
  const { endpoint, tenantId } = req.body;
  if (!endpoint || !tenantId) {
    return res.status(400).json({ ok: false, error: 'endpoint and tenantId required' });
  }
  await removeSubscription(Number(tenantId), endpoint);
  res.json({ ok: true });
});

export default router;
