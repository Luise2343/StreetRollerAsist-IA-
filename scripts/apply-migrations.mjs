import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.DATABASE_PUBLIC_URL ||
  'postgresql://postgres:BbRgQlKWZVOEXWMUZTgzPfHKiyXWbyHW@shinkansen.proxy.rlwy.net:39330/railway';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node apply-migrations.mjs <migration.sql> [more.sql...]');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: URL, ssl: { rejectUnauthorized: false } });

for (const rel of files) {
  const full = path.resolve(rel);
  const name = path.basename(full);
  const sql = fs.readFileSync(full, 'utf8');
  console.log(`\n--- Applying ${name} ---`);
  try {
    await pool.query(sql);
    console.log(`OK ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    await pool.end();
    process.exit(1);
  }
}
await pool.end();
console.log('\nAll migrations applied.');
