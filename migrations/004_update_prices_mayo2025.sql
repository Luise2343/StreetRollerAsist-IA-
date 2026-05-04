-- Migration 004: Actualización de precios mayo 2025 + nuevos productos UPS
-- Fuente: LISTA XTRIKE ME DISPONIBLE y LISTA ENERGÍA DISPONIBLE (mayo 2025)

-- ── MONITORES ──────────────────────────────────────────────────────────────
UPDATE product SET base_price = 45 WHERE tenant_id = 3 AND sku = 'LCDXT20';
UPDATE product SET base_price = 98 WHERE tenant_id = 3 AND sku = 'LCDXT24';

-- ── ESCRITORIOS ────────────────────────────────────────────────────────────
UPDATE product SET base_price = 138 WHERE tenant_id = 3 AND sku = 'DK-05';
UPDATE product SET base_price = 277 WHERE tenant_id = 3 AND sku = 'DK-06';

-- ── SILLAS ─────────────────────────────────────────────────────────────────
UPDATE product SET base_price = 163 WHERE tenant_id = 3 AND sku = 'GC-885ABK';
UPDATE product SET base_price = 115 WHERE tenant_id = 3 AND sku = 'GC-986BBU';
UPDATE product SET base_price = 107 WHERE tenant_id = 3 AND sku = 'GC-994BK';
UPDATE product SET base_price = 123 WHERE tenant_id = 3 AND sku = 'GC-913';

-- ── PERIFÉRICOS ────────────────────────────────────────────────────────────
UPDATE product SET base_price = 15  WHERE tenant_id = 3 AND sku = 'KB-229';
UPDATE product SET base_price = 34  WHERE tenant_id = 3 AND sku = 'GK-994W';
UPDATE product SET base_price = 10  WHERE tenant_id = 3 AND sku = 'GM-124BK';
UPDATE product SET base_price = 18  WHERE tenant_id = 3 AND sku = 'MK-307';
UPDATE product SET base_price = 30  WHERE tenant_id = 3 AND sku = 'CMX-410';
UPDATE product SET base_price = 10  WHERE tenant_id = 3 AND sku = 'MP-002';
UPDATE product SET base_price = 13  WHERE tenant_id = 3 AND sku = 'MP-602';
UPDATE product SET base_price = 27  WHERE tenant_id = 3 AND sku = 'GP-51';
UPDATE product SET base_price = 100 WHERE tenant_id = 3 AND sku = 'GP-903';

-- ── AUDIO ──────────────────────────────────────────────────────────────────
UPDATE product SET base_price = 10  WHERE tenant_id = 3 AND sku = 'ES-213';
UPDATE product SET base_price = 22  WHERE tenant_id = 3 AND sku = 'SK-604';
UPDATE product SET base_price = 18  WHERE tenant_id = 3 AND sku = 'SK-605';
UPDATE product SET base_price = 30  WHERE tenant_id = 3 AND sku = 'GH-512W';
UPDATE product SET base_price = 15  WHERE tenant_id = 3 AND sku = 'HD-214BK';
UPDATE product SET base_price = 15  WHERE tenant_id = 3 AND sku = 'HD-214WH';
UPDATE product SET base_price = 49  WHERE tenant_id = 3 AND sku = 'MIC-07WH';
UPDATE product SET base_price = 40  WHERE tenant_id = 3 AND sku = 'PSS-BS-816';

-- ── REDES ──────────────────────────────────────────────────────────────────
UPDATE product SET base_price = 29  WHERE tenant_id = 3 AND sku = 'RT006';
UPDATE product SET base_price = 56  WHERE tenant_id = 3 AND sku = 'RT007';

-- ── ACCESORIOS ─────────────────────────────────────────────────────────────
UPDATE product SET base_price = 20  WHERE tenant_id = 3 AND sku = 'FN-811';
UPDATE product SET base_price = 14  WHERE tenant_id = 3 AND sku = 'HT-09';
UPDATE product SET base_price = 44  WHERE tenant_id = 3 AND sku = 'PSS-ZJ-31';
UPDATE product SET base_price = 41  WHERE tenant_id = 3 AND sku = 'PSS-ZJ-32';
UPDATE product SET base_price = 44  WHERE tenant_id = 3 AND sku = 'PSS-ZJ-33';
UPDATE product SET base_price = 14  WHERE tenant_id = 3 AND sku = 'PSS-BE-001';
UPDATE product SET base_price = 45  WHERE tenant_id = 3 AND sku = 'PSS-PO-001';
UPDATE product SET base_price = 13  WHERE tenant_id = 3 AND sku = 'HD-513';
UPDATE product SET base_price = 15  WHERE tenant_id = 3 AND sku = 'U2-64G';
UPDATE product SET base_price = 18  WHERE tenant_id = 3 AND sku = 'U3-64G';
UPDATE product SET base_price = 16  WHERE tenant_id = 3 AND sku = 'PSS-CT301';
UPDATE product SET base_price = 22  WHERE tenant_id = 3 AND sku = 'PSS-CT302';
UPDATE product SET base_price = 45  WHERE tenant_id = 3 AND sku = 'PSS-CT306';
UPDATE product SET base_price = 38  WHERE tenant_id = 3 AND sku = 'PSS-CT307';

-- ── UPS / REGULADORES (existentes) ─────────────────────────────────────────
UPDATE product SET base_price = 47  WHERE tenant_id = 3 AND sku = 'ECO500';
UPDATE product SET base_price = 52  WHERE tenant_id = 3 AND sku = 'LCD500';
UPDATE product SET base_price = 55  WHERE tenant_id = 3 AND sku = 'LCD700';
UPDATE product SET base_price = 55  WHERE tenant_id = 3 AND sku = 'ECO700CH';
UPDATE product SET base_price = 59  WHERE tenant_id = 3 AND sku = 'LCD700CH';
UPDATE product SET base_price = 66  WHERE tenant_id = 3 AND sku = 'CLCP800';
UPDATE product SET base_price = 69  WHERE tenant_id = 3 AND sku = 'CO800';
UPDATE product SET base_price = 76  WHERE tenant_id = 3 AND sku = 'COLCD800';
UPDATE product SET base_price = 70  WHERE tenant_id = 3 AND sku = 'CP1000';
UPDATE product SET base_price = 86  WHERE tenant_id = 3 AND sku = 'COLCD1000';
UPDATE product SET base_price = 24  WHERE tenant_id = 3 AND sku = 'CRP1200';
UPDATE product SET base_price = 25  WHERE tenant_id = 3 AND sku = 'CRP1400Y';
UPDATE product SET base_price = 28  WHERE tenant_id = 3 AND sku = 'CRP2000B';
UPDATE product SET base_price = 32  WHERE tenant_id = 3 AND sku = 'CRPU2000B';

-- ── UPS NUEVOS (no estaban en la DB) ───────────────────────────────────────
INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'ECO700', 'UPS Centra Eco 700',
  'UPS/regulador 700VA/350W. 8 tomas: 4 con respaldo y regulación + 4 con supresor de picos. Indicadores LED.',
  51, 'USD', 'ups-reguladores', 'CENTRA',
  '{"potencia_va":700,"potencia_w":350,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LED"}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand)
  VALUES ((SELECT id FROM product WHERE tenant_id = 3 AND sku = 'ECO700'), 0);

INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'ECO800', 'UPS Centra Eco 800',
  'UPS/regulador 800VA/400W. 8 tomas: 4 con respaldo y regulación + 4 con supresor de picos. Indicadores LED.',
  55, 'USD', 'ups-reguladores', 'CENTRA',
  '{"potencia_va":800,"potencia_w":400,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LED"}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand)
  VALUES ((SELECT id FROM product WHERE tenant_id = 3 AND sku = 'ECO800'), 0);

INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'LCD800', 'UPS Centra Eco 800 LCD',
  'UPS/regulador 800VA/400W con pantalla LCD. 8 tomas: 4 respaldo+regulación + 4 supresor. Pantalla: voltaje entrada/salida, carga, estado batería.',
  60, 'USD', 'ups-reguladores', 'CENTRA',
  '{"potencia_va":800,"potencia_w":400,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD"}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand)
  VALUES ((SELECT id FROM product WHERE tenant_id = 3 AND sku = 'LCD800'), 0);

INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'CP800', 'UPS Centra Plus 800',
  'UPS/regulador Centra Plus 800VA/400W. 8 tomas: 4 con respaldo y regulación + 4 con supresor de picos. Indicadores LED.',
  61, 'USD', 'ups-reguladores', 'CENTRA',
  '{"potencia_va":800,"potencia_w":400,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LED"}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand)
  VALUES ((SELECT id FROM product WHERE tenant_id = 3 AND sku = 'CP800'), 0);

INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'CLCP1000', 'UPS Centra Plus 1000 LCD',
  'UPS/regulador Centra Plus 1000VA/500W con pantalla LCD. 8 tomas: 4 respaldo+regulación + 4 supresor. Pantalla: voltaje entrada/salida, carga, estado batería.',
  75, 'USD', 'ups-reguladores', 'CENTRA',
  '{"potencia_va":1000,"potencia_w":500,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD"}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand)
  VALUES ((SELECT id FROM product WHERE tenant_id = 3 AND sku = 'CLCP1000'), 0);

INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'CLCP1500', 'UPS Centra Plus 1500 LCD',
  'UPS/regulador Centra Plus 1500VA/750W con pantalla LCD. 10 tomas: 4 con respaldo y regulación + 4 con supresor de picos.',
  133, 'USD', 'ups-reguladores', 'CENTRA',
  '{"potencia_va":1500,"potencia_w":750,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD"}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand)
  VALUES ((SELECT id FROM product WHERE tenant_id = 3 AND sku = 'CLCP1500'), 0);
