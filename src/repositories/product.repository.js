// src/repositories/product.repository.js
import { pool } from '../config/db.js';

export const productRepository = {
  async findAll(tenantId, { limit = 50 } = {}) {
    const { rows } = await pool.query(
      `SELECT id, name, description,
              base_price AS "basePrice",
              currency, active, category, brand, specs, images, sku,
              tenant_id AS "tenantId",
              created_at, updated_at
       FROM product
       WHERE tenant_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  async findBySku(tenantId, sku) {
    const { rows } = await pool.query(
      `SELECT id, name, description, base_price AS "basePrice", currency, active, category, brand, specs, images, sku
       FROM product WHERE tenant_id = $1 AND sku = $2 AND active = true LIMIT 1`,
      [tenantId, sku]
    );
    return rows[0] || null;
  },

  async create(
    tenantId,
    {
      name,
      description = null,
      basePrice,
      currency,
      active = true,
      category = null,
      brand = null,
      specs = {},
      images = [],
      sku = null
    }
  ) {
    const { rows } = await pool.query(
      `INSERT INTO product (
        tenant_id, name, description, base_price, currency, active,
        category, brand, specs, images, sku
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       RETURNING id, name, description,
                 base_price AS "basePrice",
                 currency, active, category, brand, specs, images, sku,
                 tenant_id AS "tenantId",
                 created_at, updated_at`,
      [
        tenantId,
        name,
        description,
        basePrice,
        currency,
        active,
        category,
        brand,
        JSON.stringify(specs || {}),
        images || [],
        sku
      ]
    );
    return rows[0];
  }
};
