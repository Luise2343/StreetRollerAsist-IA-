# Configurar Tienda y Agente — VoltiPod

## Estado actual (Abril 2026)

- **Tenant activo**: `voltipod` (id=3) — periféricos gaming, UPS, redes
- **WhatsApp**: número `1128896616964579` asignado a VoltiPod
- **Tenant inactivo**: `default` (id=1) — StreetRoller tienda de patines, desactivado

---

## 1. Qué puedes configurar por tenant (sin tocar código)

Todo vive en la tabla `tenant`. Se puede cambiar con SQL o con la API admin.

| Campo | Qué controla | Ejemplo |
|-------|-------------|---------|
| `name` | Nombre de la tienda que usa el agente | `VoltiPod` |
| `system_prompt` | Prompt personalizado (NULL = usar plantilla genérica) | Ver abajo |
| `response_style` | Tono, largo de respuestas, CTA | `{"tone":"experto","max_lines":4}` |
| `ai_model` | Modelo OpenAI por tenant | `gpt-4o-mini` |
| `ai_max_tokens` | Máximo tokens de respuesta | `180` |
| `language` | Idioma del agente | `es` |

### response_style completo
```json
{
  "tone": "amable, claro, experto en tecnología",
  "max_lines": 4,
  "list_max_items": 5,
  "close_cta": "¿Te puedo ayudar a elegir o tienes alguna duda?"
}
```

### Cambiar system_prompt
```sql
UPDATE tenant SET system_prompt = '
Eres un asesor de ventas para VoltiPod. Hablas en español, tono experto y amable.
Responde en no más de 4 líneas salvo cuando listes opciones.

POLÍTICAS:
1) Consulta la DB antes de decir que no hay stock.
2) No inventes specs que la DB no tiene.
3) Muestra máximo 5 productos por búsqueda.
' WHERE slug = 'voltipod';

-- Para volver al template por defecto:
UPDATE tenant SET system_prompt = NULL WHERE slug = 'voltipod';
```

---

## 2. Categorías y cómo afectan al agente

Las categorías le dicen al agente cómo clasificar preguntas y qué datos pedir.

### Categorías actuales de VoltiPod

| slug | label | sinónimos clave |
|------|-------|----------------|
| `perifericos` | Periféricos | teclado, mouse, combo, mousepad |
| `audio` | Audio | bocina, audífonos, micrófono, karaoke |
| `monitores` | Monitores | monitor, pantalla, lcd |
| `sillas` | Sillas Gaming | silla, silla gamer |
| `escritorios` | Escritorios | escritorio, mesa, desk |
| `accesorios` | Accesorios | hub, soporte, pendrive, usb, hdd |
| `ups-reguladores` | UPS y Reguladores | ups, regulador, nobreak, supresor |
| `baterias` | Baterías | bateria, 12v, reemplazo ups |
| `redes` | Redes / Routers | router, repetidor, wifi |

### Agregar o editar categoría vía API admin
```bash
# Crear categoría
curl -X POST https://TU-APP.railway.app/admin/tenants/3/categories \
  -H "x-admin-key: TU_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "cables",
    "label": "Cables y Adaptadores",
    "synonyms": ["cable", "adaptador", "hdmi", "usb"],
    "slots": {"tipo": "", "longitud": ""},
    "db_filterable_specs": ["tipo"],
    "sort_order": 10
  }'

# Editar categoría
curl -X PATCH https://TU-APP.railway.app/admin/tenants/3/categories/cables \
  -H "x-admin-key: TU_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"synonyms": ["cable","adaptador","hdmi","displayport"]}'
```

---

## 3. Productos

### Estructura de un producto
```json
{
  "sku": "KB-229",
  "name": "Teclado Alámbrico XTRIKE ME KB-229",
  "description": "Teclado membrana 104 teclas, cable USB 1.4m",
  "base_price": 14.19,
  "currency": "USD",
  "category": "perifericos",
  "brand": "XTRIKE ME",
  "specs": {
    "tipo": "teclado",
    "conectividad": "alámbrico USB",
    "teclas": 104
  }
}
```

### Agregar producto vía API
```bash
curl -X POST https://TU-APP.railway.app/products \
  -H "x-api-key: TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "NUEVO-001",
    "name": "Nombre del producto",
    "description": "Descripción",
    "basePrice": 99.99,
    "currency": "USD",
    "category": "perifericos",
    "brand": "Marca",
    "specs": {"tipo": "..."}
  }'
```

### Actualizar precio en SQL
```sql
UPDATE product SET base_price = 49.99 WHERE sku = 'KB-229' AND tenant_id = 3;
```

### Fórmula de precios VoltiPod
```
Precio final = (Costo × 1.13 + $4.99) ÷ 0.75
```
Equivale al "PRECIO AL 25% UTILIDAD" del listado Excel.

---

## 4. Stock / Inventario

El stock inicia en 0 para todos los productos. Actualizar:

```sql
-- Fijar stock directamente
UPDATE inventory SET qty_on_hand = 50
WHERE product_id = (SELECT id FROM product WHERE sku = 'KB-229');

-- Ajuste incremental vía API
curl -X PATCH https://TU-APP.railway.app/inventory/PRODUCT_ID \
  -H "x-api-key: TU_API_KEY" \
  -d '{"delta": 50}'
```

El agente solo menciona stock cuando el cliente pregunta explícitamente.

---

## 5. Cómo funciona el agente paso a paso

```
Cliente escribe en WhatsApp
         │
         ▼
  [Webhook Meta] POST /webhooks/whatsapp
         │
         ├─ Validar firma HMAC con meta_app_secret del tenant
         ├─ Resolver tenant por phone_number_id
         ├─ Ignorar status updates (delivered/read/sent)
         ├─ Deduplicar mensaje por ID
         │
         ├─ [summarizeIfInactive] Si el cliente no escribía hace >180 min:
         │    → OpenAI genera resumen de la conversación anterior
         │    → Guarda en wa_summary, borra mensajes de wa_message
         │
         ├─ Cargar contexto:
         │    • RAM: últimos 6 turnos (se pierde al reiniciar el server)
         │    • DB: resumen acumulado + turns recientes + datos del cliente
         │
         ├─ Comando "reset/reiniciar/nuevo" → limpia sesión
         │
         ├─ [aiReplyStrict] Llamada a OpenAI GPT-4o-mini:
         │    System prompts:
         │      1. Rol del agente + reglas de la tienda
         │      2. Categorías y slots (JSON)
         │      3. Resumen previo de conversación
         │      4. Datos persistentes del cliente (nombre, preferencias)
         │    Historial: últimos N turnos
         │    Mensaje: texto del cliente
         │    Tools disponibles:
         │      • searchProducts(query, category, brand, priceMin, priceMax, specs...)
         │      • listAllProducts()
         │
         ├─ Si el modelo usa searchProducts:
         │    → Busca en PostgreSQL (full-text + filtros JSONB)
         │    → Devuelve resultados al modelo para que redacte respuesta
         │
         ├─ Enviar respuesta por WhatsApp Cloud API
         ├─ Guardar turno en DB (wa_message) y en RAM
         └─ Responder 200 a Meta
```

---

## 6. Second Sweep (barrido automático)

Controla si el agente envía mensajes de seguimiento automáticos.

```env
SUM_SECOND_SWEEP_MIN=0        # 0 = DESACTIVADO (recomendado por ahora)
SUM_INACTIVITY_MIN=180        # Minutos de inactividad para generar resumen
SUM_SWEEP_INTERVAL_SEC=300    # Cada cuántos segundos corre el job (5 min)
```

**Qué hace cuando está activo**: cada 5 minutos busca conversaciones con mensajes
pendientes de resumir que llevan más de `INACT_MIN + SECOND_SWEEP_MIN` minutos
inactivas. Las drena en resúmenes. No envía mensajes al cliente, solo consolida
el contexto interno.

**Por qué se recibió un mensaje "sorpresa"**: si `SUM_SECOND_SWEEP_MIN > 0` y el
contexto de una conversación se activa, el agente puede responder aunque no haya
mensaje nuevo. Mantener en `0` para evitar esto.

---

## 7. Variables de entorno en Railway

Las variables se configuran en Railway dashboard → servicio `StreetRollerAsist-IA-` → Variables.

### Requeridas
```env
DATABASE_URL=          # Auto-configurada por Railway al linkar el servicio Postgres
OPENAI_API_KEY=        # Tu clave de OpenAI
```

### Importantes para comportamiento del agente
```env
OPENAI_MODEL=gpt-4o-mini
AI_MAX_OUTPUT_TOKENS=120        # Tokens máximos por respuesta (puede subirse)
CTX_TURNS=6                     # Turnos de historial en RAM
CTX_TTL_MIN=120                 # Minutos antes de que expire la sesión RAM
SUM_INACTIVITY_MIN=180          # Minutos inactivo para generar resumen
SUM_SECOND_SWEEP_MIN=0          # Mantener en 0
```

### Para la API REST (gestión del catálogo)
```env
ADMIN_API_KEY=tu-clave-admin    # Para /admin/* (CRUD tenants/categorías)
API_KEY=tu-clave-api            # Para /products, /inventory, /orders, etc.
```

---

## 8. Rutas API disponibles

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/health` | - | Estado del servidor |
| GET/POST | `/webhooks/whatsapp` | HMAC Meta | Webhook WhatsApp |
| GET | `/products` | API_KEY | Listar productos |
| POST | `/products` | API_KEY | Crear producto |
| PATCH | `/products/:id` | API_KEY | Actualizar producto |
| GET | `/inventory` | API_KEY | Ver stock |
| PATCH | `/inventory/:id` | API_KEY | Ajustar stock |
| GET | `/customers` | API_KEY | Listar clientes |
| GET | `/orders` | API_KEY | Listar órdenes |
| POST | `/admin/tenants` | ADMIN_API_KEY | Crear tenant |
| GET | `/admin/tenants/:id` | ADMIN_API_KEY | Ver tenant |
| PATCH | `/admin/tenants/:id` | ADMIN_API_KEY | Actualizar tenant |
| GET | `/admin/tenants/:id/categories` | ADMIN_API_KEY | Ver categorías |
| POST | `/admin/tenants/:id/categories` | ADMIN_API_KEY | Crear categoría |
| PATCH | `/admin/tenants/:id/categories/:slug` | ADMIN_API_KEY | Editar categoría |

---

## 9. Agregar un segundo tenant (nueva tienda)

```sql
-- 1. Crear tenant
INSERT INTO tenant (slug, name, business_type, language, currency,
  wa_phone_number_id, wa_token, wa_verify_token, meta_app_secret,
  ai_model, ai_max_tokens, active)
VALUES ('nueva-tienda', 'Nombre Tienda', 'retail', 'es', 'USD',
  'PHONE_NUMBER_ID', 'WA_TOKEN', 'VERIFY_TOKEN', 'APP_SECRET',
  'gpt-4o-mini', 150, true);

-- 2. Crear categorías para ese tenant
INSERT INTO tenant_category (tenant_id, slug, label, synonyms, slots, sort_order, active)
VALUES ((SELECT id FROM tenant WHERE slug='nueva-tienda'), 'productos', 'Productos', '{}', '{}'::jsonb, 1, true);

-- 3. Agregar productos
INSERT INTO product (tenant_id, sku, name, base_price, currency, category, active)
VALUES ((SELECT id FROM tenant WHERE slug='nueva-tienda'), 'P001', 'Producto', 99.99, 'USD', 'productos', true);
```

Cada tenant funciona completamente independiente con su propio catálogo, credenciales WA y configuración de agente.
