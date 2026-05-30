import { pool } from '../config/db.js';
import { adMapRepository } from '../repositories/ad-map.repository.js';
import { logger } from '../config/logger.js';

export async function listProducts(req, res) {
  const tenantId = Number(req.params.tenantId);
  const category = req.query.category;
  let query = `SELECT id, name, description, base_price, brand, specs, category, sku
               FROM product WHERE tenant_id = $1 AND active = true`;
  const params = [tenantId];
  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  query += ' ORDER BY category, name';
  const { rows } = await pool.query(query, params);
  res.json({ ok: true, data: rows });
}

export async function listAds(req, res) {
  const tenantId = Number(req.params.tenantId);
  const rows = await adMapRepository.findAll(tenantId);
  res.json({ ok: true, data: rows });
}

export async function createAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const { ad_id, name, description, price, category, product_ids } = req.body;

  if (!ad_id || !name) {
    return res.status(400).json({ ok: false, error: 'ad_id y name son requeridos' });
  }
  const ids = Array.isArray(product_ids) ? product_ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) {
    return res.status(400).json({ ok: false, error: 'Debes seleccionar al menos un producto' });
  }

  const existing = await adMapRepository.findAnyByAdId(tenantId, ad_id);
  if (existing) {
    const msg = existing.active
      ? `Ya tienes un anuncio activo con ese Ad ID. Desactívalo primero.`
      : `Ya existe un anuncio inactivo con ese Ad ID. Elimínalo primero.`;
    return res.status(409).json({ ok: false, error: msg });
  }

  const row = await adMapRepository.create(tenantId, {
    ad_id,
    name,
    description,
    price,
    category,
    product_ids: ids
  });
  logger.info({ tenantId, adMapId: row.id, ad_id, products: ids.length }, 'ad created');
  res.status(201).json({ ok: true, data: row });
}

export async function updateAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const { name, description, price, category, active, product_ids } = req.body;

  const fields = {};
  if (name !== undefined) fields.name = name;
  if (description !== undefined) fields.description = description;
  if (price !== undefined) fields.price = price;
  if (category !== undefined) fields.category = category;
  if (active !== undefined) fields.active = active;
  if (Array.isArray(product_ids)) {
    fields.product_ids = product_ids.map(Number).filter(Number.isInteger);
  }

  const row = await adMapRepository.update(tenantId, id, fields);
  if (!row) return res.status(404).json({ ok: false, error: 'Anuncio no encontrado' });
  res.json({ ok: true, data: row });
}

export async function deleteAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const found = await adMapRepository.deactivate(tenantId, id);
  if (!found) return res.status(404).json({ ok: false, error: 'Anuncio no encontrado' });
  res.json({ ok: true });
}

export async function hardDeleteAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const found = await adMapRepository.hardDelete(tenantId, id);
  if (!found) return res.status(404).json({ ok: false, error: 'Anuncio no encontrado o está activo' });
  res.json({ ok: true });
}

export async function createProduct(req, res) {
  const tenantId = Number(req.params.tenantId);
  const { name, sku, brand, category, base_price, description, specs } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO product (tenant_id, name, description, base_price, currency, category, brand, specs, sku, active)
     VALUES ($1,$2,$3,$4,'GTQ',$5,$6,$7::jsonb,$8,true)
     RETURNING id, name, description, base_price, category, brand, specs, sku, tenant_id`,
    [
      tenantId,
      name.trim(),
      description?.trim() || null,
      base_price !== null && base_price !== undefined ? Number(base_price) : null,
      category?.trim() || null,
      brand?.trim() || null,
      JSON.stringify(specs || {}),
      sku?.trim() || null,
    ]
  );
  res.status(201).json({ ok: true, data: rows[0] });
}

export async function updateProduct(req, res) {
  const tenantId = Number(req.params.tenantId);
  const productId = Number(req.params.productId);
  const { description, specs } = req.body;
  const updates = [];
  const params = [tenantId, productId];
  if (description !== undefined) {
    params.push(description);
    updates.push(`description = $${params.length}`);
  }
  if (specs !== undefined) {
    params.push(JSON.stringify(specs));
    updates.push(`specs = $${params.length}`);
  }
  if (!updates.length) return res.status(400).json({ ok: false, error: 'Nothing to update' });
  const { rows } = await pool.query(
    `UPDATE product SET ${updates.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING id, name, description, specs, sku, base_price, brand, category`,
    params
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Product not found' });
  res.json({ ok: true, data: rows[0] });
}
