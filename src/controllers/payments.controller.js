import { pool } from '../config/db.js';

export async function list(_req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT id, order_id, method, amount, reference, paid_at
      FROM payment
      ORDER BY id DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    console.error('DB ERROR (GET /payments):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}

export async function create(req, res) {
  try {
    const { order_id, method, amount, reference = null, paid_at = null } = req.body;
    if (!order_id || !method || amount == null) {
      return res.status(400).json({ ok:false, error:'order_id, method y amount son obligatorios' });
    }
    const { rows } = await pool.query(`
      INSERT INTO payment (order_id, method, amount, reference, paid_at)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, order_id, method, amount, reference, paid_at
    `, [order_id, method, amount, reference, paid_at]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('DB ERROR (POST /payments):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}
