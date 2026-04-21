# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# StreetRoller Asist IA — Guía para Claude Code

## Stack
- **Runtime**: Node.js ESM (`.js`, `import/export`)
- **Framework**: Express 5
- **DB**: PostgreSQL en Railway (pool via `pg`)
- **IA**: OpenAI GPT-4o-mini con tool calling (searchProducts / listAllProducts)
- **Canal**: WhatsApp Cloud API (Meta)
- **Deploy**: Railway (servicio `StreetRollerAsist-IA-` + servicio `Postgres`)
- **Testing**: Vitest (70% line coverage threshold)
- **Linting**: ESLint + Prettier

## Development Setup

### Prerequisites
- Node.js >=18
- PostgreSQL client (for migrations; `psql` not required locally)
- Railway CLI (for database access: `npm install -g @railway/cli`)
- OpenAI API key (development requires `OPENAI_API_KEY`)

### Initial Setup
```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Fill required values in .env:
# - DATABASE_URL (use public URL from Railway for local development)
# - OPENAI_API_KEY (required for AI features)
# - ADMIN_API_KEY (optional, for /admin routes)
```

## Running the Application

### Development (with auto-reload)
```bash
npm run dev
```
Starts Express server on `http://localhost:3000` with Nodemon watching for changes.

### Production
```bash
npm start
```

### Server endpoints
- `GET /health` — health check
- `GET /webhooks/whatsapp?hub.verify_token=...` — WhatsApp webhook verification
- `POST /webhooks/whatsapp` — incoming WhatsApp messages
- `POST /webhooks/instagram` — Instagram DM webhook (optional)
- `GET /admin/tenants` — list tenants (requires ADMIN_API_KEY header)
- `GET /products`, `POST /products` — product CRUD (requires API_KEY header per tenant)

## Testing

### Run all tests
```bash
npm test
```

### Watch mode (auto-rerun on changes)
```bash
npm run test:watch
```

### Coverage report
```bash
npm run test:coverage
```
Coverage thresholds: 70% lines/functions/statements, 60% branches. Coverage report saved to `coverage/` directory.

### Test structure
- Tests live in `src/__tests__/` alongside source code
- Naming: `*.test.js` (e.g., `auth.middleware.test.js`)
- Existing coverage:
  - `meta-signature.middleware.test.js` — HMAC signature validation
  - `auth.middleware.test.js` — API key authentication
  - `context.test.js` — in-memory session management
  - `whatsapp-webhook.test.js` — webhook message routing
  - `summarize.service.test.js` — conversation summarization
  - `error-handler.test.js` — error handling middleware

When adding new features, write tests for:
- Middleware (auth, validation, error handling)
- Services that call OpenAI or manipulate data
- Database repositories (mock `pg` pool if needed)
- Complex business logic in controllers

## Code Style

### Lint and format
```bash
npm run lint              # Check for ESLint violations
npm run lint:fix         # Auto-fix violations
npm run format           # Format code with Prettier
npm run format:check     # Check formatting without changes
```

Run `lint` and `format:check` in CI; use `lint:fix` and `format` locally before committing.

### Code conventions
- ESLint config extends `@eslint/js`; Prettier paired with ESLint for formatting
- No decorators or TypeScript (plain JavaScript + JSDoc)
- Error handling: middleware catches and logs errors; controllers return structured JSON
- Database: use repositories (`src/repositories/*.js`) for all DB queries; never inline SQL in controllers

## Debugging Tips

### Common issues

**Database connection fails**
- Check `DATABASE_URL` in `.env` — use public Railway URL for local dev
- Verify SSL mode: `PGSSLMODE=require` for Railway public endpoint
- Connection pool logs: check `LOG_LEVEL=debug` for pool diagnostics

**OpenAI API errors**
- Verify `OPENAI_API_KEY` is valid and has quota
- Check `OPENAI_ENABLED=true` in `.env`
- AI model can be overridden per tenant in DB (`tenant.ai_model`), else uses `OPENAI_MODEL` env var
- Tool call errors logged in `ia.js` — check tool definitions match OpenAI schema

**WhatsApp messages not received**
- Verify webhook URL is publicly accessible (not localhost)
- Check `META_APP_SECRET` in DB (`tenant.meta_app_secret`) matches Meta app settings
- Look for webhook validation failures in `meta-signature.js` — wrong secret → 403
- Message deduplication via in-memory Set (`MAX_DEDUP_SIZE=2000`) — restart clears

**Conversation context not loading**
- `CTX_TTL_MIN` controls session lifetime; expired sessions rehydrate from DB
- Rehydration pulls from `wa_summary` (previous conversation) + `wa_message` (recent turns)
- "reset" / "reiniciar" / "nuevo" command clears RAM context and wa_profile facts

**Second sweep not running**
- Only active if `SUM_SECOND_SWEEP_MIN > 0` (default: 0 = disabled)
- Check logs for `second-sweep.js` errors; sweep runs every `SUM_SWEEP_INTERVAL_SEC` seconds
- Summarization only triggers if `SUM_INACTIVITY_MIN` minutes passed since last message

### Logging
- Log level controlled by `LOG_LEVEL` env var (default: `info`)
- HTTP requests logged via Morgan; disable with `LOG_HTTP=false`
- Pino logger used throughout; format with `pino-pretty` in development

### Interactive debugging
```bash
# Start with debug logs
LOG_LEVEL=debug npm run dev

# Check database directly (via Node)
railway service StreetRollerAsist-IA-
railway run -- node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const res = await pool.query('SELECT * FROM tenant;');
console.log(res.rows);
await pool.end();
"
```

## Testing WhatsApp Webhooks Locally

WhatsApp Cloud API requires a publicly accessible HTTPS webhook URL. For local development, use a tunneling tool:

### Option 1: ngrok (recommended)
```bash
# Download ngrok: https://ngrok.com/download
# In one terminal, start ngrok
ngrok http 3000

# Copy the forwarding URL (e.g., https://abc123.ngrok.io)
# Update webhook URL in Meta App Dashboard to: https://abc123.ngrok.io/webhooks/whatsapp
```

### Option 2: Local testing with curl
```bash
# Simulate incoming WhatsApp message (with valid Meta signature)
curl -X POST http://localhost:3000/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature: sha1=..." \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "...",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": { "phone_number_id": "1128896616964579" },
          "messages": [{
            "id": "wamid.xxx",
            "type": "text",
            "from": "1234567890",
            "text": { "body": "Hola" }
          }]
        }
      }]
    }]
  }'
```
Note: Signature must be valid or middleware will reject (see `meta-signature.js`). For testing, temporarily allow unsigned requests or use the correct secret.

### Testing search products
Once webhook is running, test the AI's product search:
```bash
# Send a product search query via WhatsApp
# The AI will call searchProducts tool internally
# Check logs for tool invocation and database query results
```

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

## Adding New Features

### Typical flow for a new feature

1. **Write tests first** (in `src/__tests__/`)
   - Test the happy path and edge cases
   - For database changes, mock the `pg` pool or use fixtures
   - For AI features, mock OpenAI responses

2. **Implement the feature**
   - Route → Controller → Service → Repository pattern
   - Controllers handle HTTP; services handle business logic; repositories handle DB
   - Middleware for auth, validation, error handling

3. **Add database schema if needed**
   - Create migration file in `migrations/` with clear name (e.g., `004_add_feedback_table.sql`)
   - Test migration locally using the Node script in the CLAUDE.md instructions
   - Include rollback logic or document manual cleanup steps

4. **Update config if new env vars**
   - Add to `.env.example` with comments
   - Update validation in `src/config/env.js` using Zod
   - Document in "Variables de entorno" section of CLAUDE.md

5. **Test locally**
   - Run `npm run dev` and test via curl or Postman
   - Check logs for errors with `LOG_LEVEL=debug npm run dev`
   - For WhatsApp features, use ngrok tunnel or curl simulation

6. **Lint and format before committing**
   - `npm run lint:fix && npm run format`
   - Ensure tests pass: `npm test`

### Common extension points

**Adding a new AI tool** (for product searches or other data lookups)
- Define tool schema in `src/services/ia.js` (add to `tools` array in system prompt)
- Implement handler in same file (tool response goes back to OpenAI)
- Example: `searchProducts` tool calls `products.search.js` repository function
- Test: mock OpenAI response, verify tool handler returns correct data shape

**Adding a new endpoint** (e.g., `/orders/{id}`)
- Create route in `src/routes/orders.routes.js`
- Add controller in `src/controllers/orders.controller.js`
- Add repository query in `src/repositories/order.repository.js`
- Secure with `auth.js` middleware if tenant-scoped
- Test with curl + valid API_KEY header

**Adding a new table or modifying schema**
- Write migration SQL in `migrations/` (numbered sequentially)
- Add repository file if querying from multiple places
- Update table description in this CLAUDE.md for future reference

**Customizing AI behavior per tenant**
- Prompt template: set `tenant.system_prompt`, or use `DEFAULT_TEMPLATE` in `prompt.builder.js`
- Model: override `tenant.ai_model`, else uses `OPENAI_MODEL` env var
- Categories: add to `tenant_category` table with slugs + synonyms for categorization
- Response style: store preferences in `tenant.response_style` JSONB field

### Code patterns to follow

- **Error handling**: throw descriptive errors in services; middleware (`error-handler.js`) catches and logs
- **Logging**: use `logger` from `src/config/logger.js`; include context (tenant_id, wa_id, etc.)
- **Database**: all queries via repositories; use parameterized queries to prevent SQL injection
- **OpenAI calls**: wrapped in try/catch; handle rate limits, token limits, invalid requests gracefully
- **Async flows**: use `async/await`, never mix with `.then()` chains

## Quick Reference

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Run tests | `npm test` |
| Watch tests | `npm run test:watch` |
| Check linting | `npm run lint` |
| Auto-fix linting | `npm run lint:fix` |
| Format code | `npm run format` |
| Check formatting | `npm run format:check` |
| View logs in production | `railway logs --tail` |
| Reset conversation in DB | `UPDATE wa_message SET ... WHERE wa_id = '...'` |
| Disable second sweep | Set `SUM_SECOND_SWEEP_MIN=0` in `.env` |
