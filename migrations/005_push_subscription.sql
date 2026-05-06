-- Push notification subscriptions (Web Push / VAPID)
CREATE TABLE IF NOT EXISTS push_subscription (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  keys        JSONB NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscription_tenant ON push_subscription(tenant_id);
