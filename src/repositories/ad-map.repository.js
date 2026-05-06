import { pool } from '../config/db.js';

export const adMapRepository = {
  async findByAdId(tenantId, adId) {
    const { rows } = await pool.query(
      `SELECT name, description, price, system_prompt
       FROM ad_product_map
       WHERE tenant_id = $1 AND ad_id = $2 AND active = true
       LIMIT 1`,
      [tenantId, adId]
    );
    return rows[0] ?? null;
  },

  async findAll(tenantId) {
    const { rows } = await pool.query(
      `SELECT id, ad_id, name, description, price, category, system_prompt, active, created_at, updated_at
       FROM ad_product_map
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return rows;
  },

  async create(tenantId, { ad_id, name, description, price, category, system_prompt }) {
    const { rows } = await pool.query(
      `INSERT INTO ad_product_map (tenant_id, ad_id, name, description, price, category, system_prompt, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (tenant_id, ad_id) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             price = EXCLUDED.price,
             category = EXCLUDED.category,
             system_prompt = EXCLUDED.system_prompt,
             active = true,
             updated_at = NOW()
       RETURNING id, ad_id, name, description, price, category, system_prompt, active, created_at, updated_at`,
      [tenantId, ad_id, name, description ?? null, price ?? null, category ?? null, system_prompt]
    );
    return rows[0];
  },

  async update(tenantId, id, fields) {
    const allowed = ['name', 'description', 'price', 'system_prompt', 'active'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (keys.length === 0) return null;
    const setClauses = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const values = keys.map((k) => fields[k]);
    const { rows } = await pool.query(
      `UPDATE ad_product_map
       SET ${setClauses}, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, ad_id, name, description, price, category, system_prompt, active, created_at, updated_at`,
      [tenantId, id, ...values]
    );
    return rows[0] ?? null;
  },

  async deactivate(tenantId, id) {
    const { rowCount } = await pool.query(
      `UPDATE ad_product_map SET active = false, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return rowCount > 0;
  }
};
