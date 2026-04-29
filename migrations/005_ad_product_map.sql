BEGIN;

CREATE TABLE IF NOT EXISTS ad_product_map (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  ad_id       TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  price       NUMERIC(10,2),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_product_map_lookup ON ad_product_map (tenant_id, ad_id) WHERE active = true;

COMMIT;
