import { pool } from '../config/db.js';

const AD_PRODUCT_FIELDS = `
  p.id, p.name, p.description, p.base_price, p.currency,
  p.category, p.brand, p.specs, p.sku
`;

async function fetchProducts(adMapId, executor = pool) {
  const { rows } = await executor.query(
    `SELECT ${AD_PRODUCT_FIELDS}
     FROM ad_product ap
     JOIN product p ON p.id = ap.product_id
     WHERE ap.ad_map_id = $1 AND p.active = true
     ORDER BY ap.sort_order ASC, p.id ASC`,
    [adMapId]
  );
  return rows;
}

async function replaceProducts(adMapId, productIds, executor) {
  await executor.query(`DELETE FROM ad_product WHERE ad_map_id = $1`, [adMapId]);
  if (!productIds?.length) return;
  const ids = [...new Set(productIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return;
  const values = ids.map((_, i) => `($1, $${i + 2}, ${i})`).join(', ');
  await executor.query(
    `INSERT INTO ad_product (ad_map_id, product_id, sort_order) VALUES ${values}
     ON CONFLICT (ad_map_id, product_id) DO NOTHING`,
    [adMapId, ...ids]
  );
}

export const adMapRepository = {
  async findByAdId(tenantId, adId) {
    const { rows } = await pool.query(
      `SELECT id, name, description, price, category
       FROM ad_product_map
       WHERE tenant_id = $1 AND ad_id = $2 AND active = true
       LIMIT 1`,
      [tenantId, adId]
    );
    return rows[0] ?? null;
  },

  async findByAdIdWithProducts(tenantId, adId) {
    const entry = await this.findByAdId(tenantId, adId);
    if (!entry) return null;
    const products = await fetchProducts(entry.id);
    return { ...entry, products };
  },

  async findProductsByAdMapId(adMapId) {
    return fetchProducts(adMapId);
  },

  async findAnyByAdId(tenantId, adId) {
    const { rows } = await pool.query(
      `SELECT id, active FROM ad_product_map WHERE tenant_id = $1 AND ad_id = $2 LIMIT 1`,
      [tenantId, adId]
    );
    return rows[0] ?? null;
  },

  async findAll(tenantId) {
    const { rows } = await pool.query(
      `SELECT m.id, m.ad_id, m.name, m.description, m.price, m.category, m.active,
              m.created_at, m.updated_at,
              COALESCE(
                (SELECT json_agg(ap.product_id ORDER BY ap.sort_order)
                 FROM ad_product ap WHERE ap.ad_map_id = m.id),
                '[]'::json
              ) AS product_ids
       FROM ad_product_map m
       WHERE m.tenant_id = $1
       ORDER BY m.created_at DESC`,
      [tenantId]
    );
    return rows;
  },

  async create(tenantId, { ad_id, name, description, price, category, product_ids }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO ad_product_map (tenant_id, ad_id, name, description, price, category, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id, ad_id, name, description, price, category, active, created_at, updated_at`,
        [tenantId, ad_id, name, description ?? null, price ?? null, category ?? null]
      );
      const row = rows[0];
      await replaceProducts(row.id, product_ids, client);
      await client.query('COMMIT');
      return { ...row, product_ids: [...new Set((product_ids || []).map(Number))] };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async update(tenantId, id, fields) {
    const allowed = ['name', 'description', 'price', 'category', 'active'];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    const hasProductIds = Array.isArray(fields.product_ids);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let row;
      if (keys.length) {
        const setClauses = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
        const values = keys.map(k => fields[k]);
        const result = await client.query(
          `UPDATE ad_product_map
           SET ${setClauses}, updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, ad_id, name, description, price, category, active, created_at, updated_at`,
          [tenantId, id, ...values]
        );
        row = result.rows[0];
      } else {
        const result = await client.query(
          `SELECT id, ad_id, name, description, price, category, active, created_at, updated_at
           FROM ad_product_map WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id]
        );
        row = result.rows[0];
      }

      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }

      if (hasProductIds) {
        await replaceProducts(row.id, fields.product_ids, client);
      }

      await client.query('COMMIT');

      const productIdsRow = await pool.query(
        `SELECT product_id FROM ad_product WHERE ad_map_id = $1 ORDER BY sort_order`,
        [row.id]
      );
      return { ...row, product_ids: productIdsRow.rows.map(r => r.product_id) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async hardDelete(tenantId, id) {
    const { rowCount } = await pool.query(
      `DELETE FROM ad_product_map WHERE tenant_id = $1 AND id = $2 AND active = false`,
      [tenantId, id]
    );
    return rowCount > 0;
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
