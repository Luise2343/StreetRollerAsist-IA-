-- Migration 001: Initial schema
-- Run with: psql $DATABASE_URL -f migrations/001_initial_schema.sql

BEGIN;

-- ============================================================
-- Business tables
-- ============================================================

CREATE TABLE IF NOT EXISTS product (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT,
  base_price  NUMERIC NOT NULL,
  currency    VARCHAR(3) NOT NULL DEFAULT 'USD',
  active      BOOLEAN NOT NULL DEFAULT true,
  size        INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_active ON product (active);
CREATE INDEX IF NOT EXISTS idx_product_size   ON product (size) WHERE size IS NOT NULL;

-- ----

CREATE TABLE IF NOT EXISTS customer (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer (phone) WHERE phone IS NOT NULL;

-- ----

CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  customer_id    INT NOT NULL REFERENCES customer(id),
  product_id     INT NOT NULL REFERENCES product(id),
  qty            INT NOT NULL CHECK (qty > 0),
  unit_price     NUMERIC,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  tax_total      NUMERIC NOT NULL DEFAULT 0,
  total          NUMERIC,
  status         TEXT NOT NULL DEFAULT 'new',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_product  ON orders (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders (status);

-- ----

CREATE TABLE IF NOT EXISTS payment (
  id        SERIAL PRIMARY KEY,
  order_id  INT NOT NULL REFERENCES orders(id),
  method    TEXT NOT NULL,
  amount    NUMERIC NOT NULL,
  reference TEXT,
  paid_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_order ON payment (order_id);

-- ----

CREATE TABLE IF NOT EXISTS inventory (
  id           SERIAL PRIMARY KEY,
  product_id   INT NOT NULL UNIQUE REFERENCES product(id),
  qty_on_hand  INT NOT NULL DEFAULT 0,
  qty_reserved INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- WhatsApp agent tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wa_message (
  id              BIGSERIAL PRIMARY KEY,
  wa_id           TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  provider_msg_id TEXT UNIQUE,
  body            TEXT,
  msg_type        TEXT NOT NULL DEFAULT 'text',
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_message_wa_id      ON public.wa_message (wa_id);
CREATE INDEX IF NOT EXISTS idx_wa_message_created_at ON public.wa_message (created_at);

-- ----

CREATE TABLE IF NOT EXISTS public.wa_summary (
  wa_id            TEXT PRIMARY KEY,
  summary          TEXT,
  facts_json       JSONB,
  from_message_id  BIGINT,
  to_message_id    BIGINT,
  messages_count   INT NOT NULL DEFAULT 0,
  model            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----

CREATE TABLE IF NOT EXISTS public.wa_profile (
  wa_id       TEXT PRIMARY KEY,
  facts_json  JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
