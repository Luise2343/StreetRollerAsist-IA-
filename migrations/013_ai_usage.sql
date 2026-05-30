-- 013_ai_usage.sql
-- Registro de consumo de tokens y costo estimado por cada llamada a OpenAI.
-- Permite monitorear el gasto de IA por tenant/modelo y aplicar el tope mensual.

CREATE TABLE IF NOT EXISTS ai_usage (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL,
  wa_id             TEXT,
  model             TEXT NOT NULL,
  -- agent | summary | facts | other  (para distinguir el origen del gasto)
  purpose           TEXT NOT NULL DEFAULT 'agent',
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  cached_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created ON ai_usage (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_model   ON ai_usage (tenant_id, model);
