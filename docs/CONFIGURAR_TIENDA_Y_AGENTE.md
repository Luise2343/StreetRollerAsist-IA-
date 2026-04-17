# Configurar una nueva tienda y la personalidad del agente

Esta guía asume que ya aplicaste las migraciones (`001_initial_schema.sql` y `002_multi_tenant.sql`) y que el servidor arranca con `DATABASE_URL` y `OPENAI_API_KEY` configurados.

---

## 1. Qué vive en la base de datos (por tienda)

Cada **tienda** es un registro en la tabla `tenant`. Ahí defines:

| Área | Dónde se guarda |
|------|------------------|
| Identidad del negocio | `tenant.name`, `slug`, `business_type`, `language`, `currency` |
| WhatsApp Cloud API | `wa_phone_number_id`, `wa_token`, `wa_verify_token` |
| API REST del catálogo / pedidos | `api_key` (se envía como `Authorization: Bearer <api_key>`) |
| Modelo y límites de la IA | `ai_model`, `ai_max_tokens` |
| **Personalidad y reglas del agente** | `system_prompt` (texto o plantilla) y `response_style` (JSON) |
| Categorías y “slots” de venta | tabla `tenant_category` (ligada a `tenant_id`) |

Los **productos** tienen `tenant_id` y campos como `category` (debe coincidir con el **slug** de una categoría si quieres filtrar bien), `brand`, `specs` (JSON libre: talla, RAM, etc.).

---

## 2. API de administración (`/admin`)

Las rutas bajo `/admin` están protegidas con la variable de entorno **`ADMIN_API_KEY`**.

En cada petición admin envía:

```http
Authorization: Bearer <ADMIN_API_KEY>
Content-Type: application/json
```

Base URL de ejemplo: `https://tu-dominio.com` (o `http://localhost:3000` en local).

---

## 3. Crear una tienda nueva

### Opción A: HTTP (recomendado)

**POST** `/admin/tenants`

Cuerpo mínimo de ejemplo:

```json
{
  "slug": "mi-tienda-tech",
  "name": "Mi Tienda Tech",
  "business_type": "retail",
  "language": "es",
  "currency": "MXN",
  "timezone": "America/Mexico_City",
  "api_key": "genera-un-secreto-largo-y-unico",
  "wa_phone_number_id": "TU_PHONE_NUMBER_ID_DE_META",
  "wa_token": "TU_TOKEN_DE_ACCESO_WHATSAPP",
  "wa_verify_token": "token-secreto-para-verificar-webhook",
  "ai_model": "gpt-4o-mini",
  "ai_max_tokens": 180,
  "active": true
}
```

La respuesta incluye el `id` del tenant (lo usarás en las URLs de categorías).

Puedes dejar `wa_*` en `null` al principio y actualizarlos después con **PATCH** `/admin/tenants/:id`.

### Opción B: SQL directo

Inserta en `tenant` los mismos campos que expone el repositorio (ver migración `002_multi_tenant.sql`). Asegúrate de que `slug` y `api_key` sean únicos.

---

## 4. Configurar WhatsApp para esa tienda

1. En **Meta for Developers**, configura el webhook con la misma URL para todas las tiendas, por ejemplo:  
   `https://tu-dominio.com/webhooks/whatsapp`
2. En **Verify token** del panel de Meta, usa exactamente el valor de **`wa_verify_token`** de ese tenant en la base de datos.
3. El servidor resuelve la tienda por **`phone_number_id`** que Meta envía en cada evento; ese valor debe coincidir con **`wa_phone_number_id`** del tenant.
4. **`wa_token`** es el token de acceso (Bearer) que usa la app para enviar mensajes y marcar leído.

Actualización vía admin:

**PATCH** `/admin/tenants/:id`

```json
{
  "wa_phone_number_id": "123456789012345",
  "wa_token": "EAAxxxxx...",
  "wa_verify_token": "mi-token-de-verificacion",
  "name": "Mi Tienda (nombre visible en prompts)"
}
```

**Firma del webhook:** sigue usando la variable global `META_APP_SECRET` en el servidor (misma app de Meta para varios números, en el diseño habitual).

---

## 5. API REST de la tienda (productos, clientes, pedidos)

Cada tienda usa **su propia** `api_key`:

```http
GET /api/products
Authorization: Bearer <api_key_del_tenant>
```

Sin esa cabecera válida, la API responde 401. Así cada comercio queda aislado por datos (`tenant_id`).

---

## 6. Personalidad del agente (desde la DB)

Hay dos capas que se combinan en cada mensaje de WhatsApp:

### 6.1 `response_style` (JSON)

Controla tono, longitud y cierre sugerido. Se inyecta en la **plantilla** del system prompt (placeholders `{{tone}}`, `{{maxLines}}`, `{{listMax}}`, `{{closeCta}}`).

Ejemplo **PATCH** `/admin/tenants/:id`:

```json
{
  "response_style": {
    "max_lines": 4,
    "list_max_items": 5,
    "tone": "cercano, profesional, sin rodeos; evita tecnicismos innecesarios",
    "close_cta": "¿Te ayudo a comparar dos opciones o a reservar?"
  }
}
```

- **`language`** del tenant (`es`, `en`, …) influye en cómo se describe el idioma en el prompt (“español”, “inglés”, etc.).

### 6.2 `system_prompt` (texto largo, opcional)

- Si **`system_prompt` está vacío o es null**, el sistema usa una **plantilla por defecto** que ya incluye reglas de ventas, stock y categorías.
- Si lo rellenas, ese texto es la **plantilla completa** del system prompt. Puedes usar estos placeholders (se sustituyen al vuelo):

| Placeholder | Origen |
|-------------|--------|
| `{{storeName}}` | `tenant.name` |
| `{{language}}` | derivado de `tenant.language` |
| `{{tone}}` | `response_style.tone` |
| `{{maxLines}}` | `response_style.max_lines` |
| `{{listMax}}` | `response_style.list_max_items` |
| `{{closeCta}}` | `response_style.close_cta` |
| `{{categoriesBlock}}` | generado automáticamente desde **`tenant_category`** |

Así puedes reescribir toda la “personalidad” y las reglas, pero **no hace falta** repetir el listado de categorías: déjalo en `{{categoriesBlock}}`.

### 6.3 Ajuste fino del modelo

**PATCH** `/admin/tenants/:id`

```json
{
  "ai_model": "gpt-4o-mini",
  "ai_max_tokens": 200
}
```

---

## 7. Categorías y slots (también en DB)

Las filas en **`tenant_category`** definen:

- **`slug`**: identificador estable (ej. `laptops`). Debe alinearse con **`product.category`** si quieres que el agente filtre por categoría.
- **`label`**: nombre legible.
- **`synonyms`**: array de texto (ej. `["laptop", "portátil", "notebook"]`).
- **`slots`**: JSON con la política de la categoría (críticos, NBQ, tipos, etc.); el modelo lo recibe como contexto para preguntar bien.
- **`db_filterable_specs`**: array de **claves** que existen dentro de `product.specs` y que la herramienta `searchProducts` puede filtrar (aparecen como parámetros opcionales en el *function calling*).

### Crear categoría

**POST** `/admin/tenants/:id/categories`

```json
{
  "slug": "laptops",
  "label": "Laptops",
  "synonyms": ["laptop", "portátil", "notebook"],
  "slots": {
    "criticals_all": ["ram", "uso"],
    "nbq_order": [
      "¿Para qué la vas a usar principalmente (oficina, gaming, estudio)?",
      "¿Cuánta RAM mínima necesitas?"
    ],
    "slot_types": {
      "ram": "string",
      "uso": "string"
    }
  },
  "db_filterable_specs": ["ram", "storage"],
  "sort_order": 10,
  "active": true
}
```

### Actualizar categoría

**PATCH** `/admin/tenants/:id/categories/:slug`

```json
{
  "label": "Portátiles",
  "slots": { "criticals_all": ["ram"] },
  "db_filterable_specs": ["ram", "storage", "processor"]
}
```

**Importante:** los productos deben tener en `specs` las mismas claves que declares en `db_filterable_specs` (ej. `{"ram": "16GB", "storage": "512GB SSD"}`) para que el filtro `specs @>` en base de datos funcione.

---

## 8. Flujo recomendado (checklist)

1. Definir `ADMIN_API_KEY` en `.env` y reiniciar el servidor.
2. **POST** `/admin/tenants` → guardar `id` y `api_key`.
3. **POST** categorías para tu rubro (`/admin/tenants/:id/categories`).
4. Ajustar **`response_style`** y, si quieres, **`system_prompt`** con **PATCH** `/admin/tenants/:id`.
5. Configurar **Meta** (webhook + verify token + número) y **PATCH** los campos `wa_*`.
6. Cargar productos con **POST** `/api/products` usando el **`api_key`** de la tienda (`category`, `brand`, `specs`, etc.).
7. Probar escribiendo al número de WhatsApp configurado.

---

## 9. Resumen rápido “todo desde DB”

| Qué quieres | Dónde |
|-------------|--------|
| Nombre y datos del negocio | `tenant` |
| Tono, longitud, cierre del mensaje | `tenant.response_style` |
| Reglas y voz completas del agente | `tenant.system_prompt` (+ placeholders) |
| Qué preguntar por tipo de producto | `tenant_category.slots` + sinónimos |
| Qué filtros reales tiene el catálogo | `tenant_category.db_filterable_specs` + `product.specs` |
| WhatsApp por tienda | `tenant.wa_*` |
| Acceso API por tienda | `tenant.api_key` |

El archivo de código que arma el prompt final es `src/services/prompt.builder.js`; la lógica de herramientas de búsqueda está en `src/services/ia.js` y `src/services/products.search.js`.
