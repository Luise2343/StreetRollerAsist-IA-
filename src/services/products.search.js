import { pool } from '../config/db.js';

/**
 * @param {object} opts
 * @param {number} opts.tenantId
 * @param {string} [opts.text]
 * @param {string} [opts.category] category slug
 * @param {string} [opts.brand]
 * @param {Record<string, unknown>} [opts.specs] partial specs for @> match
 * @param {number} [opts.priceMin]
 * @param {number} [opts.priceMax]
 */
export async function searchProducts({
  tenantId,
  text = '',
  category = null,
  brand = null,
  specs = null,
  priceMin = null,
  priceMax = null,
  limit = 20
}) {
  const params = [tenantId];
  const conditions = ['p.tenant_id = $1', 'p.active = true'];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);

  if (text && String(text).trim()) {
    const cleaned = String(text).trim();
    params.push(`%${cleaned}%`);
    const likeIdx = params.length;
    params.push(cleaned);
    const ftsIdx = params.length;
    conditions.push(
      `(p.name ILIKE $${likeIdx} OR p.description ILIKE $${likeIdx}` +
        ` OR to_tsvector('spanish', coalesce(p.name,'') || ' ' || coalesce(p.description,''))` +
        ` @@ plainto_tsquery('spanish', $${ftsIdx}))`
    );
  }
  if (category) {
    params.push(String(category).trim());
    conditions.push(`p.category = $${params.length}`);
  }
  if (brand) {
    params.push(`%${String(brand).trim()}%`);
    conditions.push(`p.brand ILIKE $${params.length}`);
  }
  if (specs && typeof specs === 'object' && Object.keys(specs).length) {
    params.push(JSON.stringify(specs));
    conditions.push(`p.specs @> $${params.length}::jsonb`);
  }
  if (priceMin !== null && priceMin !== undefined && priceMin !== '') {
    params.push(Number(priceMin));
    conditions.push(`p.base_price >= $${params.length}`);
  }
  if (priceMax !== null && priceMax !== undefined && priceMax !== '') {
    params.push(Number(priceMax));
    conditions.push(`p.base_price <= $${params.length}`);
  }

  const sql = `
    SELECT
      p.id, p.name, p.description,
      p.base_price AS price, p.currency, p.active, p.category, p.brand, p.specs, p.sku,
      COALESCE(inv.qty_on_hand, 0) AS qty_on_hand
    FROM product p
    LEFT JOIN inventory inv ON inv.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.name ASC
    LIMIT ${safeLimit}
  `;

  if (process.env.NODE_ENV !== 'production') {
    console.log('SQL:', sql.replace(/\s+/g, ' ').trim());
    console.log('Params:', params);
  }

  const { rows } = await pool.query(sql, params);
  return rows || [];
}

export async function listAllProducts(tenantId, { limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
  const sql = `
    SELECT
      p.id, p.name, p.description,
      p.base_price AS price, p.currency, p.active, p.category, p.brand, p.specs, p.sku,
      COALESCE(inv.qty_on_hand, 0) AS qty_on_hand
    FROM product p
    LEFT JOIN inventory inv ON inv.product_id = p.id
    WHERE p.tenant_id = $1 AND p.active = true
    ORDER BY p.name ASC
    LIMIT ${safeLimit}
  `;
  const { rows } = await pool.query(sql, [tenantId]);
  return rows || [];
}
