// src/repositories/inventory-movement.repository.js
import { pool } from '../config/db.js';

export const inventoryMovementRepository = {
  /**
   * Creates an inventory movement record (typically called after adjusting qty_on_hand)
   */
  async create(tenantId, {
    productId,
    delta,
    qtyBefore,
    qtyAfter,
    reason,
    referenceType = null,
    referenceId = null,
    note = null,
    userId = null
  }) {
    const { rows } = await pool.query(
      `INSERT INTO inventory_movement
       (tenant_id, product_id, delta, qty_before, qty_after, reason, reference_type, reference_id, note, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tenant_id, product_id, delta, qty_before, qty_after, reason, reference_type, reference_id, note, user_id, created_at`,
      [tenantId, productId, delta, qtyBefore, qtyAfter, reason, referenceType, referenceId, note, userId]
    );
    return rows[0];
  },

  /**
   * Lists inventory movements for a tenant with optional filters
   */
  async findByTenant(tenantId, { productId = null, referenceType = null, limit = 100, offset = 0 } = {}) {
    let query = `
      SELECT m.id, m.product_id, p.name AS product_name, m.delta, m.qty_before, m.qty_after,
             m.reason, m.reference_type, m.reference_id, m.note, m.user_id, m.created_at
      FROM inventory_movement m
      LEFT JOIN product p ON p.id = m.product_id
      WHERE m.tenant_id = $1
    `;
    const params = [tenantId];

    if (productId) {
      query += ` AND m.product_id = $${params.length + 1}`;
      params.push(productId);
    }

    if (referenceType) {
      query += ` AND m.reference_type = $${params.length + 1}`;
      params.push(referenceType);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Lists movements for a specific product
   */
  async findByProduct(tenantId, productId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await pool.query(
      `SELECT m.id, m.product_id, m.delta, m.qty_before, m.qty_after,
              m.reason, m.reference_type, m.reference_id, m.note, m.user_id, m.created_at
       FROM inventory_movement m
       WHERE m.tenant_id = $1 AND m.product_id = $2
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, productId, limit, offset]
    );
    return rows;
  },

  /**
   * Lists movements for a specific order
   */
  async findByReference(tenantId, referenceType, referenceId) {
    const { rows } = await pool.query(
      `SELECT m.id, m.product_id, p.name AS product_name, m.delta, m.qty_before, m.qty_after,
              m.reason, m.reference_type, m.reference_id, m.note, m.user_id, m.created_at
       FROM inventory_movement m
       LEFT JOIN product p ON p.id = m.product_id
       WHERE m.tenant_id = $1 AND m.reference_type = $2 AND m.reference_id = $3
       ORDER BY m.created_at DESC`,
      [tenantId, referenceType, referenceId]
    );
    return rows;
  }
};
