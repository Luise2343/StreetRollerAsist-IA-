import 'dotenv/config';
import { Pool } from 'pg';

function getSslOption() {
  const mode = String(process.env.PGSSLMODE || '').toLowerCase();
  if (['disable','false','off'].includes(mode)) return false;
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  // En Railway basta setear DATABASE_URL
  connectionString: process.env.DATABASE_URL,
  ssl: getSslOption(),
  // opcional si usas schema lógico:
  // options: '-c search_path=sragent,public'
});

export async function ping() {
  const { rows } = await pool.query('select 1 as ok');
  return rows[0];
}
