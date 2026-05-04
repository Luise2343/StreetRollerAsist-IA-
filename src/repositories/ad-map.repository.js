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
  }
};
