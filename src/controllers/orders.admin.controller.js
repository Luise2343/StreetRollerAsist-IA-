import { orderRepository } from '../repositories/order.repository.js';
import { pool } from '../config/db.js';
import { sendError } from '../middleware/error-handler.js';

export async function listOrders(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await orderRepository.findAllAdmin(tenantId, { limit });
    res.json({ ok: true, data: rows });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list orders');
  }
}

export async function updateStatus(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const orderId = Number(req.params.orderId);
    const { status } = req.body;
    const VALID = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!VALID.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${VALID.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE orders SET status = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3 RETURNING id, status, updated_at`,
      [status, orderId, tenantId]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Order not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update order status');
  }
}
