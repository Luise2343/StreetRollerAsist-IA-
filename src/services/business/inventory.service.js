// src/services/business/inventory.service.js
import { inventoryRepository } from '../../repositories/inventory.repository.js';
import { inventoryMovementRepository } from '../../repositories/inventory-movement.repository.js';
import { logger } from '../../config/logger.js';

const VALID_REASONS = new Set([
  'manual_adjustment',
  'order_confirmed',
  'order_cancelled',
  'restock',
  'damage',
  'count_correction',
  'other'
]);

async function maybeNotifyLowStock(tenantId, row) {
  if (!row || row.low_stock_threshold <= 0) return;
  if (row.qty_on_hand >= row.low_stock_threshold) return;
  try {
    const { notificationService } = await import('./notification.service.js');
    await notificationService.notify(tenantId, {
      type: 'low_stock',
      severity: 'warning',
      title: `⚠️ Stock bajo: producto #${row.product_id}`,
      body: `Quedan ${row.qty_on_hand} unidades (umbral: ${row.low_stock_threshold})`,
      data: {
        productId: row.product_id,
        qtyOnHand: row.qty_on_hand,
        threshold: row.low_stock_threshold
      }
    }, false);
  } catch (e) {
    logger.warn({ action: 'low_stock_notify_failed', error: e.message });
  }
}

export const inventoryService = {
  async listInventory(tenantId) {
    return inventoryRepository.findAll(tenantId);
  },

  async adjustStock(tenantId, productId, delta, opts = {}) {
    if (!productId || typeof delta !== 'number' || !Number.isFinite(delta)) {
      const err = new Error('productId and numeric delta are required');
      err.status = 400;
      throw err;
    }
    const reason = opts.reason || 'manual_adjustment';
    if (!VALID_REASONS.has(reason)) {
      const err = new Error(`invalid reason: ${reason}`);
      err.status = 400;
      throw err;
    }

    const row = await inventoryRepository.adjustWithMovement(tenantId, productId, delta);
    if (!row) {
      const err = new Error('Inventory not found for this product');
      err.status = 404;
      throw err;
    }

    await inventoryMovementRepository.create(tenantId, {
      productId: row.product_id,
      delta,
      qtyBefore: row.qty_before,
      qtyAfter: row.qty_after,
      reason,
      referenceType: opts.referenceType ?? null,
      referenceId: opts.referenceId ?? null,
      note: opts.note ?? null,
      userId: opts.userId ?? null
    });

    if (delta < 0) await maybeNotifyLowStock(tenantId, row);
    return row;
  },

  async bulkAdjust(tenantId, items, opts = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      const err = new Error('items array is required');
      err.status = 400;
      throw err;
    }
    const reason = opts.reason || 'manual_adjustment';
    if (!VALID_REASONS.has(reason)) {
      const err = new Error(`invalid reason: ${reason}`);
      err.status = 400;
      throw err;
    }

    const results = await inventoryRepository.bulkAdjust(
      tenantId,
      items.map(it => ({ productId: it.productId, delta: it.delta }))
    );

    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      const itemNote = items[i]?.note ?? opts.note ?? null;
      await inventoryMovementRepository.create(tenantId, {
        productId: row.product_id,
        delta: items[i].delta,
        qtyBefore: row.qty_before,
        qtyAfter: row.qty_after,
        reason,
        referenceType: opts.referenceType ?? null,
        referenceId: opts.referenceId ?? null,
        note: itemNote,
        userId: opts.userId ?? null
      });
      if (items[i].delta < 0) await maybeNotifyLowStock(tenantId, row);
    }
    return results;
  },

  async findLowStock(tenantId) {
    return inventoryRepository.findLowStock(tenantId);
  },

  async setThreshold(tenantId, productId, threshold) {
    const t = Number(threshold);
    if (!Number.isInteger(t) || t < 0) {
      const err = new Error('threshold must be a non-negative integer');
      err.status = 400;
      throw err;
    }
    const row = await inventoryRepository.setLowStockThreshold(tenantId, productId, t);
    if (!row) {
      const err = new Error('Inventory not found for this product');
      err.status = 404;
      throw err;
    }
    return row;
  },

  async listMovements(tenantId, filters = {}) {
    return inventoryMovementRepository.findByTenant(tenantId, filters);
  },

  async listMovementsByProduct(tenantId, productId, opts = {}) {
    return inventoryMovementRepository.findByProduct(tenantId, productId, opts);
  }
};
