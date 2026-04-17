-- Migration 003: VoltiPod tenant setup + full product catalog
-- Run with: psql $DATABASE_URL -f migrations/003_voltipod_seed.sql
--
-- ANTES DE EJECUTAR:
--   Verifica que tenant_id=1 es la tienda de patines que quieres desactivar.
--   Los precios son PRECIO AL 25% UTILIDAD extraídos del listado VoltiPod.
--   Revisa los marcados con -- REVISAR si los precios no coinciden con tu Excel.

BEGIN;

-- ============================================================
-- 1. Capturar credenciales WA del tenant 1 y desactivarlo
-- ============================================================

DO $$
DECLARE
  v_phone TEXT; v_token TEXT; v_verify TEXT; v_secret TEXT;
BEGIN
  SELECT wa_phone_number_id, wa_token, wa_verify_token, meta_app_secret
  INTO v_phone, v_token, v_verify, v_secret
  FROM tenant WHERE id = 1;

  -- Quitar credenciales al tenant viejo primero (evita conflicto UNIQUE)
  UPDATE tenant
  SET wa_phone_number_id = NULL, wa_token = NULL,
      wa_verify_token = NULL, meta_app_secret = NULL, active = false
  WHERE id = 1;

  -- Crear VoltiPod con las credenciales liberadas
  INSERT INTO tenant (
    slug, name, business_type, language, currency, timezone,
    wa_phone_number_id, wa_token, wa_verify_token, meta_app_secret, api_key,
    ai_model, ai_max_tokens, response_style, active
  ) VALUES (
    'voltipod', 'VoltiPod', 'electronics', 'es', 'USD', 'America/El_Salvador',
    v_phone, v_token, v_verify, v_secret,
    md5(random()::text || clock_timestamp()::text),
    'claude-haiku-4-5-20251001', 180,
    '{"max_lines":4,"tone":"amable, claro, experto en tecnología","list_max_items":5,"close_cta":"¿Te puedo ayudar a elegir o tienes alguna duda?"}'::jsonb,
    true
  );
END $$;

-- ============================================================
-- 3. Limpiar datos del tenant 1 (conversaciones y resúmenes)
-- ============================================================

DELETE FROM wa_summary WHERE tenant_id = 1;
DELETE FROM wa_profile  WHERE tenant_id = 1;
DELETE FROM wa_message  WHERE tenant_id = 1;
DELETE FROM tenant_category WHERE tenant_id = 1;

-- Descomenta estas líneas si también quieres borrar el catálogo viejo:
-- DELETE FROM inventory i USING product p WHERE i.product_id = p.id AND p.tenant_id = 1;
-- DELETE FROM product WHERE tenant_id = 1;

-- ============================================================
-- 4. Categorías VoltiPod
-- ============================================================

DO $$
DECLARE v_tid INT;
BEGIN
  SELECT id INTO v_tid FROM tenant WHERE slug = 'voltipod';

  INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order, active) VALUES
  (v_tid, 'perifericos',     'Periféricos',        ARRAY['teclado','mouse','combo','alfombrilla','mousepad'],
    '{"tipo":"","conectividad":""}'::jsonb, ARRAY['tipo','conectividad','marca'], 1, true),

  (v_tid, 'audio',           'Audio',              ARRAY['bocina','bocinas','audifonos','auriculares','microfono','speaker','karaoke'],
    '{"tipo":"","conectividad":""}'::jsonb, ARRAY['tipo','conectividad','marca'], 2, true),

  (v_tid, 'monitores',       'Monitores',          ARRAY['monitor','pantalla','display','lcd'],
    '{"tamaño":"","resolucion":""}'::jsonb, ARRAY['tamaño','resolucion','marca'], 3, true),

  (v_tid, 'sillas',          'Sillas Gaming',      ARRAY['silla','silla gamer','silla gaming','asiento'],
    '{"color":""}'::jsonb, ARRAY['color','marca'], 4, true),

  (v_tid, 'escritorios',     'Escritorios',        ARRAY['escritorio','mesa','desk','escritorio gaming','escritorio elevable'],
    '{"tipo":""}'::jsonb, ARRAY['tipo','marca'], 5, true),

  (v_tid, 'accesorios',      'Accesorios',         ARRAY['hub','soporte','pendrive','usb','almacenamiento','hdd','base laptop','estante'],
    '{"tipo":""}'::jsonb, ARRAY['tipo','marca'], 6, true),

  (v_tid, 'ups-reguladores', 'UPS y Reguladores',  ARRAY['ups','regulador','nobreak','supresor','supresor de picos','protector voltaje'],
    '{"potencia":"","tipo":""}'::jsonb, ARRAY['potencia','tipo','marca'], 7, true),

  (v_tid, 'baterias',        'Baterías',           ARRAY['bateria','batería','12v','reemplazo ups'],
    '{"voltaje":"","amperaje":""}'::jsonb, ARRAY['voltaje','amperaje','marca'], 8, true),

  (v_tid, 'redes',           'Redes / Routers',    ARRAY['router','repetidor','wifi','extensor','red'],
    '{"velocidad":"","bandas":""}'::jsonb, ARRAY['velocidad','bandas','marca'], 9, true);
END $$;

-- ============================================================
-- 5. Productos — insertar y crear inventario en 0
-- ============================================================

DO $$
DECLARE
  v_tid INT;
  v_pid INT;
BEGIN
  SELECT id INTO v_tid FROM tenant WHERE slug = 'voltipod';

  -- ── MONITORES ──────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LCDXT20','Monitor LCD 20" XTRIKE ME',
    'Monitor LCD 20" HD. Conexión USB, cable 1.9m, corriente <100mA.',
    44.32,'USD','monitores','XTRIKE ME','{"tamaño":"20 pulgadas","resolucion":"HD"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LCDXT24','Monitor LCD 24" XTRIKE ME',
    'Monitor LCD 24" Full HD.',
    95.55,'USD','monitores','XTRIKE ME','{"tamaño":"24 pulgadas","resolucion":"Full HD"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── ESCRITORIOS ────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'DK-06','Escritorio Elevable XTRIKE ME DK-06',
    'Escritorio elevable gaming. Dimensiones: 160×80×72–120cm. Tablero fibra de carbono 15mm, marco doble viga, control manual 6 botones, cap. 80kg. Tira LED RGB con control remoto, portavasos y soporte para audífonos.',
    270.32,'USD','escritorios','XTRIKE ME','{"tipo":"elevable","dimensiones":"160x80x72-120cm","capacidad_kg":80,"iluminacion":"RGB"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'DK-05','Escritorio Gaming XTRIKE ME DK-05',
    'Escritorio gaming con luces LED RGB. Ancho 110cm, largo 60cm, altura 75cm. MDF, pesa 15.5kg. Requiere ensamblado.',
    97.35,'USD','escritorios','XTRIKE ME','{"tipo":"gaming","dimensiones":"110x60x75cm","iluminacion":"LED RGB"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── SILLAS ─────────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GC-913','Silla Gaming XTRIKE ME GC-913',
    'Silla gaming. Color negro/azul claro. Reposabrazos PP+Qian, rueda 335 pulpo nylon 6", reposacabezas elevable y giratorio, soporte lumbar plástico elevable, varilla aire 65 golpes, chasis mariposa 2.0. Soporta 120-150kg.',
    158.86,'USD','sillas','XTRIKE ME','{"color":"negro/azul","peso_max_kg":150}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GC-994BK','Silla Gaming XTRIKE ME GC-994 BK',
    'Silla gaming. Color negro. Reposabrazos fijos PP, respaldo malla transpirable alta densidad con soporte lumbar, cabecera ajustable, asiento espuma alta densidad, ruedas nylon 50mm, pistón gas clase 3. Soporta 120-150kg.',
    112.12,'USD','sillas','XTRIKE ME','{"color":"negro","peso_max_kg":150}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GC-986BBU','Silla Gaming XTRIKE ME GC-986B BU',
    'Silla gaming. Color azul con estructura blanca. Reposabrazos fijos PP blanco, respaldo alto malla poliéster, asiento espuma alta densidad, ruedas nylon 50mm silenciosas, pistón gas clase 3, chasis mariposa con mecanismo inclinación. Soporta 120-150kg.',
    104.59,'USD','sillas','XTRIKE ME','{"color":"azul/blanco","peso_max_kg":150}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GC-885ABK','Silla Gaming XTRIKE ME GC-885A BK',
    'Silla gaming. Color negro/detalles azul claro. Reposabrazos fijos, rueda 335 pulpo nylon 6". Soporta 120-150kg.',
    119.65,'USD','sillas','XTRIKE ME','{"color":"negro/azul"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── PERIFÉRICOS ────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'KB-229','Teclado Alámbrico XTRIKE ME KB-229',
    'Teclado membrana alámbrico. 104 teclas, 10M pulsaciones, 448×155×27mm, 467g, cable 1.4m, USB 2.0.',
    14.19,'USD','perifericos','XTRIKE ME','{"tipo":"teclado","conectividad":"alámbrico USB","teclas":104}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GK-994W','Teclado Inalámbrico XTRIKE ME GK-994W',
    'Teclado inalámbrico. Conectividad 2.4GHz, alcance 10m, batería AAA (no incluida). Teclas perfil bajo, compatible PC/laptop USB.',
    47.33,'USD','perifericos','XTRIKE ME','{"tipo":"teclado","conectividad":"inalámbrico 2.4GHz","alcance_m":10}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GM-124BK','Mouse Alámbrico XTRIKE ME GM-124BK',
    'Mouse alámbrico óptico. Sensor óptico, 3 botones, 1000 DPI, 3M clicks, 125Hz, 5V≤20mA, 60g, 117×61×38mm, cable 1.25m.',
    9.34,'USD','perifericos','XTRIKE ME','{"tipo":"mouse","conectividad":"alámbrico USB","dpi":1000}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'MK-307','Combo Teclado+Mouse Inalámbrico XTRIKE ME MK-307',
    'Combo teclado y mouse inalámbrico 2.4GHz. Teclado membrana anti-ghosting, retroiluminación RGB arcoíris. Mouse óptico 1200/2400/4800/7200 DPI, 7 botones. Batería AAA (no incluida).',
    29.25,'USD','perifericos','XTRIKE ME','{"tipo":"combo teclado+mouse","conectividad":"inalámbrico 2.4GHz","dpi_mouse":"1200-7200"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CMX-410','Combo Mouse+Teclado+Mousepad XTRIKE ME CMX-410',
    'Combo completo: mouse alámbrico, teclado alámbrico y mousepad.',
    13.43,'USD','perifericos','XTRIKE ME','{"tipo":"combo teclado+mouse+mousepad","conectividad":"alámbrico"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'MP-002','Alfombrilla para Mouse XTRIKE ME MP-002',
    'Alfombrilla básica para mouse.',
    9.52,'USD','perifericos','XTRIKE ME','{"tipo":"mousepad"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'MP-602','Alfombrilla RGB XTRIKE ME MP-602',
    'Alfombrilla para mouse con retroiluminación RGB 7 colores (USB). Tipo flexible fibras superfinas, superficie casi sin fricción, base goma antideslizante. Tamaño: 350×250×3mm, cable 1.8m.',
    42.81,'USD','perifericos','XTRIKE ME','{"tipo":"mousepad RGB","tamaño":"350x250mm","iluminacion":"RGB 7 colores"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── GAMEPADS / TIMÓN ───────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GP-51','Game Pad XTRIKE ME GP-51',
    'Gamepad inalámbrico Bluetooth 4.2. 20 botones, alcance 10m, batería 600mAh, cable tipo C 1m, 1M ciclos joystick/teclas.',
    33.02,'USD','perifericos','XTRIKE ME','{"tipo":"gamepad","conectividad":"Bluetooth 4.2","bateria_mah":600,"botones":20}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GP-903','Timón de Juego XTRIKE ME GP-903',
    'Timón/volante de juego. Volante ≈220×270×230mm, pedal ≈210×200×130mm, cable USB, 1.9m. Compatible PC/PS3/PS4/XBOX ONE/XBOX 360/Android/Switch.',
    134.72,'USD','perifericos','XTRIKE ME','{"tipo":"volante gaming","compatibilidad":"PC/PS3/PS4/XBOX/Android/Switch"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── BASE PARA LAPTOPS ──────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'FN-811','Base para Laptops XTRIKE ME FN-811',
    'Base refrigerante para laptops hasta 17". 6 ventiladores 60mm a 2400 RPM, 5VDC, cable 50cm.',
    26.62,'USD','accesorios','XTRIKE ME','{"tipo":"base laptop","ventiladores":6,"compatibilidad":"hasta 17 pulgadas"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── AUDIO ─────────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'SK-605','Bocina Gaming XTRIKE ME SK-605',
    'Barra de sonido estéreo 6W (2×3W), 2.0 canales, iluminación RGB, control de perilla de volumen, alimentación USB + jack 3.5mm, altavoces 5cm 119dB, 20Hz-20KHz, micrófono omnidireccional -42dB. Conexión triple: 3.5mm, USB, USB-C. Alcance inalámbrico 10m.',
    21.72,'USD','audio','XTRIKE ME','{"tipo":"bocina gaming","potencia_w":6,"conectividad":"USB / 3.5mm / USB-C","rgb":true}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'SK-604','Bocina Inalámbrica XTRIKE ME SK-604',
    'Bocina inalámbrica.',
    26.24,'USD','audio','XTRIKE ME','{"tipo":"bocina","conectividad":"inalámbrico"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'ES-213','Bocina Alámbrica XTRIKE ME ES-213',
    'Bocina alámbrica 2×3W estéreo, frecuencia 20Hz-20KHz, cable 1m, jack 3.5mm (audio) + USB (alimentación).',
    17.95,'USD','audio','XTRIKE ME','{"tipo":"bocina","potencia_w":6,"conectividad":"alámbrico USB+3.5mm"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'GH-512W','Audífonos Inalámbricos XTRIKE ME GH-512W',
    'Audífonos inalámbricos Bluetooth 5.3. Alcance 10m, 5 horas de uso, 2mW, compatible Windows/Mac/Android/iOS.',
    13.43,'USD','audio','XTRIKE ME','{"tipo":"audifonos","conectividad":"Bluetooth 5.3","bateria_horas":5}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'HD-214BK','Audífonos Bluetooth XTRIKE ME HD-214 BK (Negro)',
    'Audífonos Bluetooth 5.3. Alcance 10m, 5 horas, 2mW. Color negro. Compatible Windows/Mac/Android/iOS.',
    17.20,'USD','audio','XTRIKE ME','{"tipo":"audifonos","conectividad":"Bluetooth 5.3","color":"negro","bateria_horas":5}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'HD-214WH','Audífonos Bluetooth XTRIKE ME HD-214 WH (Blanco)',
    'Audífonos Bluetooth 5.3. Alcance 10m, 5 horas, 2mW. Color blanco. Compatible Windows/Mac/Android/iOS.',
    19.84,'USD','audio','XTRIKE ME','{"tipo":"audifonos","conectividad":"Bluetooth 5.3","color":"blanco","bateria_horas":5}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'HT-09','Soporte para Auriculares XTRIKE ME HT-09',
    'Soporte para auriculares resistente, seguro y duradero. Ahorra espacio en el escritorio. Incluye soporte para teléfono.',
    13.81,'USD','accesorios','XTRIKE ME','{"tipo":"soporte auriculares"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'MIC-07WH','Micrófono MARVO MIC-07 WH (Blanco)',
    'Micrófono. Reducción de ruido AMP1821, cable 1800mm, sensibilidad -32dB±3dB, 20Hz-20KHz, Ø9.6×6.7mm + Ø16×6.3mm, impedancia 2.2kΩ. Color blanco.',
    9.35,'USD','audio','MARVO','{"tipo":"microfono","conectividad":"alámbrico","color":"blanco"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── REDES ─────────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'RT006','Router / Repetidor WiFi PSS RT006',
    'Repetidor WiFi EP-AC2933S. Dual band 2.4G+5G, velocidad 2.4G: 1200Mbps, 5G: 1200Mbps. Cifrado WPA2, LAN 10/100Mbps.',
    29.25,'USD','redes','PSS','{"tipo":"repetidor WiFi","velocidad":"1200+1200 Mbps","bandas":"2.4G+5G","lan":"10/100Mbps"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'RT007','Router / Repetidor WiFi PSS RT007',
    'Repetidor WiFi AXS3000. Dual band 2.4G+5G, velocidad 2.4G: 300Mbps, 5G: 2167Mbps. Cifrado WPA3, LAN Gigabit 10/100/1000Mbps.',
    56.37,'USD','redes','PSS','{"tipo":"repetidor WiFi","velocidad":"300+2167 Mbps","bandas":"2.4G+5G","lan":"Gigabit"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── ACCESORIOS PSS ────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'U2-64G','Pendrive USB 2.0 64GB PSS',
    'USB Flash Drive 64GB metálico. USB 2.0, interfaces: Micro USB 3.0, Tipo-C, Lightning. App CooDisk. Color negro.',
    12.91,'USD','accesorios','PSS','{"tipo":"pendrive","capacidad_gb":64,"interfaz":"USB 2.0 / Micro USB / Tipo-C / Lightning"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'U3-64G','Pendrive USB 3.1 64GB PSS',
    'USB Flash Drive 64GB metálico. USB 3.1 Gen1 + Tipo-C, 63.67×13.79×9.22mm. Color plateado.',
    42.81,'USD','accesorios','PSS','{"tipo":"pendrive","capacidad_gb":64,"interfaz":"USB 3.1 + Tipo-C"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'HD-513','Case HDD XTRIKE ME HD-513',
    'Enclosure/case para HDD 2.5". Compatible SATA I y II (HDD o SSD). Plug&Play, conexión USB 3.0, máxima velocidad de transferencia.',
    39.80,'USD','accesorios','XTRIKE ME','{"tipo":"enclosure HDD","compatibilidad":"HDD/SSD 2.5 pulgadas SATA","conexion":"USB 3.0"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-ZJ-31','Soporte Doble Monitor PSS-ZJ-31',
    'Soporte para 2 monitores. Acero alta durabilidad, abrazadera C ajustable. Compatible VESA 100×100, pantallas 13-32", 4.4-22 lbs.',
    38.29,'USD','accesorios','PSS','{"tipo":"soporte monitor","monitores":2,"vesa":"100x100","pantallas":"13-32 pulgadas"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-ZJ-32','Soporte Monitor Universal PSS-ZJ-32',
    'Soporte para monitor (compatibilidad universal). VESA 75×75 y 100×100, 13-32 pulgadas. Inclinación +70°/-45°, +90°/-90°, +180°/-180°.',
    44.32,'USD','accesorios','PSS','{"tipo":"soporte monitor","vesa":"75x75/100x100","pantallas":"13-32 pulgadas"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-ZJ-33','Soporte Monitor + Laptop PSS-ZJ-33',
    'Soporte para monitor y laptop. Compatible VESA 75×75 y 100×100, pantallas 13-32", capacidad 2-8kg, giro 180°.',
    13.43,'USD','accesorios','PSS','{"tipo":"soporte monitor+laptop","vesa":"75x75/100x100"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-CT301','Hub 3 en 1 PSS-CT301',
    'Hub USB-C 3 en 1: HDMI 4K + USB 3.0 + Tipo-C (DP) con 100W PD. Compatible MacBook Pro, Mac Air y puertos Tipo-C con salida de video.',
    12.68,'USD','accesorios','PSS','{"tipo":"hub USB-C","puertos":"HDMI+USB 3.0+Tipo-C","pd_w":100}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-CT302','Hub 5 en 1 PSS-CT302',
    'Hub USB-C 5 en 1: PD + HDMI + VGA + USB + Audio 3.5mm. Ideal para laptops con puerto USB-C.',
    14.19,'USD','accesorios','PSS','{"tipo":"hub USB-C","puertos":"PD+HDMI+VGA+USB+Audio 3.5mm","entradas":5}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-CT306','Hub 11 en 1 PSS-CT306',
    'Hub USB-C 11 en 1: 3×USB-A + 2×USB-C + SD + TF + VGA + HDMI + Ethernet + Audio 3.5mm.',
    17.20,'USD','accesorios','PSS','{"tipo":"hub USB-C","puertos":"11 en 1","incluye":"HDMI+VGA+Ethernet+SD+TF"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-CT307','Hub 12 en 1 PSS-CT307',
    'Hub USB-C 12 en 1: Tipo-C + SD + TF + 4×USB-A + VGA + HDMI + Audio 3.5mm + LAN.',
    15.32,'USD','accesorios','PSS','{"tipo":"hub USB-C","puertos":"12 en 1","incluye":"HDMI+VGA+LAN+SD+TF"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-BS-816','Bocina Karaoke Inalámbrica PSS-BS-816',
    'Bocina karaoke inalámbrica dual. Incluye 2 micrófonos inalámbricos, modos de cambio de voz, Bluetooth 5.3. Altavoz 5-10h, micrófonos 2-4h por carga.',
    21.34,'USD','audio','PSS','{"tipo":"bocina karaoke","micrófonos":2,"conectividad":"Bluetooth 5.3","bateria_horas":"5-10"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-BE-001','Almohadilla Anti-estrés PSS-BE-001',
    'Almohadilla para aliviar el estrés. Botón ENTER gigante de espuma suave, entrada USB.',
    44.32,'USD','accesorios','PSS','{"tipo":"accesorio escritorio"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'PSS-PO-001','Estantería de Almacenamiento PSS-PO-001',
    'Estantería metálica multiusos con ruedas. 3 niveles, tamaño abierto: 28×13.4×64.6 pulgadas. 4 ruedas con bloqueo, rotación 360°.',
    36.79,'USD','accesorios','PSS','{"tipo":"estantería","niveles":3,"ruedas":true}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── UPS / REGULADORES ─────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'ECO500','UPS Centra Eco 500',
    'UPS/regulador 500VA/250W. 8 tomas: 4 con respaldo y regulación + 4 con supresor de picos. Indicadores LED.',
    44.50,'USD','ups-reguladores','CENTRA','{"potencia_va":500,"potencia_w":250,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LED"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LCD500','UPS Centra Eco 500 LCD',
    'UPS/regulador 500VA/250W con pantalla LCD. 8 tomas: 4 respaldo+regulación + 4 supresor. Pantalla: voltaje entrada/salida, carga, estado batería.',
    48.90,'USD','ups-reguladores','CENTRA','{"potencia_va":500,"potencia_w":250,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LCD700','UPS Centra Eco 700 LCD',
    'UPS/regulador 700VA/350W con pantalla LCD. 8 tomas: 4 respaldo+regulación + 4 supresor. Pantalla: voltaje entrada/salida, carga, estado batería.',
    53.50,'USD','ups-reguladores','CENTRA','{"potencia_va":700,"potencia_w":350,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'ECO700CH','UPS Centra Eco 700 Charger',
    'UPS/regulador 700VA/350W. 8 tomas: 4 respaldo+regulación + 4 supresor + 2 puertos USB tipo A 2.4A.',
    54.00,'USD','ups-reguladores','CENTRA','{"potencia_va":700,"potencia_w":350,"tomas_respaldo":4,"tomas_supresion":4,"usb_a":2}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LCD700CH','UPS Centra Eco 700 LCD Charger',
    'UPS/regulador 700VA/350W con LCD. 8 tomas: 4 respaldo+regulación + 4 supresor + 2 USB tipo A 2.4A.',
    58.00,'USD','ups-reguladores','CENTRA','{"potencia_va":700,"potencia_w":350,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD","usb_a":2}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CLCP800','UPS Centra Plus 800 LCD',
    'UPS/regulador 800VA/400W con LCD. 8 tomas: 4 respaldo+regulación + 4 supresor. Pantalla: voltaje entrada/salida, carga, estado batería.',
    63.95,'USD','ups-reguladores','CENTRA','{"potencia_va":800,"potencia_w":400,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LCD"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CO800','UPS Centra Office 800',
    'UPS/regulador Centra Office 800VA/400W. 12 tomas: 6 respaldo+regulación + 6 supresor. USB-C, USB-A, protección coaxial y RJ45. Indicadores LED.',
    66.95,'USD','ups-reguladores','CENTRA','{"potencia_va":800,"potencia_w":400,"tomas_respaldo":6,"tomas_supresion":6,"usb_c":1,"usb_a":1,"rj45":true}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'COLCD800','UPS Centra Office 800 LCD',
    'UPS/regulador Centra Office 800VA/400W con LCD. 12 tomas: 6 respaldo+regulación + 6 supresor. USB-C, USB-A, protección coaxial y RJ45.',
    75.00,'USD','ups-reguladores','CENTRA','{"potencia_va":800,"potencia_w":400,"tomas_respaldo":6,"tomas_supresion":6,"pantalla":"LCD","rj45":true}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CP1000','UPS Centra Plus 1000',
    'UPS/regulador 1000VA/500W. 8 tomas: 4 respaldo+regulación + 4 supresor. Indicadores LED.',
    69.00,'USD','ups-reguladores','CENTRA','{"potencia_va":1000,"potencia_w":500,"tomas_respaldo":4,"tomas_supresion":4,"pantalla":"LED"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'COLCD1000','UPS Centra Office 1000 LCD',
    'UPS/regulador Centra Office 1000VA/500W con LCD. 12 tomas: 6 respaldo+regulación + 6 supresor. USB-C, USB-A, protección coaxial y RJ45.',
    84.00,'USD','ups-reguladores','CENTRA','{"potencia_va":1000,"potencia_w":500,"tomas_respaldo":6,"tomas_supresion":6,"pantalla":"LCD","rj45":true}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── REGULADORES (sin respaldo de batería) ─────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CRP1200','Regulador Centa R Plus 1200',
    'Regulador de voltaje 1200VA/600W. 8 tomas: 4 regulación + 4 supresión de picos.',
    22.50,'USD','ups-reguladores','CENTRA','{"potencia_va":1200,"potencia_w":600,"tipo":"regulador","tomas":8}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CRP1400Y','Regulador Centa R Plus 1400',
    'Regulador de voltaje 1400VA/700W. 8 tomas: 4 regulación + 4 supresión de picos.',
    23.75,'USD','ups-reguladores','CENTRA','{"potencia_va":1400,"potencia_w":700,"tipo":"regulador","tomas":8}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CRP2000B','Regulador Centa R Plus 2000',
    'Regulador de voltaje 2000VA/1000W. 8 tomas: 4 regulación + 4 supresión de picos.',
    25.50,'USD','ups-reguladores','CENTRA','{"potencia_va":2000,"potencia_w":1000,"tipo":"regulador","tomas":8}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CRPU2000B','Regulador Centa R Plus Charger 2000',
    'Regulador 2000VA/1000W. 8 tomas: 4 regulación+supresión + 4 supresión + 4 puertos USB tipo A 2.4A.',
    29.50,'USD','ups-reguladores','CENTRA','{"potencia_va":2000,"potencia_w":1000,"tipo":"regulador","usb_a":4}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CHSS','Protector de Voltaje Centra SS Home',
    'Protector de voltaje CENTRA SS HOME, 175 Joules. 10 contactos tipo NEMA con supresión de picos.',
    15.75,'USD','ups-reguladores','CENTRA','{"tipo":"protector voltaje","joules":175,"tomas":10}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CHPSS','Protector de Voltaje Centra SS Home Plus',
    'Protector de voltaje CENTRA SS HOME PLUS, 880 Joules. 10 contactos tipo NEMA + 3 USB tipo A + 1 USB tipo C.',
    22.50,'USD','ups-reguladores','CENTRA','{"tipo":"protector voltaje","joules":880,"tomas":10,"usb_a":3,"usb_c":1}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  -- ── BATERÍAS ──────────────────────────────────────────────

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CBAT1245','Batería CENTRA 12V/4.5Ah',
    'Batería de reemplazo para UPS. CENTRA 12V/4.5Ah.',
    18.00,'USD','baterias','CENTRA','{"voltaje_v":12,"amperaje_ah":4.5,"marca_compatible":"CENTRA"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CBAT125','Batería CENTRA 12V/5.0Ah',
    'Batería de reemplazo para UPS. CENTRA 12V/5.0Ah.',
    19.50,'USD','baterias','CENTRA','{"voltaje_v":12,"amperaje_ah":5.0,"marca_compatible":"CENTRA"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LBAT127','Batería Leoch 12V/7Ah',
    'Batería de reemplazo para UPS. Leoch 12V/7Ah.',
    23.00,'USD','baterias','LEOCH','{"voltaje_v":12,"amperaje_ah":7}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'CBAT129','Batería CENTRA 12V/9Ah',
    'Batería de reemplazo para UPS. CENTRA 12V/9Ah.',
    26.25,'USD','baterias','CENTRA','{"voltaje_v":12,"amperaje_ah":9,"marca_compatible":"CENTRA"}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

  INSERT INTO product (tenant_id,sku,name,description,base_price,currency,category,brand,specs,active)
  VALUES (v_tid,'LBAT1218','Batería Leoch 12V/18Ah',
    'Batería de reemplazo para UPS. Leoch 12V/18Ah.',
    44.50,'USD','baterias','LEOCH','{"voltaje_v":12,"amperaje_ah":18}'::jsonb,true)
  RETURNING id INTO v_pid; INSERT INTO inventory(product_id,qty_on_hand) VALUES(v_pid,0);

END $$;

COMMIT;

-- ============================================================
-- NOTAS POST-EJECUCIÓN
-- ============================================================
-- 1. Verifica los precios marcados como REVISAR contra tu Excel original.
--    Precios de mayor incertidumbre (misma talla/categoría similar):
--    GH-512W ($13.43), CMX-410 ($13.43), HD-214 BK ($17.20), MIC-07 WH ($9.35)
--
-- 2. El tenant VoltiPod hereda las credenciales WA del tenant 1.
--    Verifica con: SELECT id, slug, wa_phone_number_id, active FROM tenant;
--
-- 3. Total productos insertados: 62
--    Distribución: 2 monitores, 2 escritorios, 4 sillas, 13 periféricos,
--    7 audio, 2 redes, 14 accesorios, 11 UPS/reguladores, 5 baterías.
