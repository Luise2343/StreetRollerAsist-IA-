import { pool } from "../config/db.js";

/**
 * Busca por talla (size) y/o texto libre (name/description).
 * Devuelve máx. 5 y adjunta qty_on_hand para que la IA lo use SOLO si el cliente pregunta por disponibilidad.
 */
export async function searchProducts({ text = "", size = null }) {
  const params = [];
  let i = 1;

  let sql = `
    SELECT
      p.id, p.name, p.description,
      p.base_price AS price, p.currency, p.active, p.size,
      COALESCE(i.qty_on_hand, 0) AS qty_on_hand
    FROM product p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.active = true
  `;

  if (text && text.trim()) {
    sql += ` AND (p.name ILIKE $${i} OR p.description ILIKE $${i})`;
    params.push(`%${text}%`); i++;
  }
  if (size) {
    sql += ` AND p.size = $${i}`;
    params.push(Number(size)); i++;
  }

  sql += ` ORDER BY p.name ASC LIMIT 5`;

  if (process.env.NODE_ENV !== "production") {
    console.log("📝 SQL:", sql.replace(/\s+/g, " ").trim());
    console.log("📦 Params:", params);
  }

  const { rows } = await pool.query(sql, params);
  return rows || [];
}

/** Lista general para “¿qué opciones tienes?” (máx. 10) */
export async function listAllProducts() {
  const sql = `
    SELECT
      p.id, p.name, p.description,
      p.base_price AS price, p.currency, p.active, p.size,
      COALESCE(i.qty_on_hand, 0) AS qty_on_hand
    FROM product p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.active = true
    ORDER BY p.name ASC
    LIMIT 10
  `;
  const { rows } = await pool.query(sql);
  return rows || [];
}
