import pg from 'pg';
const URL = 'postgresql://postgres:BbRgQlKWZVOEXWMUZTgzPfHKiyXWbyHW@shinkansen.proxy.rlwy.net:39330/railway';
const p = new pg.Pool({ connectionString: URL, ssl: { rejectUnauthorized: false } });

const tables = await p.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND table_name IN ('app_user','user_session','password_reset','notification','inventory_movement')
  ORDER BY table_name
`);
console.log('Tables:', tables.rows.map(x => x.table_name).join(', '));

const col = await p.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='inventory' AND column_name='low_stock_threshold'
`);
console.log('inventory.low_stock_threshold:', col.rows.length ? 'OK' : 'MISSING');

await p.end();
