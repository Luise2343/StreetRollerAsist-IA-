# Guía de Configuración — StreetRoller Agent

> Estado actual: agente funcionando con número de prueba de Meta (15556293987).
> Este documento cubre todo lo necesario para mover a producción con número real,
> configurar la personalidad del agente y preparar el catálogo de electrónicos.

---

## Tabla de Contenidos

1. [Meta / WhatsApp — Número de prueba vs. número real](#1-meta--whatsapp--número-de-prueba-vs-número-real)
2. [Variables de entorno y tabla tenant](#2-variables-de-entorno-y-tabla-tenant)
3. [Token permanente (System User)](#3-token-permanente-system-user)
4. [Modelo de IA y cómo responde](#4-modelo-de-ia-y-cómo-responde)
5. [Personalidad del agente](#5-personalidad-del-agente)
6. [Catálogo — tienda de electrónicos](#6-catálogo--tienda-de-electrónicos)
7. [Admin API — gestión vía HTTP](#7-admin-api--gestión-vía-http)
8. [Sugerencias de mejora (para plan con Opus)](#8-sugerencias-de-mejora-para-plan-con-opus)

---

## 1. Meta / WhatsApp — Número de prueba vs. número real

### Diferencias clave

| Aspecto | Número de prueba | Número real |
|---|---|---|
| Phone Number ID | `1128896616964579` | El de tu número registrado |
| Destinatarios | Solo los 5 números verificados en Meta | Cualquier usuario de WhatsApp |
| Token | Expira en ~24 horas | Permanente con System User |
| Verificación del negocio | No requerida | Requerida (Business Verification) |
| Límite de mensajes/día | 250 | Depende del nivel (empieza en 1,000) |

### Pasos para agregar tu número real

1. **Ve a** [Meta for Developers](https://developers.facebook.com) → tu App → WhatsApp → API Setup.
2. En **Phone numbers**, haz clic en "Add phone number".
3. Proporciona el número de teléfono al que quieres conectar (puede ser un número de línea fija o celular que no esté vinculado a otra cuenta de WA Business).
4. Meta enviará un SMS o llamada para verificar.
5. Una vez verificado, verás el nuevo **Phone Number ID** en la lista.
6. **Actualiza el tenant en la DB** con el nuevo `wa_phone_number_id`:

```sql
UPDATE tenant SET
  wa_phone_number_id = 'TU_NUEVO_PHONE_NUMBER_ID'
WHERE slug = 'default';
```

### Webhook — registro con número real

El webhook ya está registrado en la app de Meta. Cuando agregas un nuevo número, el mismo webhook recibe sus mensajes siempre que el `phone_number_id` esté en la tabla `tenant`.

Si necesitas registrar el webhook de nuevo:
- URL: `https://TU-DOMINIO-RAILWAY.railway.app/webhooks/whatsapp`
- Verify token: el valor que tienes en `tenant.wa_verify_token`
- Suscribir el campo: `messages`

### Verificación del negocio (Business Verification)

Para enviar mensajes a usuarios que no te han escrito primero (outbound) o para escalar el límite de mensajes, Meta requiere verificar tu negocio:

1. Ve a [Meta Business Suite](https://business.facebook.com) → Configuración → Centro de seguridad.
2. Sube documentos: acta constitutiva, RFC, comprobante de domicilio fiscal (lo que pida según tu país).
3. El proceso toma 1–7 días hábiles.

---

## 2. Variables de entorno y tabla tenant

El sistema usa **dos fuentes** de configuración: variables de entorno en Railway (para el servidor) y la tabla `tenant` en PostgreSQL (para el agente de cada número).

### Variables de entorno en Railway

Ir a Railway → proyecto → servicio → Variables:

| Variable | Valor actual | Descripción |
|---|---|---|
| `DATABASE_URL` | (Railway lo pone automático) | Conexión a Postgres |
| `OPENAI_API_KEY` | `sk-proj-...` | API Key de OpenAI |
| `META_APP_SECRET` | `ea8163093ba97f10345e0cd96984c418` | App Secret de Meta (para validar firma HMAC) |
| `OPENAI_MODEL` | `gpt-4o-mini` | Modelo por defecto si tenant no lo especifica |
| `AI_MAX_OUTPUT_TOKENS` | `120` | Tokens máximos de respuesta por defecto |
| `NODE_ENV` | `production` | Activa optimizaciones y oculta logs SQL |
| `PORT` | (Railway lo asigna) | Puerto del servidor |

### Tabla tenant — configuración por número

Cada fila en la tabla `tenant` representa un número de WhatsApp con sus credenciales y personalidad:

```sql
SELECT
  id, slug, name,
  wa_phone_number_id,  -- Phone Number ID de Meta
  wa_token,            -- Bearer token para enviar mensajes
  wa_verify_token,     -- Token secreto para verificar webhook GET
  meta_app_secret,     -- App Secret (puede estar aquí o en env)
  ai_model,            -- 'gpt-4o-mini' | 'gpt-4o' | 'gpt-4-turbo' ...
  ai_max_tokens,       -- Límite de tokens en respuesta
  system_prompt,       -- NULL usa el template por defecto
  response_style,      -- JSON: tone, max_lines, list_max_items, close_cta
  language,            -- 'es' | 'en'
  currency             -- 'USD' | 'MXN' ...
FROM tenant;
```

Para actualizar un campo vía SQL directo:

```sql
UPDATE tenant SET
  name = 'TechZone Store',
  language = 'es',
  currency = 'MXN',
  ai_model = 'gpt-4o-mini',
  ai_max_tokens = 150
WHERE slug = 'default';
```

O vía la Admin API (ver sección 7).

---

## 3. Token permanente (System User)

> **Problema actual**: el token `EAAZASZCudX8...` que se configuró es temporal y expira en ~24 horas. Cada vez que expire, el agente fallará con error 401.

### Cómo crear un token permanente (System User)

1. Ve a [Meta Business Suite](https://business.facebook.com) → Configuración → Cuentas del sistema.
2. Crea un **System User** (usuario del sistema) de tipo Admin.
3. Haz clic en el system user → "Agregar activos" → selecciona tu App de WhatsApp → da permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Haz clic en "Generar token" → selecciona tu app → marca los permisos `whatsapp_business_messaging`.
5. Copia el token generado — **este no expira**.

6. Actualiza en la DB:
```sql
UPDATE tenant SET wa_token = 'EL_TOKEN_PERMANENTE' WHERE slug = 'default';
```

No se necesita redeploy; el agente lee el token de la DB en cada mensaje.

---

## 4. Modelo de IA y cómo responde

### Modelo

Por defecto se usa **GPT-4o-mini** de OpenAI. Se puede cambiar por tenant en `tenant.ai_model`.

Opciones disponibles (de menor a mayor costo/calidad):
- `gpt-4o-mini` — rápido y barato, suficiente para ventas simples ✓ (actual)
- `gpt-4o` — más inteligente, mejor para catálogos complejos
- `gpt-4-turbo` — alternativa equilibrada

### Flujo de respuesta (Function Calling)

```
Usuario: "¿Tienen iPhone 15 en 256GB?"
         │
         ▼
[1] Construcción del contexto:
    - System prompt (personalidad del agente)
    - Política de slots (categorías y atributos del negocio)
    - Resumen de conversaciones anteriores (si aplica)
    - Últimos N turnos de conversación
    - Mensaje del usuario
         │
         ▼
[2] Primera llamada a OpenAI (GPT-4o-mini)
    → El modelo decide llamar a la tool: searchProducts
    → args: { query: "iPhone 15", category: "smartphones", specs: { storage: "256GB" } }
         │
         ▼
[3] Búsqueda real en PostgreSQL
    → SELECT * FROM product WHERE specs @> '{"storage":"256GB"}' AND name ILIKE '%iPhone 15%'
         │
         ▼
[4] Segunda llamada a OpenAI con los resultados
    → El modelo redacta la respuesta final en lenguaje natural
         │
         ▼
[5] Respuesta enviada por WhatsApp
"📱 Sí tenemos el iPhone 15 de 256GB en $18,999 MXN.
Disponible en negro y azul. ¿Te interesa alguno?"
```

### Parámetros de respuesta

| Parámetro | Dónde se configura | Efecto |
|---|---|---|
| `ai_model` | `tenant.ai_model` | Qué modelo de OpenAI usa |
| `ai_max_tokens` | `tenant.ai_max_tokens` | Largo máximo de respuesta (tokens) |
| `max_lines` | `tenant.response_style.max_lines` | Máximo de líneas por respuesta |
| `list_max_items` | `tenant.response_style.list_max_items` | Máx. productos que lista de un jalón |

### Memoria de conversación

El agente recuerda contexto en dos capas:

| Capa | Qué guarda | Duración |
|---|---|---|
| RAM | Últimos 6 turnos (configurable) | Hasta reinicio del servidor |
| PostgreSQL `wa_summary` | Resumen comprimido de la conversación | Permanente |
| PostgreSQL `wa_profile` | Hechos del cliente (nombre, preferencias) | Permanente |

Si el usuario no escribe por más de 3 horas (`SUM_INACTIVITY_MIN=180`), la conversación se resume automáticamente antes de responder.

---

## 5. Personalidad del agente

### Campos de personalidad en `tenant`

#### `response_style` (JSONB)

Controla el tono y formato de las respuestas:

```json
{
  "tone": "amable, experto en tecnología, sin jerga técnica",
  "max_lines": 4,
  "list_max_items": 5,
  "close_cta": "¿Te ayudo a comparar opciones o ver disponibilidad?"
}
```

Para una tienda de electrónicos, actualizar:

```sql
UPDATE tenant SET response_style = '{
  "tone": "amable, experto en tecnología, directo y claro",
  "max_lines": 5,
  "list_max_items": 4,
  "close_cta": "¿Quieres ver especificaciones completas o comparar modelos?"
}'::jsonb WHERE slug = 'default';
```

#### `system_prompt` (TEXT)

Si `system_prompt` es NULL, se usa el template por defecto que incluye:
- Nombre del negocio (`tenant.name`)
- Idioma (`tenant.language`)
- Tono y límites de `response_style`
- Categorías y slots cargados desde `tenant_category`

Para personalizar completamente, pon el prompt en `tenant.system_prompt`. Las variables disponibles son:
- `{{storeName}}` — nombre del negocio
- `{{language}}` — idioma
- `{{tone}}` — tono del response_style
- `{{maxLines}}` — max_lines
- `{{listMax}}` — list_max_items
- `{{closeCta}}` — close_cta
- `{{categoriesBlock}}` — se reemplaza automáticamente con las categorías de la DB

Ejemplo para electrónicos:

```sql
UPDATE tenant SET
  name = 'TechZone',
  system_prompt = 'Eres un asesor de ventas especialista en electrónicos para {{storeName}}.
Hablas en {{language}} con tono {{tone}}.
Responde en no más de {{maxLines}} líneas. Al listar productos, máx. {{listMax}} opciones.

REGLAS:
1) Siempre consulta la base de datos antes de decir que no hay stock.
2) Si el cliente pregunta por un producto con especificaciones (RAM, almacenamiento, procesador), inclúyelas en la búsqueda.
3) Nunca inventes precios o especificaciones. Solo habla de lo que encuentres en la DB.
4) Si el cliente no especifica modelo exacto, pregunta UNA sola cosa (ej. "¿Buscas laptop para trabajo o gaming?").
5) {{closeCta}}

CATEGORÍAS:
{{categoriesBlock}}'
WHERE slug = 'default';
```

---

## 6. Catálogo — tienda de electrónicos

### Cómo funciona el catálogo

Los productos viven en la tabla `product`. Cada producto tiene:
- `name`, `description`, `base_price`, `currency`
- `category` — slug de categoría (ej. `smartphones`, `laptops`)
- `brand` — marca (ej. `Apple`, `Samsung`)
- `specs` — JSONB libre con cualquier atributo técnico
- `sku` — código interno
- `qty_on_hand` — stock en tabla `inventory`

Las **categorías** en `tenant_category` le dicen al agente cómo buscar y qué preguntar:

### Categorías sugeridas para electrónicos

Ejecutar en la DB (reemplaza `1` con tu tenant_id real):

```sql
-- Smartphones
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order)
VALUES (1, 'smartphones', 'Smartphones', 
  ARRAY['celular', 'teléfono', 'iphone', 'samsung', 'móvil', 'cell'],
  '{"storage": {"type": "string", "critical": true, "hint": "¿Cuánto almacenamiento necesitas? 128GB, 256GB, 512GB?"},
    "color":   {"type": "string", "critical": false},
    "budget":  {"type": "number", "critical": false, "hint": "¿Cuál es tu presupuesto?"}}'::jsonb,
  ARRAY['storage', 'color'],
  1);

-- Laptops
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order)
VALUES (1, 'laptops', 'Laptops y Computadoras',
  ARRAY['laptop', 'computadora', 'notebook', 'macbook', 'pc', 'computador'],
  '{"ram":     {"type": "string", "critical": true,  "hint": "¿Cuánta RAM buscas? 8GB, 16GB, 32GB?"},
    "storage":  {"type": "string", "critical": false},
    "use_case": {"type": "string", "critical": true,  "hint": "¿Para trabajo, estudio o gaming?"},
    "budget":   {"type": "number", "critical": false, "hint": "¿Cuál es tu presupuesto?"}}'::jsonb,
  ARRAY['ram', 'storage', 'processor'],
  2);

-- Tablets
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order)
VALUES (1, 'tablets', 'Tablets',
  ARRAY['tablet', 'ipad', 'tab', 'tableta'],
  '{"storage": {"type": "string", "critical": false},
    "connectivity": {"type": "string", "critical": false, "hint": "¿Con WiFi solo o WiFi + celular?"}}'::jsonb,
  ARRAY['storage', 'connectivity'],
  3);

-- Audífonos
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order)
VALUES (1, 'audifonos', 'Audífonos y Bocinas',
  ARRAY['audífonos', 'auriculares', 'bocina', 'speaker', 'airpods', 'headphones', 'earbuds'],
  '{"type":    {"type": "string", "critical": true,  "hint": "¿Buscas audífonos, earbuds o bocina?"},
    "wireless": {"type": "boolean", "critical": false, "hint": "¿Con o sin cable?"}}'::jsonb,
  ARRAY['type', 'wireless'],
  4);

-- Accesorios
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, db_filterable_specs, sort_order)
VALUES (1, 'accesorios', 'Accesorios',
  ARRAY['funda', 'cargador', 'cable', 'case', 'protector', 'mouse', 'teclado', 'memoria'],
  '{"compatible_with": {"type": "string", "critical": true, "hint": "¿Para qué dispositivo o modelo?"}}'::jsonb,
  ARRAY['compatible_with'],
  5);
```

### Campos de `specs` por categoría (ejemplos)

Los `specs` son JSONB libre — puedes poner lo que necesites. El agente puede filtrar por ellos si están en `db_filterable_specs`.

**Smartphone:**
```json
{
  "storage": "256GB",
  "ram": "8GB",
  "color": "Negro",
  "display": "6.1 pulgadas",
  "battery": "3279 mAh",
  "processor": "A16 Bionic"
}
```

**Laptop:**
```json
{
  "ram": "16GB",
  "storage": "512GB SSD",
  "processor": "M3",
  "display": "13.3 pulgadas",
  "os": "macOS",
  "weight_kg": 1.24
}
```

### Insertar productos de ejemplo

```sql
-- iPhone 15 128GB
INSERT INTO product (tenant_id, name, description, base_price, currency, category, brand, sku, specs)
VALUES (
  1,
  'iPhone 15 128GB',
  'iPhone 15 con chip A16, cámara 48MP, USB-C, Dynamic Island',
  18999, 'MXN', 'smartphones', 'Apple', 'APL-IP15-128-NGR',
  '{"storage":"128GB","ram":"6GB","color":"Negro","display":"6.1 pulgadas","processor":"A16 Bionic"}'::jsonb
);

-- MacBook Air M2
INSERT INTO product (tenant_id, name, description, base_price, currency, category, brand, sku, specs)
VALUES (
  1,
  'MacBook Air M2 8GB 256GB',
  'MacBook Air con chip M2, pantalla Liquid Retina 13.6", batería 18h',
  24999, 'MXN', 'laptops', 'Apple', 'APL-MBA-M2-8-256',
  '{"ram":"8GB","storage":"256GB SSD","processor":"M2","display":"13.6 pulgadas","os":"macOS","weight_kg":1.24}'::jsonb
);

-- AirPods Pro 2
INSERT INTO product (tenant_id, name, description, base_price, currency, category, brand, sku, specs)
VALUES (
  1,
  'AirPods Pro 2da Generación',
  'Cancelación activa de ruido, modo Transparencia, USB-C, chip H2',
  4999, 'MXN', 'audifonos', 'Apple', 'APL-APP-2-USBC',
  '{"type":"earbuds","wireless":true,"anc":true,"connector":"USB-C"}'::jsonb
);
```

### Agregar inventario inicial

```sql
INSERT INTO inventory (product_id, qty_on_hand)
SELECT id, 10 FROM product WHERE tenant_id = 1
ON CONFLICT (product_id) DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand;
```

---

## 7. Admin API — gestión vía HTTP

El servidor expone una Admin API protegida con `ADMIN_API_KEY`. Permite gestionar tenants y categorías sin tocar la DB directamente.

**Header requerido en todas las llamadas:**
```
X-Admin-Key: TU_ADMIN_API_KEY
```

> Configura `ADMIN_API_KEY` en Railway env vars.

### Endpoints Admin

#### Actualizar personalidad del tenant

```bash
curl -X PATCH https://TU-APP.railway.app/admin/tenants/1 \
  -H "X-Admin-Key: tu-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TechZone",
    "language": "es",
    "currency": "MXN",
    "ai_model": "gpt-4o-mini",
    "ai_max_tokens": 150,
    "response_style": {
      "tone": "amable, experto en tecnología, directo y claro",
      "max_lines": 5,
      "list_max_items": 4,
      "close_cta": "¿Quieres ver más opciones o te ayudo con algo específico?"
    }
  }'
```

#### Crear una categoría

```bash
curl -X POST https://TU-APP.railway.app/admin/tenants/1/categories \
  -H "X-Admin-Key: tu-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "smartphones",
    "label": "Smartphones",
    "synonyms": ["celular", "iphone", "samsung", "móvil"],
    "slots": {
      "storage": { "critical": true, "hint": "¿Cuánto almacenamiento necesitas?" },
      "color":   { "critical": false }
    },
    "db_filterable_specs": ["storage", "color"],
    "sort_order": 1
  }'
```

#### Actualizar categoría

```bash
curl -X PATCH https://TU-APP.railway.app/admin/tenants/1/categories/smartphones \
  -H "X-Admin-Key: tu-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "synonyms": ["celular", "iphone", "samsung", "móvil", "cell", "smartphone"]
  }'
```

#### Agregar productos (API de productos)

```bash
curl -X POST https://TU-APP.railway.app/api/products \
  -H "Authorization: Bearer TU-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "iPhone 15 256GB Azul",
    "description": "iPhone 15 chip A16, cámara 48MP, USB-C",
    "base_price": 20999,
    "currency": "MXN",
    "category": "smartphones",
    "brand": "Apple",
    "sku": "APL-IP15-256-AZL",
    "specs": {
      "storage": "256GB",
      "ram": "6GB",
      "color": "Azul",
      "processor": "A16 Bionic"
    }
  }'
```

---

## 8. Sugerencias de mejora (para plan con Opus)

Lo que sigue funcionando pero que vale la pena resolver antes de escalar:

### Crítico para producción

| # | Problema | Solución |
|---|---|---|
| 1 | **Token WA expira cada 24h** | Crear System User permanente (ver sección 3) |
| 2 | **`META_APP_SECRET` solo en env var** | Moverlo también a `tenant.meta_app_secret` para soportar múltiples apps de Meta por tenant |
| 3 | **Sin paginación en búsqueda de productos** | El agente solo ve 5 resultados. Si el cliente pide "ver más", no hay manera de ir a la siguiente página |
| 4 | **Sin soporte para mensajes multimedia** | Si el cliente manda una foto o audio, el agente lo ignora silenciosamente |

### Funcionalidad del agente

| # | Mejora | Valor |
|---|---|---|
| 5 | **Carrusel / lista interactiva de WA** | Mostrar productos como botones o lista en lugar de texto plano |
| 6 | **Tomar pedidos directamente en el chat** | El agente puede crear un `order` en la DB cuando el cliente confirme |
| 7 | **Notificaciones proactivas** | Avisar a clientes cuando llegue stock de algo que preguntaron |
| 8 | **Dashboard de conversaciones** | Ver qué preguntan los clientes, qué productos buscan más |
| 9 | **Second sweep conectado** | El scheduler `second-sweep.js` está listo pero no conectado en `src/index.js` — conectarlo mejora la memoria del agente en chats largos |

### Técnico

| # | Mejora | Valor |
|---|---|---|
| 10 | **Búsqueda full-text con `tsvector`** | Mejorar relevancia de búsqueda de productos (actualmente es ILIKE) |
| 11 | **Cache de tenant en memoria** | Ahora se hace una query a la DB por cada mensaje para leer el tenant |
| 12 | **Instagram con IA** | El webhook de Instagram ya recibe mensajes pero no responde — conectar el mismo flujo |
| 13 | **Logs estructurados (pino)** | Los `console.log` actuales son difíciles de buscar en Railway |
| 14 | **Tests de integración** | La carpeta `src/__tests__/` existe pero está vacía |

---

## Checklist — Listo para producción

- [ ] Token permanente creado (System User) y actualizado en DB
- [ ] Número real verificado y `wa_phone_number_id` actualizado en DB
- [ ] Business Verification aprobada en Meta
- [ ] `ADMIN_API_KEY` configurada en Railway
- [ ] Nombre del negocio (`tenant.name`) actualizado
- [ ] `response_style` ajustado para electrónicos
- [ ] Categorías de electrónicos creadas en `tenant_category`
- [ ] Productos cargados con `specs` correctos
- [ ] Inventario inicial cargado
- [ ] `system_prompt` personalizado (o validado que el default template es adecuado)
- [ ] `META_APP_SECRET` correcto en Railway env vars (`ea8163093ba97f10345e0cd96984c418`)
- [ ] Webhook registrado con el número real en Meta
