// src/repositories/payment.repository.js
import { pool } from '../config/db.js';

export const paymentRepository = {
  async findAll(tenantId, { limit = 100 } = {}) {
    const { rows } = await pool.query(
      `SELECT pay.id, pay.order_id, pay.method, pay.amount, pay.reference, pay.paid_at
       FROM payment pay
       JOIN orders o ON o.id = pay.order_id AND o.tenant_id = $1
       ORDER BY pay.id DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  async create(tenantId, { order_id, method, amount, reference = null, paid_at = null }) {
    const chk = await pool.query(
      `SELECT id FROM orders WHERE id = $1 AND tenant_id = $2`,
      [order_id, tenantId]
    );
    if (!chk.rows[0]) return null;
    const { rows } = await pool.query(
      `INSERT INTO payment (order_id, method, amount, reference, paid_at)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, order_id, method, amount, reference, paid_at`,
      [order_id, method, amount, reference, paid_at]
    );
    return rows[0];
  }
};
