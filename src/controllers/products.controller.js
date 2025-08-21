import { pool } from '../config/db.js';

export async function list(_req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, description,
             base_price AS "basePrice",
             currency, active, created_at, updated_at
      FROM product
      ORDER BY id DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (e) {
    console.error('DB ERROR (GET /products):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}

export async function create(req, res) {
  try {
    const { name, basePrice, currency, description = null, active = true } = req.body;
    if (!name || basePrice == null || !currency) {
      return res.status(400).json({ ok:false, error:'name, basePrice y currency son obligatorios' });
    }
    const { rows } = await pool.query(`
      INSERT INTO product (name, description, base_price, currency, active)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, name, description,
                base_price AS "basePrice",
                currency, active, created_at, updated_at
    `, [name, description, basePrice, currency, active]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('DB ERROR (POST /products):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}

