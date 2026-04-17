import { orderService } from '../services/business/order.service.js';
import { sendError } from '../middleware/error-handler.js';

export async function list(req, res) {
  try {
    const rows = await orderService.listOrders(req.tenant.id);
    res.json(rows);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list orders');
  }
}

export async function create(req, res) {
  try {
    const row = await orderService.createOrder(req.tenant.id, req.body);
    res.status(201).json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to create order');
  }
}
