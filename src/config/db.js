import 'dotenv/config';
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  // usa el schema sragent por defecto
  options: '-c search_path=sragent,public'
});

export async function ping() {
  const { rows } = await pool.query('select 1 as ok');
  return rows[0];
}
