// src/routes/notifications.routes.js
import { Router } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/business/notification.service.js';
import { sendError } from '../middleware/error-handler.js';

const router = Router();

const listSchema = z.object({
  unread_only: z.coerce.boolean().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

router.get('/', async (req, res) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid query' });
    const { unread_only, type, limit, offset } = parsed.data;
    const result = await notificationService.list(req.tenant.id, {
      unreadOnly: !!unread_only,
      type: type || null,
      limit,
      offset
    });
    res.json({ ok: true, data: result.notifications, total: result.total });
  } catch (e) {
    sendError(res, 500, e, 'Failed to list notifications');
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const count = await notificationService.unreadCount(req.tenant.id);
    res.json({ ok: true, count });
  } catch (e) {
    sendError(res, 500, e, 'Failed to count notifications');
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    const updated = await notificationService.markAllRead(req.tenant.id);
    res.json({ ok: true, updated });
  } catch (e) {
    sendError(res, 500, e, 'Failed to mark all read');
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    const row = await notificationService.markRead(req.tenant.id, id);
    if (!row) return res.status(404).json({ ok: false, error: 'Notification not found' });
    res.json({ ok: true, data: row });
  } catch (e) {
    sendError(res, 500, e, 'Failed to mark notification read');
  }
});

export default router;
