# StreetRoller Asist IA — Guía para Claude Code

## Stack
- **Runtime**: Node.js ESM (`.js`, `import/export`)
- **Framework**: Express 5
- **DB**: PostgreSQL en Railway (pool via `pg`)
- **IA**: OpenAI GPT-4o-mini con tool calling (searchProducts / listAllProducts)
- **Canal**: WhatsApp Cloud API (Meta)
- **Deploy**: Railway (servicio `StreetRollerAsist-IA-` + servicio `Postgres`)

## Conexión a la base de datos

```
# Desde Railway CLI (pública — usar para migraciones locales)
DATABASE_PUBLIC_URL=postgresql://postgres:BbRgQlKWZVOEXWMUZTgzPfHKiyXWbyHW@shinkansen.proxy.rlwy.net:39330/railway

# Interna (solo dentro de Railway, usada por la app en producción)
DATABASE_URL=postgresql://postgres:...@postgres.railway.internal:5432/railway
```

Para correr SQL desde local usar siempre `DATABASE_PUBLIC_URL`.

### Ejecutar migraciones desde local
```bash
railway service StreetRollerAsist-IA-
railway run -- node --input-type=module <<'EOF'
import pg from 'pg';
import fs from 'fs';
const pool = new pg.Pool({
  connectionString: 'postgresql://postgres:BbRgQlKWZVOEXWMUZTgzPfHKiyXWbyHW@shinkansen.proxy.rlwy.net:39330/railway',
  ssl: { rejectUnauthorized: false }
});
const sql = fs.readFileSync('migrations/TU_ARCHIVO.sql', 'utf8');
await pool.query(sql);
console.log('OK');
await pool.end();
EOF
```

`psql` no está instalado localmente — usar siempre el bloque Node de arriba.

## Tenants activos

| id | slug | nombre | WA phone_number_id | activo |
|----|------|--------|-------------------|--------|
| 1  | default | StreetRoller (tienda de patines) | NULL | ❌ desactivado |
| 3  | voltipod | VoltiPod (periféricos/UPS/gaming) | 1128896616964579 | ✅ activo |

El tenant se resuelve automáticamente por `wa_phone_number_id` al llegar un webhook.

## Estructura de archivos clave

```
src/
  app.js                    — Express app, middlewares, rutas
  index.js                  — Entry point, arranca server + second-sweep
  config/
    db.js                   — Pool PostgreSQL
    env.js                  — Validación de variables (Zod, fail-fast)
  routes/
    whatsapp.webhook.js     — Webhook principal (GET verify + POST mensajes)
    admin.routes.js         — CRUD tenants y categorías (requiere ADMIN_API_KEY)
    products.routes.js      — CRUD productos (requiere API_KEY por tenant)
    inventory.routes.js     — Ajuste de stock
    orders.routes.js / customers.routes.js / payments.routes.js
  services/
    ia.js                   — Lógica del agente OpenAI (tool calling)
    context.js              — Sesiones en memoria (RAM, TTL configurable)
    context.rehydrate.js    — Rehidrata contexto desde DB (resumen + turns)
    summarize.service.js    — Genera resúmenes con OpenAI cuando hay inactividad
    second-sweep.js         — Job periódico que drena mensajes viejos a resúmenes
    prompt.builder.js       — Construye system prompt desde tenant + categorías
    products.search.js      — Búsqueda full-text + filtros en PostgreSQL
    whatsapp.client.js      — Envío de mensajes y markAsRead a Meta API
    message.store.js        — Guarda mensajes entrantes/salientes en wa_message
  repositories/             — Acceso a DB (tenant, product, customer, order, etc.)
  middleware/
    tenant.js               — Resuelve tenant por wa_phone_number_id
    meta-signature.js       — Valida firma HMAC de Meta
    auth.js                 — Verifica API_KEY por tenant
    admin-auth.js           — Verifica ADMIN_API_KEY
migrations/
  001_initial_schema.sql    — Schema base
  002_multi_tenant.sql      — Multi-tenant, categorías, campos extendidos
  003_voltipod_seed.sql     — Tenant VoltiPod + 62 productos + categorías
```

## Tablas principales

| Tabla | Descripción |
|-------|-------------|
| `tenant` | Configuración por tienda: WA credentials, ai_model, system_prompt, response_style |
| `tenant_category` | Categorías del negocio: slugs, sinónimos, slots para el agente |
| `product` | Catálogo: sku, name, description, base_price, currency, category, brand, specs (JSONB) |
| `inventory` | Stock: product_id, qty_on_hand, qty_reserved |
| `wa_message` | Log de todos los mensajes (in/out) por tenant+wa_id |
| `wa_summary` | Resúmenes acumulados de conversaciones por tenant+wa_id |
| `wa_profile` | Datos persistentes del cliente (nombre, preferencias) en facts_json (JSONB) |
| `customer` | Clientes registrados |
| `orders` / `payment` | Órdenes y pagos |

## Variables de entorno requeridas

```env
DATABASE_URL=              # URL interna Railway (automática en deploy)
OPENAI_API_KEY=            # Requerida — el agente no funciona sin esto
OPENAI_MODEL=gpt-4o-mini   # Modelo por defecto (se puede sobrescribir por tenant)
```

Variables opcionales importantes:
```env
ADMIN_API_KEY=             # Protege rutas /admin (CRUD tenants/categorías)
SUM_INACTIVITY_MIN=180     # Minutos de inactividad para generar resumen
SUM_SECOND_SWEEP_MIN=0     # 0 = desactivado. Si >0, activa el segundo barrido
CTX_TURNS=6                # Turnos de conversación a mantener en RAM
CTX_TTL_MIN=120            # TTL de la sesión en memoria (minutos)
```

## Lógica del negocio

### Cómo llega un mensaje y se responde

```
Meta WhatsApp → POST /webhooks/whatsapp
  │
  ├─ Validar firma HMAC (meta-signature middleware)
  ├─ Resolver tenant por phone_number_id
  ├─ Ignorar si es status update (delivered/read)
  ├─ Deduplicar por message.id (Set en RAM, max 2000)
  ├─ markAsRead (enviar "leído" a Meta)
  │
  ├─ summarizeIfInactive() — si han pasado >SUM_INACTIVITY_MIN min desde
  │   el último mensaje, genera resumen con OpenAI y lo guarda en wa_summary,
  │   borra esos mensajes de wa_message para no acumular filas indefinidamente
  │
  ├─ getContext() — contexto en RAM (últimos N turnos, TTL configurable)
  ├─ rehydrateContext() — si la sesión RAM expiró, reconstruye desde DB:
  │     • wa_summary → resumen previo
  │     • wa_message → últimos turns recientes (posteriores al resumen)
  │     • wa_profile → facts persistentes del cliente
  │
  ├─ logIncoming() — guarda mensaje en wa_message
  │
  ├─ Comando especial: "reset/reiniciar/nuevo" → limpia sesión RAM
  │
  ├─ aiReplyStrict() — llama a OpenAI con:
  │     system: prompt del tenant + política de categorías
  │     system: slots JSON de categorías
  │     system: last_frame (si existe)
  │     system: resumen previo (de DB)
  │     system: profileFacts del cliente
  │     turns: historial de conversación
  │     user: mensaje actual
  │     tools: searchProducts + listAllProducts
  │
  ├─ Si el modelo llama a searchProducts → busca en DB → devuelve al modelo
  ├─ Si el modelo llama a listAllProducts → lista productos activos
  │
  ├─ sendWaText() — envía respuesta por WhatsApp Cloud API
  ├─ logOutgoing() — guarda respuesta en wa_message
  └─ pushTurn() — agrega turno a la sesión RAM
```

### Second Sweep (job periódico)

Corre cada `SUM_SWEEP_INTERVAL_SEC` segundos (default: 300s = 5 min).
Solo activo si `SUM_SECOND_SWEEP_MIN > 0`.

Busca conversaciones donde `last_message > hace (SUM_INACTIVITY_MIN + SUM_SECOND_SWEEP_MIN) minutos`
y aún tienen mensajes sin resumir. Los drena en resúmenes acumulativos.

**Para desactivarlo**: `SUM_SECOND_SWEEP_MIN=0` (valor por defecto).

### Búsqueda de productos

`searchProducts` hace full-text search en PostgreSQL con filtros opcionales:
- `query` → texto libre (nombre, descripción)
- `category` → slug de categoría
- `brand` → marca
- `priceMin/priceMax` → rango de precio
- `specs.*` → filtros JSONB dinámicos según `db_filterable_specs` de la categoría

### Sistema de prompts

El system prompt se construye por tenant en tiempo real desde:
1. `tenant.system_prompt` (si está configurado) — plantilla custom
2. `DEFAULT_TEMPLATE` en `prompt.builder.js` — plantilla genérica
3. Variables interpoladas: `{{storeName}}`, `{{language}}`, `{{tone}}`, `{{categoriesBlock}}`
4. `response_style` JSONB en el tenant: `max_lines`, `tone`, `list_max_items`, `close_cta`

## Catálogo VoltiPod (tenant_id=3)

### Categorías
`perifericos`, `audio`, `monitores`, `sillas`, `escritorios`, `accesorios`, `ups-reguladores`, `baterias`, `redes`

### Resumen de productos (62 total)
| Categoría | Productos destacados |
|-----------|---------------------|
| Monitores | LCD 20" ($44.32), LCD 24" ($95.55) |
| Escritorios | DK-05 gaming ($97.35), DK-06 elevable ($270.32) |
| Sillas | GC-913 ($158.86), GC-994BK ($112.12), GC-986BBU ($104.59), GC-885ABK ($119.65) |
| Periféricos | Teclados, mice, combos, mousepads XTRIKE ME. Desde $9.34 (mouse) hasta $47.33 (teclado inalámbrico) |
| Audio | Bocinas, audífonos BT, micrófono. Desde $9.35 hasta $21.72 |
| UPS/Reguladores | CENTRA ECO/Plus/Office/R. Desde $15.75 hasta $84.00 |
| Baterías | CENTRA y LEOCH 12V. Desde $18.00 hasta $44.50 |
| Redes | Routers PSS RT006 ($29.25) y RT007 ($56.37) |
| Accesorios | Hubs USB-C, soportes monitores, pendrives, HDD case, bocina karaoke |

**Precios son PRECIO AL 25% UTILIDAD** = (costo × 1.13 + $4.99) ÷ 0.75

## Comandos útiles Railway

```bash
# Ver logs en tiempo real
railway logs --tail

# Correr query SQL
railway service Postgres
railway run -- node --input-type=module -e "..."

# Ver variables de entorno
railway service StreetRollerAsist-IA-
railway variables

# Redesplegar
railway redeploy
```

## Patrones comunes de cambio

### Actualizar precio de un producto
```sql
UPDATE product SET base_price = X WHERE sku = 'CODIGO' AND tenant_id = 3;
```

### Actualizar stock
```sql
UPDATE inventory SET qty_on_hand = X WHERE product_id = (SELECT id FROM product WHERE sku = 'CODIGO');
```

### Cambiar system prompt del tenant
```sql
UPDATE tenant SET system_prompt = '...' WHERE slug = 'voltipod';
-- NULL para volver al DEFAULT_TEMPLATE
```

### Agregar categoría
```sql
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, sort_order, active)
VALUES (3, 'slug', 'Label', ARRAY['sin1','sin2'], '{}'::jsonb, 10, true);
```

### Agregar producto
```sql
INSERT INTO product (tenant_id, sku, name, description, base_price, currency, category, brand, specs, active)
VALUES (3, 'SKU', 'Nombre', 'Descripción', precio, 'USD', 'categoria-slug', 'Marca', '{}'::jsonb, true);
INSERT INTO inventory (product_id, qty_on_hand) VALUES (lastval(), 0);
```
