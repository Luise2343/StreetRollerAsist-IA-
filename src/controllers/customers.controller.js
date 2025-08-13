import { pool } from '../config/db.js';

export async function list(_req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, phone, email, created_at
      FROM customer
      ORDER BY id DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    console.error('DB ERROR (GET /customers):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}

export async function create(req, res) {
  try {
    const { name, phone = null, email = null } = req.body;
    if (!name) return res.status(400).json({ ok:false, error:'name requerido' });
    const { rows } = await pool.query(`
      INSERT INTO customer (name, phone, email)
      VALUES ($1,$2,$3)
      RETURNING id, name, phone, email, created_at
    `, [name, phone, email]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('DB ERROR (POST /customers):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}
