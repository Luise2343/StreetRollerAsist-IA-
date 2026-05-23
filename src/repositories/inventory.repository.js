// src/repositories/inventory.repository.js
import { pool } from '../config/db.js';

export const inventoryRepository = {
  async findAll(tenantId, { limit = 200 } = {}) {
    const { rows } = await pool.query(
      `SELECT p.id AS product_id,
              p.name AS product_name,
              p.description,
              p.sku,
              p.brand,
              p.category,
              p.specs,
              p.base_price,
              COALESCE(i.id, 0) AS id,
              COALESCE(i.qty_on_hand, 0) AS qty_on_hand,
              COALESCE(i.qty_reserved, 0) AS qty_reserved,
              COALESCE(i.low_stock_threshold, 0) AS low_stock_threshold,
              COALESCE(i.updated_at, NOW()) AS updated_at
       FROM product p
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.tenant_id = $1 AND p.active = true
       ORDER BY p.category, p.name
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
  },

  /**
   * Adjusts inventory and returns qty_before/qty_after for movement tracking
   */
  async adjustWithMovement(tenantId, productId, delta) {
    // Ensure inventory row exists for products created before having one
    await pool.query(
      `INSERT INTO inventory (product_id, qty_on_hand, qty_reserved, low_stock_threshold)
       SELECT $2, 0, 0, 0 FROM product WHERE id = $2 AND tenant_id = $1
       ON CONFLICT (product_id) DO NOTHING`,
      [tenantId, productId]
    );
    const { rows } = await pool.query(
      `UPDATE inventory i
       SET qty_on_hand = i.qty_on_hand + $3,
           updated_at  = NOW()
       FROM product p
       WHERE i.product_id = p.id AND p.tenant_id = $1 AND i.product_id = $2
       RETURNING i.qty_on_hand - $3 AS qty_before, i.qty_on_hand AS qty_after, i.*`,
      [tenantId, productId, delta]
    );
    return rows[0] || null;
  },

  /**
   * Finds products with qty_on_hand below their low_stock_threshold
   */
  async findLowStock(tenantId, { limit = 100 } = {}) {
    const { rows } = await pool.query(
      `SELECT i.id, i.product_id, p.name AS product_name,
              i.qty_on_hand, i.qty_reserved, i.low_stock_threshold,
              (i.low_stock_threshold - i.qty_on_hand) AS shortage,
              i.updated_at
       FROM inventory i
       JOIN product p ON p.id = i.product_id AND p.tenant_id = $1
       WHERE i.qty_on_hand < i.low_stock_threshold
       ORDER BY i.qty_on_hand ASC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  /**
   * Bulk adjusts inventory for multiple products in a single transaction
   */
  async bulkAdjust(tenantId, adjustments) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];

      for (const { productId, delta } of adjustments) {
        const { rows } = await client.query(
          `UPDATE inventory i
           SET qty_on_hand = i.qty_on_hand + $3,
               updated_at  = NOW()
           FROM product p
           WHERE i.product_id = p.id AND p.tenant_id = $1 AND i.product_id = $2
           RETURNING i.qty_on_hand - $3 AS qty_before, i.qty_on_hand AS qty_after, i.*`,
          [tenantId, productId, delta]
        );
        if (rows[0]) {
          results.push(rows[0]);
        }
      }

      await client.query('COMMIT');
      return results;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * Sets the low_stock_threshold for a product
   */
  async setLowStockThreshold(tenantId, productId, threshold) {
    await pool.query(
      `INSERT INTO inventory (product_id, qty_on_hand, qty_reserved, low_stock_threshold)
       SELECT $2, 0, 0, 0 FROM product WHERE id = $2 AND tenant_id = $1
       ON CONFLICT (product_id) DO NOTHING`,
      [tenantId, productId]
    );
    const { rows } = await pool.query(
      `UPDATE inventory i
       SET low_stock_threshold = $3,
           updated_at = NOW()
       FROM product p
       WHERE i.product_id = p.id AND p.tenant_id = $1 AND i.product_id = $2
       RETURNING i.*`,
      [tenantId, productId, threshold]
    );
    return rows[0] || null;
  }
};
