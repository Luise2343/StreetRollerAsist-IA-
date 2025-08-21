import { pool } from '../config/db.js';

export async function list(_req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.customer_id, c.name AS customer_name,
             o.product_id, p.name AS product_name,
             o.qty, o.unit_price, o.discount_total, o.tax_total, o.total,
             o.status, o.created_at, o.updated_at
      FROM orders o
      JOIN customer c ON c.id = o.customer_id
      JOIN product  p ON p.id = o.product_id
      ORDER BY o.id DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    console.error('DB ERROR (GET /orders):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}

export async function create(req, res) {
  try {
    const { customer_id, product_id, qty,
            unit_price = null, discount_total = 0, tax_total = 0,
            status = 'new' } = req.body;

    if (!customer_id || !product_id || !qty) {
      return res.status(400).json({ ok:false, error:'customer_id, product_id y qty son obligatorios' });
    }

    // Si no llega unit_price, toma el base_price del producto
    const sql = `
      WITH up AS (
        SELECT COALESCE($4, p.base_price) AS unit_price
        FROM product p WHERE p.id = $2
      )
      INSERT INTO orders (customer_id, product_id, qty, unit_price,
                          discount_total, tax_total, total, status)
      SELECT $1, $2, $3, up.unit_price,
             $5, $6, ($3 * up.unit_price) - $5 + $6, $7
      FROM up
      RETURNING *;
    `;
    const params = [customer_id, product_id, qty, unit_price, discount_total, tax_total, status];
    const { rows } = await pool.query(sql, params);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('DB ERROR (POST /orders):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}
