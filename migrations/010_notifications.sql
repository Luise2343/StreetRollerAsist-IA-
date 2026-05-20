-- Create notification table for persistent notification inbox
-- Notification types (logical enum): new_lead, lead_escalated, human_takeover_requested, new_order, order_status_changed, low_stock, payment_failed, ai_error, system
-- Severity levels: info (default), warning, critical

CREATE TABLE notification (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  target_user_id VARCHAR(255),
  type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) DEFAULT 'info',
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_notification_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE
);

-- Index: For tenant-scoped queries with read_at filtering
CREATE INDEX idx_notification_tenant_read ON notification(tenant_id, read_at) WHERE read_at IS NULL;

-- Index: For tenant + target_user_id queries (when user is available)
CREATE INDEX idx_notification_tenant_user ON notification(tenant_id, target_user_id) WHERE target_user_id IS NOT NULL;

-- Index: For sorting by creation time
CREATE INDEX idx_notification_tenant_created ON notification(tenant_id, created_at DESC);

-- Index: For type filtering within a tenant
CREATE INDEX idx_notification_tenant_type ON notification(tenant_id, type);

-- Comment documenting notification types
COMMENT ON COLUMN notification.type IS 'Logical enum: new_lead, lead_escalated, human_takeover_requested, new_order, order_status_changed, low_stock, payment_failed, ai_error, system';
COMMENT ON COLUMN notification.severity IS 'Severity: info, warning, critical';
COMMENT ON COLUMN notification.data IS 'Flexible JSONB payload for notification metadata (e.g., order_id, lead_id, product_id, user_id for FK resolution when app_user exists)';
COMMENT ON TABLE notification IS 'Persistent notification inbox. target_user_id is nullable pending app_user table creation. FK constraint deferred to future migration.';
