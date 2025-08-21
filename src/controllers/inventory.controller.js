import { pool } from '../config/db.js';

export async function list(_req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT i.id, i.product_id, p.name AS product_name,
             i.qty_on_hand, i.qty_reserved, i.updated_at
      FROM inventory i
      JOIN product p ON p.id = i.product_id
      ORDER BY i.id DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) {
    console.error('DB ERROR (GET /inventory):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}

// Ajusta stock: suma/resta delta a qty_on_hand
export async function adjust(req, res) {
  try {
    const productId = Number(req.params.productId);
    const { delta } = req.body;
    if (!productId || typeof delta !== 'number') {
      return res.status(400).json({ ok:false, error:'productId y delta numérico son obligatorios' });
    }
    const { rows } = await pool.query(`
      UPDATE inventory
      SET qty_on_hand = qty_on_hand + $2,
          updated_at  = NOW()
      WHERE product_id = $1
      RETURNING *;
    `, [productId, delta]);
    if (!rows.length) return res.status(404).json({ ok:false, error:'inventario no encontrado para ese producto' });
    res.json(rows[0]);
  } catch (e) {
    console.error('DB ERROR (PATCH /inventory):', e);
    res.status(500).json({ ok:false, error: e.message });
  }
}
