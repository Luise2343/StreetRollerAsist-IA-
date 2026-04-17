// src/repositories/inventory.repository.js
import { pool } from '../config/db.js';

export const inventoryRepository = {
  async findAll(tenantId, { limit = 200 } = {}) {
    const { rows } = await pool.query(
      `SELECT i.id, i.product_id, p.name AS product_name,
              i.qty_on_hand, i.qty_reserved, i.updated_at
       FROM inventory i
       JOIN product p ON p.id = i.product_id AND p.tenant_id = $1
       ORDER BY i.id DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  async adjust(tenantId, productId, delta) {
    const { rows } = await pool.query(
      `UPDATE inventory i
       SET qty_on_hand = i.qty_on_hand + $3,
           updated_at  = NOW()
       FROM product p
       WHERE i.product_id = p.id AND p.tenant_id = $1 AND i.product_id = $2
       RETURNING i.*`,
      [tenantId, productId, delta]
    );
    return rows[0] || null;
  }
};
