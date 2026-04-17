// src/repositories/customer.repository.js
import { pool } from '../config/db.js';

export const customerRepository = {
  async findAll(tenantId, { limit = 100 } = {}) {
    const { rows } = await pool.query(
      `SELECT id, name, phone, email, tenant_id AS "tenantId", created_at
       FROM customer
       WHERE tenant_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  async create(tenantId, { name, phone = null, email = null }) {
    const { rows } = await pool.query(
      `INSERT INTO customer (tenant_id, name, phone, email)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, phone, email, tenant_id AS "tenantId", created_at`,
      [tenantId, name, phone, email]
    );
    return rows[0];
  }
};
