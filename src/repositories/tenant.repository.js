// src/repositories/tenant.repository.js
import { pool } from '../config/db.js';

const rowToTenant = (r) =>
  r
    ? {
        id: r.id,
        slug: r.slug,
        name: r.name,
        business_type: r.business_type,
        language: r.language,
        currency: r.currency,
        timezone: r.timezone,
        wa_phone_number_id: r.wa_phone_number_id,
        wa_token: r.wa_token,
        wa_verify_token: r.wa_verify_token,
        meta_app_secret: r.meta_app_secret,
        api_key: r.api_key,
        ai_model: r.ai_model,
        ai_max_tokens: r.ai_max_tokens,
        system_prompt: r.system_prompt,
        response_style: r.response_style,
        active: r.active
      }
    : null;

export const tenantRepository = {
  async findByWaPhoneNumberId(phoneNumberId) {
    if (!phoneNumberId) return null;
    const { rows } = await pool.query(
      `SELECT * FROM tenant WHERE wa_phone_number_id = $1 AND active = true LIMIT 1`,
      [String(phoneNumberId)]
    );
    return rowToTenant(rows[0]);
  },

  async findByApiKey(apiKey) {
    if (!apiKey) return null;
    const { rows } = await pool.query(
      `SELECT * FROM tenant WHERE api_key = $1 AND active = true LIMIT 1`,
      [apiKey]
    );
    return rowToTenant(rows[0]);
  },

  async findByWaVerifyToken(token) {
    if (!token) return null;
    const { rows } = await pool.query(
      `SELECT * FROM tenant WHERE wa_verify_token = $1 AND active = true LIMIT 1`,
      [String(token)]
    );
    return rowToTenant(rows[0]);
  },

  async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM tenant WHERE id = $1 LIMIT 1`, [id]);
    return rowToTenant(rows[0]);
  },

  async listAll({ limit = 200 } = {}) {
    const { rows } = await pool.query(
      `SELECT id, slug, name, business_type, language, currency, active, created_at
       FROM tenant ORDER BY id ASC LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async create(data) {
    const {
      slug,
      name,
      business_type = null,
      language = 'es',
      currency = 'USD',
      timezone = 'America/Mexico_City',
      wa_phone_number_id = null,
      wa_token = null,
      wa_verify_token = null,
      meta_app_secret = null,
      api_key = null,
      ai_model = 'gpt-4o-mini',
      ai_max_tokens = 120,
      system_prompt = null,
      response_style = null,
      active = true
    } = data;
    const { rows } = await pool.query(
      `INSERT INTO tenant (
        slug, name, business_type, language, currency, timezone,
        wa_phone_number_id, wa_token, wa_verify_token, meta_app_secret,
        api_key, ai_model, ai_max_tokens, system_prompt, response_style, active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
      RETURNING *`,
      [
        slug,
        name,
        business_type,
        language,
        currency,
        timezone,
        wa_phone_number_id,
        wa_token,
        wa_verify_token,
        meta_app_secret,
        api_key,
        ai_model,
        ai_max_tokens,
        system_prompt,
        response_style ? JSON.stringify(response_style) : null,
        active
      ]
    );
    return rowToTenant(rows[0]);
  },

  async update(id, patch) {
    const allowed = [
      'name',
      'business_type',
      'language',
      'currency',
      'timezone',
      'wa_phone_number_id',
      'wa_token',
      'wa_verify_token',
      'meta_app_secret',
      'api_key',
      'ai_model',
      'ai_max_tokens',
      'system_prompt',
      'response_style',
      'active'
    ];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        let v = patch[k];
        if (k === 'response_style' && v && typeof v === 'object') v = JSON.stringify(v);
        sets.push(`${k} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return this.findById(id);
    sets.push(`updated_at = now()`);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE tenant SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    return rowToTenant(rows[0]);
  },

  async listCategories(tenantId) {
    const { rows } = await pool.query(
      `SELECT id, tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order, active
       FROM tenant_category
       WHERE tenant_id = $1 AND active = true
       ORDER BY sort_order ASC, id ASC`,
      [tenantId]
    );
    return rows;
  },

  async createCategory(tenantId, data) {
    const {
      slug,
      label,
      synonyms = [],
      slots = {},
      db_filterable_specs = [],
      sort_order = 0,
      active = true
    } = data;
    const { rows } = await pool.query(
      `INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order, active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       RETURNING *`,
      [
        tenantId,
        slug,
        label,
        synonyms,
        JSON.stringify(slots),
        db_filterable_specs,
        sort_order,
        active
      ]
    );
    return rows[0];
  },

  async updateCategory(tenantId, slug, patch) {
    const sets = [];
    const vals = [];
    let i = 1;
    if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
      sets.push(`label = $${i++}`);
      vals.push(patch.label);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'synonyms')) {
      sets.push(`synonyms = $${i++}`);
      vals.push(patch.synonyms);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'slots')) {
      sets.push(`slots = $${i++}::jsonb`);
      vals.push(JSON.stringify(patch.slots));
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'db_filterable_specs')) {
      sets.push(`db_filterable_specs = $${i++}`);
      vals.push(patch.db_filterable_specs);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sort_order')) {
      sets.push(`sort_order = $${i++}`);
      vals.push(patch.sort_order);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
      sets.push(`active = $${i++}`);
      vals.push(patch.active);
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        `SELECT * FROM tenant_category WHERE tenant_id = $1 AND slug = $2 LIMIT 1`,
        [tenantId, slug]
      );
      return rows[0] || null;
    }
    const tIdx = i;
    const sIdx = i + 1;
    vals.push(tenantId, slug);
    const { rows } = await pool.query(
      `UPDATE tenant_category SET ${sets.join(', ')}
       WHERE tenant_id = $${tIdx} AND slug = $${sIdx}
       RETURNING *`,
      vals
    );
    return rows[0] || null;
  }
};
