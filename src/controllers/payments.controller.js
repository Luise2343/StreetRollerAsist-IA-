import { paymentRepository } from '../repositories/payment.repository.js';
import { sendError } from '../middleware/error-handler.js';

export async function list(req, res) {
  try {
    const rows = await paymentRepository.findAll(req.tenant.id);
    res.json(rows);
  } catch (e) {
    sendError(res, 500, e, 'Failed to list payments');
  }
}

export async function create(req, res) {
  try {
    const { order_id, method, amount, reference, paid_at } = req.body;
    if (!order_id || !method || amount === null || amount === undefined) {
      return res.status(400).json({ ok: false, error: 'order_id, method and amount are required' });
    }
    const row = await paymentRepository.create(req.tenant.id, {
      order_id,
      method,
      amount,
      reference,
      paid_at
    });
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Order not found for this tenant' });
    }
    res.status(201).json(row);
  } catch (e) {
    sendError(res, 500, e, 'Failed to create payment');
  }
}
