// src/repositories/order.repository.js
import { pool } from '../config/db.js';

export const orderRepository = {
  async findAll(tenantId, { limit = 100 } = {}) {
    const { rows } = await pool.query(
      `SELECT o.id, o.customer_id, c.name AS customer_name,
              o.discount_total, o.tax_total, o.total,
              o.status, o.tenant_id AS "tenantId", o.created_at, o.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', oi.id,
                    'product_id', oi.product_id,
                    'product_name', p.name,
                    'qty', oi.qty,
                    'unit_price', oi.unit_price,
                    'subtotal', oi.subtotal
                  ) ORDER BY oi.id
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) AS items
       FROM orders o
       JOIN customer c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
       LEFT JOIN order_item oi ON oi.order_id = o.id
       LEFT JOIN product p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  /**
   * Creates an order with line items. Total = sum(subtotals) - discount_total + tax_total.
   */
  async create(
    tenantId,
    { customer_id, items, discount_total = 0, tax_total = 0, status = 'new' }
  ) {
    if (!Array.isArray(items) || !items.length) {
      const err = new Error('items array with at least one line is required');
      err.status = 400;
      throw err;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const c = await client.query(`SELECT id FROM customer WHERE id = $1 AND tenant_id = $2`, [
        customer_id,
        tenantId
      ]);
      if (!c.rows[0]) {
        const err = new Error('Customer not found for this tenant');
        err.status = 404;
        throw err;
      }

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (customer_id, tenant_id, discount_total, tax_total, total, status)
         VALUES ($1, $2, $3, $4, 0, $5)
         RETURNING id`,
        [customer_id, tenantId, discount_total, tax_total, status]
      );
      const orderId = orderRows[0].id;

      let sumSub = 0;
      for (const line of items) {
        const { product_id, qty, unit_price = null } = line;
        const pr = await client.query(
          `SELECT base_price FROM product WHERE id = $1 AND tenant_id = $2`,
          [product_id, tenantId]
        );
        if (!pr.rows[0]) {
          const err = new Error(`Product ${product_id} not found for this tenant`);
          err.status = 404;
          throw err;
        }
        const up =
          unit_price !== null && unit_price !== undefined
            ? Number(unit_price)
            : Number(pr.rows[0].base_price);
        await client.query(
          `INSERT INTO order_item (order_id, product_id, qty, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [orderId, product_id, qty, up]
        );
        sumSub += qty * up;
      }

      const total = sumSub - Number(discount_total) + Number(tax_total);
      const { rows: finalRows } = await client.query(
        `UPDATE orders SET total = $2, updated_at = now() WHERE id = $1
         RETURNING *`,
        [orderId, total]
      );

      await client.query('COMMIT');
      return finalRows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async findAllAdmin(tenantId, { limit = 200 } = {}) {
    const { rows } = await pool.query(
      `SELECT o.id, o.wa_id, o.customer_id,
              COALESCE(o.delivery_name, c.name) AS customer_name,
              o.delivery_phone, o.delivery_address, o.payment_method, o.ad_id,
              o.discount_total, o.tax_total, o.total,
              o.status, o.label_url, o.tracking_url, o.courier_name,
              o.created_at, o.updated_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'product_id', oi.product_id,
                    'product_name', p.name,
                    'qty', oi.qty,
                    'unit_price', oi.unit_price,
                    'subtotal', oi.subtotal
                  ) ORDER BY oi.id
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) AS items
       FROM orders o
       LEFT JOIN customer c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
       LEFT JOIN order_item oi ON oi.order_id = o.id
       LEFT JOIN product p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1
       GROUP BY o.id, c.name
       ORDER BY o.id DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  async findRecentByWaIdAndProduct(tenantId, waId, productId, windowMinutes = 15) {
    const { rows } = await pool.query(
      `SELECT o.id, o.total, o.status
       FROM orders o
       JOIN order_item oi ON oi.order_id = o.id
       WHERE o.tenant_id = $1 AND o.wa_id = $2 AND oi.product_id = $3
         AND o.created_at > NOW() - ($4 || ' minutes')::interval
       ORDER BY o.id DESC
       LIMIT 1`,
      [tenantId, waId, productId, windowMinutes]
    );
    return rows[0] ?? null;
  },

  async findByIdAdmin(tenantId, orderId) {
    const { rows } = await pool.query(
      `SELECT o.id, o.wa_id, o.customer_id,
              COALESCE(o.delivery_name, c.name) AS customer_name,
              o.delivery_phone, o.delivery_address, o.payment_method,
              o.discount_total, o.tax_total, o.total,
              o.status, o.created_at,
              t.wa_token, t.wa_phone_number_id,
              COALESCE(
                json_agg(
                  json_build_object(
                    'product_id', oi.product_id,
                    'product_name', p.name,
                    'qty', oi.qty,
                    'unit_price', oi.unit_price,
                    'subtotal', oi.subtotal
                  ) ORDER BY oi.id
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) AS items
       FROM orders o
       LEFT JOIN customer c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
       JOIN tenant t ON t.id = o.tenant_id
       LEFT JOIN order_item oi ON oi.order_id = o.id
       LEFT JOIN product p ON p.id = oi.product_id AND p.tenant_id = o.tenant_id
       WHERE o.id = $2 AND o.tenant_id = $1
       GROUP BY o.id, c.name, t.wa_token, t.wa_phone_number_id`,
      [tenantId, orderId]
    );
    return rows[0] ?? null;
  },

  async createFromWA(tenantId, { waId, productId, unitPrice, deliveryName, deliveryPhone, deliveryAddress, paymentMethod, adId = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (tenant_id, wa_id, delivery_name, delivery_phone, delivery_address, payment_method, ad_id, total, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'new')
         RETURNING id`,
        [tenantId, waId, deliveryName, deliveryPhone, deliveryAddress, paymentMethod, adId]
      );
      const orderId = orderRows[0].id;
      await client.query(
        `INSERT INTO order_item (order_id, product_id, qty, unit_price) VALUES ($1, $2, 1, $3)`,
        [orderId, productId, unitPrice]
      );
      const { rows: finalRows } = await client.query(
        `UPDATE orders SET total = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [orderId, Number(unitPrice)]
      );
      await client.query('COMMIT');
      return finalRows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
};
