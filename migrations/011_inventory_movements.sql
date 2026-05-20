-- 011_inventory_movements.sql
-- Adds inventory movement tracking table and low_stock_threshold column

-- Create inventory_movement table
CREATE TABLE inventory_movement (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,  -- positive = inbound, negative = outbound
  qty_before INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  reason TEXT NOT NULL,  -- manual_adjustment, order_confirmed, order_cancelled, restock, damage, count_correction, other
  reference_type TEXT,  -- 'order' or NULL
  reference_id BIGINT,  -- orders.id when reference_type='order'
  note TEXT,
  user_id BIGINT,  -- FK to app_user (created in future migration)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_inventory_movement_tenant_product_date
  ON inventory_movement(tenant_id, product_id, created_at DESC);

CREATE INDEX idx_inventory_movement_tenant_date
  ON inventory_movement(tenant_id, created_at DESC);

CREATE INDEX idx_inventory_movement_reference
  ON inventory_movement(reference_type, reference_id);

-- Add low_stock_threshold column to inventory table
ALTER TABLE inventory
ADD COLUMN low_stock_threshold INTEGER NOT NULL DEFAULT 0;
