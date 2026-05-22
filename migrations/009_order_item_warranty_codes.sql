-- migrations/009_order_item_warranty_codes.sql
-- Adds model_code and serial_number to order_item and backfills existing rows
-- with deterministic codes matching the logic in src/services/invoice.service.js.
--
-- NOTE ON HASH FUNCTION:
--   The JS invoice service uses SHA-1 (crypto.createHash('sha1')) to produce the
--   4-char uppercase hex suffix in serial_number.
--   pgcrypto is NOT enabled in this database (no prior CREATE EXTENSION pgcrypto found),
--   so the backfill uses MD5 (PostgreSQL built-in, no extension needed).
--   MD5 and SHA-1 produce different bytes for the same seed string, meaning serial_number
--   values for rows that existed before this migration will not match what a live
--   deriveCodes() call would have returned.  This is acceptable: once the value is
--   persisted, invoice.service.js reads item.serial_number directly from DB and never
--   recalculates it (it only falls back to deriveCodes when the column is NULL/missing).
--   New rows created after this migration are written by the JS repository using SHA-1,
--   so they will match exactly.
--
--   To switch to SHA-1 in a future migration (if pgcrypto is enabled):
--     upper(substr(encode(digest(seed_text, 'sha1'), 'hex'), 1, 4))

BEGIN;

-- 1. Add columns idempotently
ALTER TABLE order_item ADD COLUMN IF NOT EXISTS model_code    TEXT;
ALTER TABLE order_item ADD COLUMN IF NOT EXISTS serial_number TEXT;

-- 2. Backfill only rows where model_code IS NULL (safe to re-run)
--
--    Logic mirrors invoice.service.js deriveCodes():
--      brandCode = first 2 chars of sanitized uppercase brand   (fallback 'VP')
--      catCode   = first 3 chars of sanitized uppercase category (fallback 'GEN')
--      yy        = 2-digit year of order.created_at
--      mm        = 2-digit month of order.created_at
--      orderPad  = order.id left-padded to 6 digits
--      itemPad   = 1-based ordinal of order_item within its order, padded to 2 digits
--      productPad= product_id padded to 4 digits
--      hex       = first 4 chars uppercase of MD5('{order_id}:{product_id}:{item_index_0}')
--                  where item_index_0 = itemPad - 1  (0-based, matches JS forEach index)
--      model_code    = brandCode || '/' || catCode || '-' || productPad || '-' || yy
--      serial_number = 'SN-' || brandCode || '-' || yy || mm || '-' || orderPad
--                       || '-' || itemPad || '-' || hex
WITH ranked AS (
  -- Compute row_number (1-based) per order for itemPad, and (rn-1) for the hash seed
  SELECT
    oi.id                                                        AS item_id,
    oi.product_id,
    o.id                                                         AS order_id,
    o.created_at                                                 AS order_created_at,
    COALESCE(
      NULLIF(regexp_replace(upper(COALESCE(p.brand,    '')), '[^A-Z0-9]', '', 'g'), ''),
      'VP'
    )                                                            AS brand_raw,
    COALESCE(
      NULLIF(regexp_replace(upper(COALESCE(p.category, '')), '[^A-Z0-9]', '', 'g'), ''),
      'GEN'
    )                                                            AS cat_raw,
    row_number() OVER (PARTITION BY oi.order_id ORDER BY oi.id) AS rn
  FROM order_item oi
  JOIN orders  o ON o.id = oi.order_id
  JOIN product p ON p.id = oi.product_id
  WHERE oi.model_code IS NULL
),
computed AS (
  SELECT
    item_id,
    -- brandCode: up to 2 chars
    left(brand_raw, 2)                                           AS brand_code,
    -- catCode: up to 3 chars
    left(cat_raw, 3)                                             AS cat_code,
    to_char(order_created_at, 'YY')                             AS yy,
    to_char(order_created_at, 'MM')                             AS mm,
    lpad(order_id::text,  6, '0')                               AS order_pad,
    lpad(rn::text,        2, '0')                               AS item_pad,
    lpad(product_id::text, 4, '0')                              AS product_pad,
    -- hash seed: '{order_id}:{product_id}:{index_0}'  (0-based, same as JS forEach index)
    upper(substr(
      md5(order_id::text || ':' || product_id::text || ':' || (rn - 1)::text),
      1, 4
    ))                                                           AS hex
  FROM ranked
)
UPDATE order_item oi
SET
  model_code    = computed.brand_code
                    || '/' || computed.cat_code
                    || '-' || computed.product_pad
                    || '-' || computed.yy,
  serial_number = 'SN-'
                    || computed.brand_code
                    || '-' || computed.yy || computed.mm
                    || '-' || computed.order_pad
                    || '-' || computed.item_pad
                    || '-' || computed.hex
FROM computed
WHERE oi.id = computed.item_id
  AND oi.model_code IS NULL;

COMMIT;
