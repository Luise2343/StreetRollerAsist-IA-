// src/repositories/app-user.repository.js
import { pool } from '../config/db.js';

export async function findByEmail(tenantId, email) {
  const result = await pool.query(
    `SELECT id, tenant_id, email, password_hash, full_name, role, active,
            email_verified_at, last_login_at, created_at, updated_at
     FROM app_user
     WHERE tenant_id = $1 AND lower(email) = lower($2)
     LIMIT 1`,
    [tenantId, email]
  );
  return result.rows[0] || null;
}

export async function findById(id) {
  const result = await pool.query(
    `SELECT id, tenant_id, email, password_hash, full_name, role, active,
            email_verified_at, last_login_at, created_at, updated_at
     FROM app_user
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function create({ tenantId, email, passwordHash, fullName, role = 'agent' }) {
  const result = await pool.query(
    `INSERT INTO app_user (tenant_id, email, password_hash, full_name, role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id, tenant_id, email, password_hash, full_name, role, active,
               email_verified_at, last_login_at, created_at, updated_at`,
    [tenantId, email, passwordHash, fullName, role]
  );
  return result.rows[0];
}

export async function updateLastLogin(id) {
  const result = await pool.query(
    `UPDATE app_user
     SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, tenant_id, email, password_hash, full_name, role, active,
               email_verified_at, last_login_at, created_at, updated_at`,
    [id]
  );
  return result.rows[0];
}

export async function updatePassword(id, passwordHash) {
  const result = await pool.query(
    `UPDATE app_user
     SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, tenant_id, email, password_hash, full_name, role, active,
               email_verified_at, last_login_at, created_at, updated_at`,
    [id, passwordHash]
  );
  return result.rows[0];
}

export async function setEmailVerified(id) {
  const result = await pool.query(
    `UPDATE app_user
     SET email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, tenant_id, email, password_hash, full_name, role, active,
               email_verified_at, last_login_at, created_at, updated_at`,
    [id]
  );
  return result.rows[0];
}

export async function listByTenant(tenantId) {
  const result = await pool.query(
    `SELECT id, tenant_id, email, password_hash, full_name, role, active,
            email_verified_at, last_login_at, created_at, updated_at
     FROM app_user
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}
