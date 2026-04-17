-- Migration 002: Multi-tenant SaaS + product generalization + order_line items
-- Run after 001: psql $DATABASE_URL -f migrations/002_multi_tenant.sql
--
-- After running, set WhatsApp and API access on the default tenant, e.g.:
--   UPDATE tenant SET
--     wa_phone_number_id = 'YOUR_PHONE_NUMBER_ID',
--     wa_token = 'YOUR_TOKEN',
--     wa_verify_token = 'YOUR_VERIFY_TOKEN',
--     api_key = 'your-rest-api-key'
--   WHERE slug = 'default';

BEGIN;

-- ============================================================
-- Tenant core
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  business_type   TEXT,
  language        TEXT NOT NULL DEFAULT 'es',
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  timezone        TEXT DEFAULT 'America/Mexico_City',
  wa_phone_number_id TEXT UNIQUE,
  wa_token           TEXT,
  wa_verify_token    TEXT,
  meta_app_secret    TEXT,
  api_key            TEXT UNIQUE,
  ai_model           TEXT DEFAULT 'gpt-4o-mini',
  ai_max_tokens      INT DEFAULT 120,
  system_prompt      TEXT,
  response_style     JSONB DEFAULT '{"max_lines":4,"tone":"amable, claro, consultivo","list_max_items":5,"close_cta":"¿Quieres ver más o filtrar por algo?"}'::jsonb,
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_active ON tenant (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_tenant_wa_phone ON tenant (wa_phone_number_id) WHERE wa_phone_number_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_category (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,
  label               TEXT NOT NULL,
  synonyms            TEXT[] NOT NULL DEFAULT '{}',
  slots               JSONB NOT NULL DEFAULT '{}',
  db_filterable_specs TEXT[] NOT NULL DEFAULT '{}',
  sort_order          INT NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_category_tenant ON tenant_category (tenant_id);

-- Default tenant (single row for existing data)
INSERT INTO tenant (slug, name, business_type, language, currency, api_key)
SELECT 'default', 'Default Store', 'retail', 'es', 'USD', md5(random()::text || clock_timestamp()::text)
WHERE NOT EXISTS (SELECT 1 FROM tenant LIMIT 1);

-- ============================================================
-- Business: tenant_id + product shape + order_item
-- ============================================================

ALTER TABLE product ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenant(id);
UPDATE product SET tenant_id = (SELECT id FROM tenant ORDER BY id LIMIT 1) WHERE tenant_id IS NULL;
ALTER TABLE product ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE customer ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenant(id);
UPDATE customer SET tenant_id = (SELECT id FROM tenant ORDER BY id LIMIT 1) WHERE tenant_id IS NULL;
ALTER TABLE customer ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenant(id);
UPDATE orders SET tenant_id = (SELECT id FROM tenant ORDER BY id LIMIT 1) WHERE tenant_id IS NULL;
ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_tenant ON product (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_customer_tenant ON customer (tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders (tenant_id);

-- order_item (migrate from single-line orders)
CREATE TABLE IF NOT EXISTS order_item (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES product(id),
  qty         INT NOT NULL CHECK (qty > 0),
  unit_price  NUMERIC NOT NULL,
  subtotal    NUMERIC GENERATED ALWAYS AS (qty * unit_price) STORED
);

CREATE INDEX IF NOT EXISTS idx_order_item_order ON order_item (order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_product ON order_item (product_id);

INSERT INTO order_item (order_id, product_id, qty, unit_price)
SELECT o.id, o.product_id, o.qty, COALESCE(o.unit_price, p.base_price)
FROM orders o
JOIN product p ON p.id = o.product_id
WHERE NOT EXISTS (SELECT 1 FROM order_item oi WHERE oi.order_id = o.id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;
ALTER TABLE orders DROP COLUMN IF EXISTS product_id;
ALTER TABLE orders DROP COLUMN IF EXISTS qty;
ALTER TABLE orders DROP COLUMN IF EXISTS unit_price;

DROP INDEX IF EXISTS idx_orders_product;

UPDATE orders o SET total = (
  SELECT COALESCE(SUM(oi.subtotal), 0) FROM order_item oi WHERE oi.order_id = o.id
) - COALESCE(o.discount_total, 0) + COALESCE(o.tax_total, 0);

-- Product: generic fields (size -> specs.size)
ALTER TABLE product ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE product ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE product ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '{}';
ALTER TABLE product ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE product ADD COLUMN IF NOT EXISTS sku TEXT;

UPDATE product SET specs = specs || jsonb_build_object('size', size) WHERE size IS NOT NULL AND NOT (specs ? 'size');

ALTER TABLE product DROP COLUMN IF EXISTS size;
DROP INDEX IF EXISTS idx_product_size;

CREATE INDEX IF NOT EXISTS idx_product_category ON product (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_product_specs ON product USING GIN (specs);

-- ============================================================
-- WhatsApp tables: tenant scope
-- ============================================================

ALTER TABLE public.wa_message ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenant(id);
UPDATE public.wa_message SET tenant_id = (SELECT id FROM tenant ORDER BY id LIMIT 1) WHERE tenant_id IS NULL;
ALTER TABLE public.wa_message ALTER COLUMN tenant_id SET NOT NULL;

DROP INDEX IF EXISTS idx_wa_message_wa_id;
CREATE INDEX IF NOT EXISTS idx_wa_message_tenant_wa ON public.wa_message (tenant_id, wa_id);
CREATE INDEX IF NOT EXISTS idx_wa_message_created_at ON public.wa_message (created_at);

-- wa_summary: PK (tenant_id, wa_id)
ALTER TABLE public.wa_summary ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenant(id);
UPDATE public.wa_summary SET tenant_id = (SELECT id FROM tenant ORDER BY id LIMIT 1) WHERE tenant_id IS NULL;
ALTER TABLE public.wa_summary ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.wa_summary DROP CONSTRAINT IF EXISTS wa_summary_pkey;
ALTER TABLE public.wa_summary ADD PRIMARY KEY (tenant_id, wa_id);

CREATE INDEX IF NOT EXISTS idx_wa_summary_tenant ON public.wa_summary (tenant_id);

-- wa_profile: PK (tenant_id, wa_id)
ALTER TABLE public.wa_profile ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenant(id);
UPDATE public.wa_profile SET tenant_id = (SELECT id FROM tenant ORDER BY id LIMIT 1) WHERE tenant_id IS NULL;
ALTER TABLE public.wa_profile ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.wa_profile DROP CONSTRAINT IF EXISTS wa_profile_pkey;
ALTER TABLE public.wa_profile ADD PRIMARY KEY (tenant_id, wa_id);

CREATE INDEX IF NOT EXISTS idx_wa_profile_tenant ON public.wa_profile (tenant_id);

COMMIT;
