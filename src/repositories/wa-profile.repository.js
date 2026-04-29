// src/repositories/wa-profile.repository.js
import { pool } from '../config/db.js';

export const waProfileRepository = {
  /**
   * Inserts or updates wa_profile, merging facts_json JSONB.
   * @param {number} tenantId
   * @param {string} waId - WhatsApp ID
   * @param {object} facts - Object to merge into facts_json
   * @returns {Promise<object>} Updated profile row
   */
  async upsertProfileFact(tenantId, waId, facts) {
    const { rows } = await pool.query(
      `INSERT INTO wa_profile (tenant_id, wa_id, facts_json)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, wa_id)
       DO UPDATE SET facts_json = wa_profile.facts_json || $3::jsonb, updated_at = NOW()
       RETURNING tenant_id AS "tenantId", wa_id AS "waId", facts_json AS "factsJson", updated_at AS "updatedAt"`,
      [tenantId, waId, JSON.stringify(facts)]
    );
    return rows[0];
  },

  /**
   * Get profile facts for a contact.
   * @param {number} tenantId
   * @param {string} waId
   * @returns {Promise<object|null>} facts_json or null if not found
   */
  async getProfileFacts(tenantId, waId) {
    const { rows } = await pool.query(
      `SELECT facts_json FROM wa_profile WHERE tenant_id = $1 AND wa_id = $2`,
      [tenantId, waId]
    );
    return rows[0]?.facts_json || null;
  },

  async setTakeover(tenantId, waId, value) {
    await pool.query(
      `INSERT INTO wa_profile (tenant_id, wa_id, facts_json, human_takeover)
       VALUES ($1, $2, '{}'::jsonb, $3)
       ON CONFLICT (tenant_id, wa_id)
       DO UPDATE SET human_takeover = $3, updated_at = NOW()`,
      [tenantId, waId, value]
    );
  },

  async isTakeover(tenantId, waId) {
    const { rows } = await pool.query(
      `SELECT human_takeover FROM wa_profile WHERE tenant_id = $1 AND wa_id = $2`,
      [tenantId, waId]
    );
    return rows[0]?.human_takeover ?? false;
  }
};
