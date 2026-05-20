// scripts/seed-admin-user.js
// Crea (o resetea password) un usuario admin para un tenant. Útil para bootstrap.
// Usage: node scripts/seed-admin-user.js --tenant=3 --email=admin@voltipod.local --password=ChangeMe123! --name="Admin VoltiPod" --role=owner
//
// Requiere DATABASE_URL en env (.env).
import 'dotenv/config';
import { hash } from 'argon2';
import { pool } from '../src/config/db.js';

function parseArgs() {
  const args = {};
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const tenantId = parseInt(args.tenant || args.tenantId || '3', 10);
  const email = args.email || 'admin@voltipod.local';
  const password = args.password || 'ChangeMe123!';
  const fullName = args.name || args.fullName || 'Admin';
  const role = args.role || 'owner';

  if (!['owner', 'admin', 'agent'].includes(role)) {
    throw new Error(`role inválido: ${role}`);
  }
  if (password.length < 8) {
    throw new Error('password debe tener mínimo 8 caracteres');
  }

  const passwordHash = await hash(password, { type: 2, timeCost: 3, memoryCost: 65536 });

  const { rows } = await pool.query(
    `INSERT INTO app_user (tenant_id, email, password_hash, full_name, role, email_verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now(), now())
     ON CONFLICT (tenant_id, email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name     = EXCLUDED.full_name,
           role          = EXCLUDED.role,
           active        = TRUE,
           updated_at    = now()
     RETURNING id, tenant_id, email, full_name, role, active`,
    [tenantId, email, passwordHash, fullName, role]
  );

  console.log('OK:', rows[0]);
  await pool.end();
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exitCode = 1;
  pool.end().catch(() => {});
});
