-- Migration 006: Add system_prompt to ad_product_map for per-ad agent context
ALTER TABLE ad_product_map ADD COLUMN IF NOT EXISTS system_prompt TEXT;
