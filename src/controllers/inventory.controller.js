import { inventoryService } from '../services/business/inventory.service.js';
import { sendError } from '../middleware/error-handler.js';

export async function list(req, res) {
  try {
    const rows = await inventoryService.listInventory(req.tenant.id);
    res.json(rows);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list inventory');
  }
}

export async function adjust(req, res) {
  try {
    const productId = Number(req.params.productId);
    const { delta } = req.body;
    const row = await inventoryService.adjustStock(req.tenant.id, productId, delta);
    res.json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to adjust inventory');
  }
}
