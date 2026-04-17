# StreetRoller Agent — Documentacion Tecnica del Proyecto

## Tabla de Contenidos

1. [Descripcion General](#descripcion-general)
2. [Stack Tecnologico](#stack-tecnologico)
3. [Estructura del Proyecto](#estructura-del-proyecto)
4. [Arquitectura del Sistema](#arquitectura-del-sistema)
5. [Flujo del Agente WhatsApp](#flujo-del-agente-whatsapp)
6. [Esquema de Base de Datos](#esquema-de-base-de-datos)
7. [API REST — Endpoints](#api-rest--endpoints)
8. [Variables de Entorno](#variables-de-entorno)
9. [Politica del Agente IA](#politica-del-agente-ia)
10. [Servicios Internos](#servicios-internos)
11. [Limitaciones y Deuda Tecnica Conocida](#limitaciones-y-deuda-tecnica-conocida)

---

## Descripcion General

**StreetRoller Agent** es un backend Node.js que cumple dos funciones principales:

1. **Agente de ventas conversacional por WhatsApp**: recibe mensajes via Meta WhatsApp Cloud API, procesa el texto con OpenAI (GPT-4o-mini por defecto) usando *function calling* para consultar el catálogo en base de datos, y responde automaticamente. El historial de conversacion se persiste en PostgreSQL con resúmenes automáticos para mantener el contexto sin consumir tokens en exceso.

2. **API REST de gestion del negocio**: CRUD completo de productos, clientes, inventario, ordenes y pagos para la tienda StreetRoller (tienda de patines en linea y clases).

Adicionalmente hay un webhook de Instagram parcialmente implementado (verificacion y log; sin respuestas automaticas aun).

---

## Stack Tecnologico

| Capa | Tecnologia | Version |
|------|-----------|---------|
| Runtime | Node.js (ESM) | >= 18 |
| HTTP Framework | Express | ^5.1.0 |
| Base de Datos | PostgreSQL | >= 14 |
| Driver BD | pg (node-postgres) | ^8.x |
| IA / LLM | OpenAI SDK | ^5.x |
| Variables de Entorno | dotenv | ^17.x |
| CORS | cors | ^2.8.5 |
| Logging HTTP | morgan | ^1.10.1 |
| Dev Server | nodemon | ^3.x |

**Modulos**: El proyecto usa **ESM nativo** (`"type": "module"` en package.json). Todos los imports usan `import/export`.

---

## Estructura del Proyecto

```
streetrolleragent/
├── package.json              # Dependencias, scripts, engines
├── .gitignore
├── README.md                 # README del repo
├── PROJECT.md                # (este archivo) Documentacion tecnica
└── src/
    ├── index.js              # Entry point: configura Express y monta routers
    ├── config/
    │   └── db.js             # Pool de conexiones PostgreSQL
    ├── controllers/          # Handlers de endpoints REST (logica CRUD)
    │   ├── products.controller.js
    │   ├── customers.controller.js
    │   ├── orders.controller.js
    │   ├── payments.controller.js
    │   └── inventory.controller.js
    ├── routes/               # Definicion de rutas Express
    │   ├── products.routes.js
    │   ├── customers.routes.js
    │   ├── orders.routes.js
    │   ├── payments.routes.js
    │   ├── inventory.routes.js
    │   ├── health.routes.js
    │   ├── whatsaap.webhook.js   # Webhook WhatsApp (typo en nombre)
    │   └── instagram.webhook.js  # Webhook Instagram
    ├── services/             # Logica de negocio, IA, contexto
    │   ├── ia.js             # Integracion OpenAI (chat completions + tools)
    │   ├── context.js        # Sesiones de conversacion en memoria RAM
    │   ├── context.rehydrate.js  # Rehidratacion de contexto desde BD
    │   ├── message.store.js  # INSERT de mensajes entrantes/salientes
    │   ├── products.search.js    # Busqueda de productos en BD para IA
    │   ├── summarize.service.js  # Resúmenes automáticos por inactividad
    │   └── second-sweep.js   # Scheduler batch para drenar mensajes antiguos
    └── policy/
        ├── prompts/
        │   └── prompts       # System prompt del agente de ventas
        └── slots.schema.json # Definicion de slots por categoria de producto
```

---

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                        CANALES EXTERNOS                          │
│   [WhatsApp Cloud API]   [Instagram API]   [REST API Clients]   │
└──────────┬───────────────────┬──────────────────┬───────────────┘
           │ POST/GET          │ POST/GET          │ GET/POST/PATCH
           ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                       EXPRESS SERVER (src/index.js)              │
│                                                                  │
│  /webhooks/whatsapp    /webhooks/instagram    /api/*   /health   │
└──────────┬───────────────────┬──────────────────┬───────────────┘
           │                   │                  │
           ▼                   ▼                  ▼
┌──────────────────┐  ┌───────────────┐  ┌────────────────────┐
│  WhatsApp        │  │  Instagram    │  │  Controllers       │
│  Webhook Handler │  │  Webhook      │  │  (products,        │
│                  │  │  Handler      │  │   customers,       │
│  1. Dedupe       │  │  (solo log    │  │   orders,          │
│  2. MarkAsRead   │  │   y ACK)      │  │   payments,        │
│  3. SumIfInact.  │  └───────────────┘  │   inventory)       │
│  4. Ctx RAM+DB   │                     └────────┬───────────┘
│  5. AI Reply     │                              │
│  6. SendWA       │                              │
│  7. LogOutgoing  │                              │
└──────────┬───────┘                              │
           │                                      │
    ┌──────▼──────────────────────────────────────▼──────┐
    │                   SERVICIOS                         │
    │                                                     │
    │  ia.js ──────────────────► OpenAI API              │
    │    └─► products.search.js                          │
    │                                                     │
    │  summarize.service.js ───► OpenAI API              │
    │  context.js (RAM Map)                               │
    │  context.rehydrate.js                               │
    │  message.store.js                                   │
    │  second-sweep.js (scheduler — actualmente          │
    │                   NO conectado a index.js)          │
    └──────────────────────┬──────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ PostgreSQL  │
                    │             │
                    │ product     │
                    │ customer    │
                    │ orders      │
                    │ payment     │
                    │ inventory   │
                    │ wa_message  │
                    │ wa_summary  │
                    │ wa_profile  │
                    └─────────────┘
```

---

## Flujo del Agente WhatsApp

Cada mensaje entrante de texto pasa por este pipeline en `src/routes/whatsaap.webhook.js`:

```
POST /webhooks/whatsapp
        │
        ▼
[1] Parsear payload Meta
        │ (entries → changes → messages)
        ▼
[2] Filtrar solo type === 'text'
        │
        ▼
[3] Dedupe en memoria (Set con límite 2000 IDs)
        │ (si ya visto → skip)
        ▼
[4] markAsRead (Graph API)
        │
        ▼
[5] summarizeIfInactive(from)
        │ Si último mensaje > SUM_INACTIVITY_MIN min:
        │   a. Lee mensajes pendientes desde último to_message_id
        │   b. summarizeCombined(prevSummary, transcript) → OpenAI
        │   c. extractFactsWithAI(transcript) → OpenAI
        │   d. UPSERT wa_summary + wa_profile (transaccion)
        │   e. DELETE mensajes ya resumidos
        ▼
[6] getContext(from) — RAM (turnos recientes)
        │
        ▼
[7] rehydrateContext(from) — DB
        │   wa_profile.facts_json
        │   wa_summary (último)
        │   wa_message (mensajes desde to_message_id)
        ▼
[8] Comando reset? → clearSession + respuesta fija
        │
        ▼
[9] logIncoming → wa_message INSERT
        │
        ▼
[10] aiReplyStrict(text, ctx)
        │   a. Construye messages[] con:
        │      - system prompt (src/policy/prompts/prompts)
        │      - slots schema (src/policy/slots.schema.json)
        │      - last_frame, summary, profileFacts, turns
        │      - user message (truncado a 800 chars)
        │   b. chat.completions.create con tools:
        │      - searchProducts(query, size)
        │      - listAllProducts()
        │   c. Si tool_call → ejecuta funcion real → segunda llamada
        │   d. Retorna texto de respuesta
        ▼
[11] Fallback si reply == null
        │
        ▼
[12] Enviar respuesta por Graph API
        │
        ▼
[13] logOutgoing → wa_message INSERT
        │
        ▼
[14] pushTurn(from, text, reply) → actualiza contexto RAM
        │
        ▼
res.sendStatus(200)
```

### Mecanismo de Contexto

El agente mantiene el contexto de la conversacion en dos capas:

| Capa | Mecanismo | Persistencia | TTL |
|------|-----------|-------------|-----|
| RAM | `Map` por `waId` en `context.js` | Solo en proceso | `CTX_TTL_MIN` minutos |
| DB | Tablas `wa_message`, `wa_summary`, `wa_profile` | Permanente | Sin TTL |

Cuando el proceso reinicia o el contexto RAM expira, `rehydrateContext` reconstruye el contexto desde la base de datos.

### Mecanismo de Resumenes

Para no enviar todo el historial de mensajes a OpenAI en cada llamada (costo y tokens), el sistema comprime conversaciones pasadas:

- **Por inactividad**: si el ultimo mensaje del usuario tiene mas de `SUM_INACTIVITY_MIN` minutos, se genera un resumen acumulado antes de responder.
- **Second sweep**: un scheduler (`second-sweep.js`) procesa en batch los `wa_id` con mensajes pendientes de resumir. **Nota**: actualmente no esta conectado al servidor principal.

---

## Esquema de Base de Datos

El schema se infiere de las queries del codigo (no hay migraciones en el repo).

### Tablas de Negocio

```sql
-- Catalogo de productos
CREATE TABLE product (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  base_price   NUMERIC NOT NULL,
  currency     VARCHAR(3) NOT NULL,
  active       BOOLEAN DEFAULT true,
  size         INT,                  -- talla numerica (solo patines)
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Clientes
CREATE TABLE customer (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ordenes
CREATE TABLE orders (
  id             SERIAL PRIMARY KEY,
  customer_id    INT REFERENCES customer(id),
  product_id     INT REFERENCES product(id),
  qty            INT NOT NULL,
  unit_price     NUMERIC,
  discount_total NUMERIC DEFAULT 0,
  tax_total      NUMERIC DEFAULT 0,
  total          NUMERIC,
  status         TEXT DEFAULT 'new',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Pagos
CREATE TABLE payment (
  id        SERIAL PRIMARY KEY,
  order_id  INT REFERENCES orders(id),
  method    TEXT,
  amount    NUMERIC,
  reference TEXT,
  paid_at   TIMESTAMPTZ
);

-- Inventario
CREATE TABLE inventory (
  id           SERIAL PRIMARY KEY,
  product_id   INT REFERENCES product(id),
  qty_on_hand  INT DEFAULT 0,
  qty_reserved INT DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT now()
);
```

### Tablas del Agente WhatsApp (schema `public`)

```sql
-- Mensajes de conversacion (se purgan tras resumir)
CREATE TABLE public.wa_message (
  id              BIGSERIAL PRIMARY KEY,
  wa_id           TEXT NOT NULL,           -- numero de telefono del cliente
  direction       TEXT NOT NULL,           -- 'in' | 'out'
  provider_msg_id TEXT UNIQUE,             -- ID de Meta (para dedupe)
  body            TEXT,
  msg_type        TEXT DEFAULT 'text',
  meta            JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Resumen acumulado por usuario (1 fila por wa_id, se actualiza)
CREATE TABLE public.wa_summary (
  wa_id            TEXT PRIMARY KEY,
  summary          TEXT,
  facts_json       JSONB,
  from_message_id  BIGINT,
  to_message_id    BIGINT,
  messages_count   INT DEFAULT 0,
  model            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Perfil persistente del cliente (hechos extraidos por IA)
CREATE TABLE public.wa_profile (
  wa_id       TEXT PRIMARY KEY,
  facts_json  JSONB,          -- { name, sizes[], interests[], notes }
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## API REST — Endpoints

Base URL: `http://localhost:PORT`

### Productos

| Metodo | Ruta | Descripcion | Body requerido |
|--------|------|-------------|----------------|
| `GET` | `/api/products` | Lista hasta 50 productos | — |
| `POST` | `/api/products` | Crea un producto | `{ name, basePrice, currency, description?, active? }` |

### Clientes

| Metodo | Ruta | Descripcion | Body requerido |
|--------|------|-------------|----------------|
| `GET` | `/api/customers` | Lista hasta 100 clientes | — |
| `POST` | `/api/customers` | Crea un cliente | `{ name, phone?, email? }` |

### Inventario

| Metodo | Ruta | Descripcion | Body requerido |
|--------|------|-------------|----------------|
| `GET` | `/api/inventory` | Lista inventario con nombre de producto | — |
| `PATCH` | `/api/inventory/:productId/adjust` | Ajusta stock (suma/resta) | `{ delta: number }` |

### Ordenes

| Metodo | Ruta | Descripcion | Body requerido |
|--------|------|-------------|----------------|
| `GET` | `/api/orders` | Lista ordenes con datos de cliente y producto | — |
| `POST` | `/api/orders` | Crea orden (total calculado automaticamente) | `{ customer_id, product_id, qty, unit_price?, discount_total?, tax_total?, status? }` |

### Pagos

| Metodo | Ruta | Descripcion | Body requerido |
|--------|------|-------------|----------------|
| `GET` | `/api/payments` | Lista pagos | — |
| `POST` | `/api/payments` | Registra un pago | `{ order_id, method, amount, reference?, paid_at? }` |

### Salud

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/health` | Estado del servidor: DB ping, mensajes pendientes de resumir, uptime |
| `GET` | `/health/db` | Ping simplificado a la base de datos |

### Webhooks

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/webhooks/whatsapp` | Verificacion del webhook Meta (challenge) |
| `POST` | `/webhooks/whatsapp` | Recepcion de mensajes WhatsApp y respuesta automatica |
| `GET` | `/webhooks/instagram` | Verificacion del webhook Meta Instagram |
| `POST` | `/webhooks/instagram` | Recepcion de eventos Instagram (solo log, sin IA aun) |

---

## Variables de Entorno

Crear un archivo `.env` en la raiz del proyecto con las siguientes variables:

### Servidor

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto HTTP del servidor |
| `NODE_ENV` | — | `production` en produccion (afecta logs de SQL) |
| `LOG_HTTP` | `true` | `0` o `false` para desactivar Morgan |

### Base de Datos

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `DATABASE_URL` | — | **Requerida**. Connection string PostgreSQL. Ej: `postgresql://user:pass@host:5432/db` |
| `PGSSLMODE` | — | `disable` / `false` / `off` para deshabilitar SSL (desarrollo local). En produccion omitir. |

### WhatsApp Cloud API

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `WHATSAPP_TOKEN` | — | **Requerida**. Bearer token de la app de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | — | **Requerida**. Phone Number ID del numero de negocio |
| `WHATSAPP_VERIFY_TOKEN` | — | **Requerida**. Token secreto para verificacion del webhook |
| `META_APP_SECRET` | — | Secreto de la app Meta para validar firma HMAC-SHA256 (recomendado en produccion) |

### Instagram

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `IG_VERIFY_TOKEN` | — | Token para verificacion del webhook de Instagram |
| `META_APP_SECRET` | — | Compartido con WhatsApp para firma HMAC |
| `IG_ACCESS_TOKEN` | — | Token de acceso (para respuestas, no implementado aun) |
| `IG_USER_ID` | — | IG Business User ID (para respuestas, no implementado aun) |

### OpenAI

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | **Requerida**. API Key de OpenAI |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo a usar (afecta tanto agente como resumenes) |
| `OPENAI_ENABLED` | `true` | `false` para deshabilitar IA (modo debug) |
| `AI_LANG` | `es` | Idioma de respuesta (cargado pero no inyectado aun en prompt) |
| `AI_MAX_OUTPUT_TOKENS` | `120` | Limite de tokens en respuestas del agente |

### Contexto y Resumenes

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `CTX_TURNS` | `6` | Numero maximo de turnos a mantener en RAM |
| `CTX_TTL_MIN` | `120` | Minutos de inactividad para expirar sesion en RAM |
| `SUM_INACTIVITY_MIN` | `180` | Minutos de inactividad para disparar resumen |
| `SUM_MAX_MSGS` | `120` | Maximo de mensajes por bloque de resumen |
| `SUM_SECOND_SWEEP_MIN` | `0` | Minutos extra tras `SUM_INACTIVITY_MIN` para el second sweep (`0` = desactivado) |
| `SUM_SWEEP_INTERVAL_SEC` | `300` | Cada cuantos segundos corre el second sweep scheduler |
| `SWEEP_MAX_WA` | `10` | Maximos `wa_id` a procesar por pasada del sweep |
| `SWEEP_MAX_ROUNDS` | `5` | Maximos bloques a drenar por `wa_id` en el sweep |

---

## Politica del Agente IA

### System Prompt (`src/policy/prompts/prompts`)

El agente esta configurado como **asesor de ventas de StreetRoller**. Las reglas clave son:

- Responde en español, tono amable y consultivo.
- Maximo 4 lineas de respuesta, salvo al listar opciones (max 5 items).
- **Nunca afirma "no hay"** sin consultar la base de datos primero.
- Usa un **frame** por conversacion con campos: `category`, `intent`, `slots`, `page`, `negatives`.
- Si falta un **slot critico** de la categoria, hace UNA sola NBQ (Next Best Question).
- **Coherencia**: no se contradice con resultados previos en la misma sesion.
- No menciona detalles tecnicos (SQL, tools, etc.).

### Slots Schema (`src/policy/slots.schema.json`)

Define los slots (atributos necesarios) por categoria de producto:

| Categoria | Sinonimos | Slots Criticos | Slots Opcionales |
|-----------|-----------|---------------|-----------------|
| `patines` | patín, roller, skates | `size` (int, solo digitos) | budget_min, budget_max, brand, notes |
| `cascos` | casco, helmet | `size_label` (S/M/L) | budget_min, budget_max, notes |
| `protecciones` | rodilleras, coderas, muñequeras | `size_label` (S/M/L) | area, pieces, budget, notes |
| `ruedas` | wheel, wheels | `diameter_mm` o `hardnessA` | pack_size, budget, brand, notes |
| `clases` | lecciones, curso, coaching | `type`, `day`, `time_range` | level, location, duration, instructor_pref |

### Function Calling

El agente tiene acceso a dos herramientas de base de datos:

| Tool | Descripcion | Parametros |
|------|-------------|-----------|
| `searchProducts` | Busqueda por texto libre + talla | `query: string`, `size: string` |
| `listAllProducts` | Lista todos los productos activos (max 10) | — |

Flujo: primera llamada al modelo → si usa tool → ejecuta funcion SQL → segunda llamada con resultado → respuesta final.

---

## Servicios Internos

### `src/services/ia.js`
Integracion principal con OpenAI. Carga el system prompt y slots schema al iniciar (sync, `fs.readFileSync`). Funcion principal: `aiReplyStrict(userText, ctx)`.

### `src/services/context.js`
`Map` en memoria para sesiones activas. Expone: `getContext`, `pushTurn`, `clearSession`. Eviccion por TTL en cada acceso.

### `src/services/context.rehydrate.js`
Reconstruye el contexto de un `wa_id` desde la base de datos: perfil, resumen y mensajes recientes. Se usa cuando la sesion RAM no existe o expiro.

### `src/services/message.store.js`
Funciones `logIncoming` y `logOutgoing` para persistir mensajes en `wa_message`. Usa `ON CONFLICT (provider_msg_id) DO NOTHING` para idempotencia.

### `src/services/products.search.js`
Queries SQL para que el agente IA consulte el catalogo: `searchProducts` (ILIKE + talla + join inventario) y `listAllProducts`.

### `src/services/summarize.service.js`
Logica de resúmenes por inactividad. Funcion principal: `summarizeIfInactive(waId)`. Usa transacciones PostgreSQL para atomicidad del UPSERT + DELETE.

### `src/services/second-sweep.js`
Scheduler batch para procesar en background conversaciones con mensajes pendientes de resumir. Exporta `startSecondSweepScheduler()` pero **actualmente no se invoca en `index.js`**.

---

## Limitaciones y Deuda Tecnica Conocida

| # | Problema | Impacto | Prioridad |
|---|---------|---------|-----------|
| 1 | `startSecondSweepScheduler()` no conectado en `index.js` | El segundo sweep nunca corre | Alta |
| 2 | `summarizeCombined` no exportada pero importada en `second-sweep.js` | Error en runtime si se activa el sweep | Alta |
| 3 | Webhook WhatsApp sin validacion de firma HMAC | Seguridad: cualquiera puede enviar payloads falsos | Alta |
| 4 | API REST sin autenticacion | Seguridad: endpoints publicos de negocio | Alta |
| 5 | CORS abierto (`cors()` sin restricciones) | Seguridad: cualquier origen puede acceder | Media |
| 6 | Health endpoint duplicado en `index.js` | Comportamiento impredecible | Media |
| 7 | Typo en nombre de archivo: `whatsaap.webhook.js` | Confusion en mantenimiento | Baja |
| 8 | Sin tests automatizados | Riesgo al hacer cambios | Alta |
| 9 | Sin CI/CD | Deploy manual, sin gates de calidad | Media |
| 10 | Sin ESLint/Prettier | Inconsistencia de estilo | Media |
| 11 | Sin migraciones SQL versionadas | El schema no esta en el repo | Media |
| 12 | README con texto de chat pegado | Confusion para nuevos colaboradores | Baja |
| 13 | `console.log/error` sin niveles ni formato JSON | Dificil de parsear en produccion | Media |
| 14 | `e.message` expuesto en respuestas 500 | Leak de informacion interna | Media |
| 15 | Instagram webhook sin IA | Funcionalidad prometida no implementada | Baja |
| 16 | Sin `.env.example` en el repo | Onboarding dificil para nuevos devs | Media |
| 17 | SSL PostgreSQL con `rejectUnauthorized: false` | Vulnerable a MITM en produccion | Media |
| 18 | SQL de UPSERT duplicado en `summarize.service.js` y `second-sweep.js` | Mantenimiento riesgoso | Baja |
