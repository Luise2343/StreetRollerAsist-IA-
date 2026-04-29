-- Migration 004: add delivery fields to orders for WhatsApp-originated orders
ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wa_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'transferencia'
  CHECK (payment_method IN ('contra_entrega', 'transferencia'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ad_id TEXT;
