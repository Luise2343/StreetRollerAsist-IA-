-- Migration 012: ad_product junction table + backfill from existing system_prompt
--
-- Persists which products belong to each ad. Until now, products were embedded as
-- frozen text inside ad_product_map.system_prompt. With this table the agent can
-- resolve live product data on every request.
--
-- Backfill strategy: parse [SKU:xxx] markers from existing system_prompt strings.
-- ads.controller.js wrote either `[SKU:${p.sku}]` or `[SKU:${p.id}]` when sku was null.
-- We try sku first; if no match and value is numeric, fall back to product.id.

BEGIN;

CREATE TABLE IF NOT EXISTS ad_product (
  ad_map_id  INT NOT NULL REFERENCES ad_product_map(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_map_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_product_map ON ad_product (ad_map_id);

-- Backfill: extract [SKU:xxx] markers and resolve to product.id
WITH markers AS (
  SELECT
    m.id            AS ad_map_id,
    m.tenant_id,
    trim(match[1])  AS marker,
    ord             AS sort_order
  FROM ad_product_map m
  CROSS JOIN LATERAL regexp_matches(
    COALESCE(m.system_prompt, ''),
    '\[SKU:([^\]]+)\]',
    'g'
  ) WITH ORDINALITY AS r(match, ord)
  WHERE m.system_prompt IS NOT NULL
),
resolved AS (
  SELECT
    mk.ad_map_id,
    mk.sort_order,
    COALESCE(
      (SELECT p.id FROM product p
        WHERE p.tenant_id = mk.tenant_id AND p.sku = mk.marker LIMIT 1),
      CASE WHEN mk.marker ~ '^\d+$' THEN
        (SELECT p.id FROM product p
          WHERE p.tenant_id = mk.tenant_id AND p.id = mk.marker::int LIMIT 1)
      END
    ) AS product_id
  FROM markers mk
)
INSERT INTO ad_product (ad_map_id, product_id, sort_order)
SELECT ad_map_id, product_id, sort_order
FROM resolved
WHERE product_id IS NOT NULL
ON CONFLICT (ad_map_id, product_id) DO NOTHING;

COMMIT;
