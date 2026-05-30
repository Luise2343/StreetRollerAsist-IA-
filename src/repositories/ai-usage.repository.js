// src/repositories/ai-usage.repository.js
// Acceso a la tabla ai_usage: registrar consumo y consultar agregados de costo.
import { pool } from '../config/db.js';
import { logger } from '../config/logger.js';

export const aiUsageRepository = {
  /**
   * Inserta una fila de consumo. Diseñado como fire-and-forget: nunca lanza,
   * para no romper el flujo de respuesta si la DB falla.
   */
  async record({
    tenantId,
    waId = null,
    model,
    purpose = 'agent',
    promptTokens = 0,
    cachedTokens = 0,
    completionTokens = 0,
    totalTokens = 0,
    costUsd = 0
  }) {
    try {
      await pool.query(
        `INSERT INTO ai_usage
           (tenant_id, wa_id, model, purpose, prompt_tokens, cached_tokens,
            completion_tokens, total_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          waId,
          model,
          purpose,
          promptTokens,
          cachedTokens,
          completionTokens,
          totalTokens || promptTokens + completionTokens,
          costUsd
        ]
      );
    } catch (e) {
      logger.warn({ err: e.message, tenantId, model }, 'ai_usage record failed');
    }
  },

  /** Costo total (USD) del mes calendario actual para un tenant. */
  async monthlyCostUSD(tenantId, now = new Date()) {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
         FROM ai_usage
        WHERE tenant_id = $1
          AND created_at >= date_trunc('month', $2::timestamptz)
          AND created_at <  date_trunc('month', $2::timestamptz) + interval '1 month'`,
      [tenantId, now.toISOString()]
    );
    return Number(rows[0]?.total || 0);
  },

  /**
   * Resumen agregado para el dashboard.
   * @param {number} tenantId
   * @param {number} days  ventana en días para el desglose diario
   */
  async summary(tenantId, days = 30) {
    const [month, byModel, daily, monthTokens] = await Promise.all([
      // Costo del mes calendario en curso (lo que cuenta para el tope)
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS cost
           FROM ai_usage
          WHERE tenant_id = $1
            AND created_at >= date_trunc('month', now())`,
        [tenantId]
      ),
      // Desglose por modelo dentro de la ventana
      pool.query(
        `SELECT model,
                COALESCE(SUM(cost_usd), 0)::float AS cost,
                COALESCE(SUM(total_tokens), 0)::int AS tokens
           FROM ai_usage
          WHERE tenant_id = $1
            AND created_at >= now() - ($2 || ' days')::interval
          GROUP BY model
          ORDER BY cost DESC`,
        [tenantId, days]
      ),
      // Costo por día dentro de la ventana
      pool.query(
        `SELECT TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'MM-DD') AS label,
                COALESCE(SUM(cost_usd), 0)::float AS v
           FROM ai_usage
          WHERE tenant_id = $1
            AND created_at >= now() - ($2 || ' days')::interval
          GROUP BY DATE(created_at AT TIME ZONE 'UTC')
          ORDER BY DATE(created_at AT TIME ZONE 'UTC')`,
        [tenantId, days]
      ),
      // Tokens totales del mes en curso
      pool.query(
        `SELECT COALESCE(SUM(total_tokens), 0)::int AS tokens
           FROM ai_usage
          WHERE tenant_id = $1
            AND created_at >= date_trunc('month', now())`,
        [tenantId]
      )
    ]);

    return {
      monthCostUsd: Number(month.rows[0]?.cost || 0),
      monthTokens: Number(monthTokens.rows[0]?.tokens || 0),
      byModel: byModel.rows.map(r => ({
        model: r.model,
        costUsd: Number(r.cost),
        tokens: Number(r.tokens)
      })),
      daily: daily.rows.map(r => ({ label: r.label, v: Number(r.v) }))
    };
  }
};
