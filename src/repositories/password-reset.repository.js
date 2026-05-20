// src/repositories/password-reset.repository.js
import { pool } from '../config/db.js';

export async function create({ userId, tokenHash, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO password_reset (user_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     RETURNING id, user_id, token_hash, expires_at, used_at, created_at`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

export async function findByTokenHash(tokenHash) {
  const result = await pool.query(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at
     FROM password_reset
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function markUsed(resetId) {
  const result = await pool.query(
    `UPDATE password_reset
     SET used_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, user_id, token_hash, expires_at, used_at, created_at`,
    [resetId]
  );
  return result.rows[0];
}
