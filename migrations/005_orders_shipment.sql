-- Add Boxful shipment fields to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS label_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS courier_name TEXT;
