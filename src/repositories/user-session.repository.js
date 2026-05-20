// src/repositories/user-session.repository.js
import { pool } from '../config/db.js';

export async function create({ userId, tenantId, refreshTokenHash, expiresAt, userAgent, ip }) {
  const result = await pool.query(
    `INSERT INTO user_session (user_id, tenant_id, refresh_token_hash, expires_at, user_agent, ip, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING id, user_id, tenant_id, refresh_token_hash, expires_at, revoked_at, user_agent, ip, created_at`,
    [userId, tenantId, refreshTokenHash, expiresAt, userAgent, ip]
  );
  return result.rows[0];
}

export async function findByTokenHash(tokenHash) {
  const result = await pool.query(
    `SELECT id, user_id, tenant_id, refresh_token_hash, expires_at, revoked_at, user_agent, ip, created_at
     FROM user_session
     WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function revoke(sessionId) {
  const result = await pool.query(
    `UPDATE user_session
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, user_id, tenant_id, refresh_token_hash, expires_at, revoked_at, user_agent, ip, created_at`,
    [sessionId]
  );
  return result.rows[0];
}

export async function revokeAllForUser(userId) {
  const result = await pool.query(
    `UPDATE user_session
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND revoked_at IS NULL
     RETURNING id, user_id, tenant_id, refresh_token_hash, expires_at, revoked_at, user_agent, ip, created_at`,
    [userId]
  );
  return result.rows;
}

export async function deleteExpired() {
  const result = await pool.query(
    `DELETE FROM user_session
     WHERE expires_at < CURRENT_TIMESTAMP
     RETURNING id`
  );
  return result.rows.length;
}
