import { z } from 'zod';
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

const adjustSchema = z.object({
  delta: z.coerce.number().int(),
  reason: z.string().optional(),
  note: z.string().max(500).optional()
});

export async function adjust(req, res) {
  try {
    const productId = Number(req.params.productId);
    const parsed = adjustSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid body' });
    const { delta, reason, note } = parsed.data;
    const row = await inventoryService.adjustStock(req.tenant.id, productId, delta, { reason, note });
    res.json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to adjust inventory');
  }
}

export async function lowStock(req, res) {
  try {
    const rows = await inventoryService.findLowStock(req.tenant.id);
    res.json({ ok: true, data: rows });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list low stock');
  }
}

const thresholdSchema = z.object({
  threshold: z.coerce.number().int().min(0)
});

export async function setThreshold(req, res) {
  try {
    const productId = Number(req.params.productId);
    const parsed = thresholdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid body' });
    const row = await inventoryService.setThreshold(req.tenant.id, productId, parsed.data.threshold);
    res.json({ ok: true, data: row });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to set threshold');
  }
}

const bulkSchema = z.object({
  items: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    delta: z.coerce.number().int(),
    note: z.string().max(500).optional()
  })).min(1).max(200),
  reason: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.coerce.number().int().positive().optional()
});

export async function bulkAdjust(req, res) {
  try {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid body', details: parsed.error.issues });
    const { items, reason, referenceType, referenceId } = parsed.data;
    const rows = await inventoryService.bulkAdjust(req.tenant.id, items, { reason, referenceType, referenceId });
    res.json({ ok: true, data: rows });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to bulk adjust');
  }
}

const movementsQuerySchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  referenceType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0)
});

export async function listMovements(req, res) {
  try {
    const parsed = movementsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid query' });
    const rows = await inventoryService.listMovements(req.tenant.id, parsed.data);
    res.json({ ok: true, data: rows });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list movements');
  }
}

export async function listProductMovements(req, res) {
  try {
    const productId = Number(req.params.productId);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await inventoryService.listMovementsByProduct(req.tenant.id, productId, { limit, offset });
    res.json({ ok: true, data: rows });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list product movements');
  }
}
