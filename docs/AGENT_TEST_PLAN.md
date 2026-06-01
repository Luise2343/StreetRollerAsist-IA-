# Plan de pruebas del agente IA (VoltiPod, tenant_id=3)

Objetivo: garantizar que el agente (`aiReplyStrict` en `src/services/ia.js`) **llame
bien todas las tools** y **cierre ventas** correctamente, tanto para clientes que
**vienen de un anuncio** como para los **orgánicos** (sin anuncio).

Derivado de conversaciones reales guardadas en `wa_message` y de los anuncios reales
en `ad_product_map`. Dato clave: **118 de 132 clientes vinieron de anuncios** → el
camino de anuncio (`getAdProducts`) es el dominante.

## Tools del agente (6)

| Tool | Cuándo debe dispararse | Efecto |
|------|------------------------|--------|
| `searchProducts` | Consulta de producto sin anuncio (o filtro específico) | Busca en DB por texto/categoría/marca/specs/precio |
| `listAllProducts` | "¿Qué venden?" general sin anuncio | Lista hasta 20 productos activos |
| `getAdProducts` | Cliente llegó de un anuncio con productos vinculados | Devuelve los productos del anuncio |
| `classify_lead` | Tras entender la intención | Guarda `lead_class` en `wa_profile` |
| `create_order` | Cliente dio nombre+tel+dirección+pago | Crea orden, notifica al dueño |
| `notify_owner` | Reclamo / pregunta técnica / volumen / faltan datos | Escala al dueño (con cooldown 30 min) |

## Ruteo anuncio vs orgánico (lógica real en ia.js)

- `adId = ctx.currentAdId ?? (!ctx.summary ? ctx.profileFacts.referral.ad_id : null)`
- Si el `adId` tiene productos vinculados y el mensaje "parece consulta de producto"
  (`looksLikeProductQuery`) → se **fuerza** `tool_choice = getAdProducts`.
- Si parece consulta de producto y **no** hay anuncio → se **fuerza** `searchProducts`.
- En cualquier otro caso → `tool_choice = 'auto'` (el modelo decide; aquí entran
  `create_order`, `notify_owner`, `classify_lead`).

## Anuncios reales (ad_product_map, tenant 3)

| ad_id | Nombre | Productos | activo |
|-------|--------|-----------|--------|
| 120243670079070331 | Repetidores WiFi | RT006 ($29), RT007 ($56) | ✅ |
| 120246003784490331 | Sin wifi tristeza total | RT006, RT007 | ✅ |
| 120244720778830331 | UPS 500/1000/1500 | ECO500 ($47), COLCD1000 ($86), CLCP1500 ($133) | ✅ |
| 120246003998200331 | UPS 700VA y 1000VA | LCD700CH ($59), COLCD1000 ($86) | ✅ |
| 120244702538080331 | Audio | GH-512W ($30), PSS-BS-816 ($40), HD-214BK/WH ($15) | ✅ |
| 120243670317150331 | UPS CENTRA | (sin productos) | ❌ |

---

## Capa 1 — Tests deterministas (CI, `ia.tools.test.js`)

Mockean OpenAI y los repositorios. Validan que **el cableado de cada tool sea
perfecto** (independiente del juicio del modelo). Gratis, rápidos, en `npm test`.

| # | Escenario | Entrada | Aserción |
|---|-----------|---------|----------|
| D1 | Forzar searchProducts (orgánico) | "precio de teclados", sin anuncio | `tool_choice` forzado a `searchProducts`; se llama `searchProducts` con los args parseados |
| D2 | Forzar getAdProducts (anuncio) | "qué precios manejan", `currentAdId` con productos | `tool_choice` forzado a `getAdProducts`; NO se llama `searchProducts` |
| D3 | searchProducts handler | tool_call searchProducts {query, category} | `searchProducts` recibe `{tenantId, text, category}`; responde con 2da llamada |
| D4 | listAllProducts handler | tool_call listAllProducts | `listAllProducts(tenantId)` llamado |
| D5 | getAdProducts handler | tool_call getAdProducts + adProducts | Devuelve respuesta con los productos del anuncio; NO toca `searchProducts` |
| D6 | classify_lead handler | tool_call classify_lead {qualified} | `upsertProfileFact` con `lead_class:'qualified'`; notifica lead |
| D7 | create_order OK | tool_call create_order (datos completos) + SKU existe | `createFromWA` llamado; `sendWaText` al dueño; respuesta de confirmación |
| D8 | create_order dedup | orden reciente ya existe | NO se vuelve a crear; mensaje de orden ya registrada |
| D9 | create_order SKU inexistente | findBySku null + fallback vacío | WA al dueño "SKU no encontrado"; mensaje de "pedido recibido" |
| D10 | notify_owner | tool_call notify_owner {complaint} | `upsertProfileFact` escalación; `sendWaText` al dueño |
| D11 | notify_owner cooldown | `escalated_at` < 30 min | NO reenvía WA al dueño |

## Capa 2 — Eval en vivo (`ia.eval.live.test.js`, gated `RUN_LIVE_EVAL=1`)

Pega contra **gpt-5-mini real** + DB real. Stubbea efectos colaterales (no crea
órdenes reales ni manda WhatsApp). Observa la tool elegida espiando la respuesta de
OpenAI. Valida el **juicio del modelo** y los fixes de prompt de hoy.

| # | Origen | Escenario | Tool esperada | Aserción extra |
|---|--------|-----------|---------------|----------------|
| A1 | Anuncio repetidores | "¿Qué precios manejan?" | `getAdProducts` (forzado) | Respuesta menciona RT006/RT007 |
| A2 | Anuncio repetidores | "Quiero más información" (caso real que falló) | `getAdProducts` (auto) | NO dice "no tengo detalles/información" |
| A3 | Anuncio UPS | "cuánto cuesta" | `getAdProducts` (forzado) | Menciona algún UPS del anuncio |
| O1 | Orgánico | "¿Tienen sillas gamer?" | `searchProducts` (forzado) | Lista sillas reales |
| O2 | Orgánico | "precio de audífonos" | `searchProducts` (forzado) | Lista audio real |
| R1 | Anuncio repetidores | "necesito uno que llegue lejos, señal débil" | search/getAd | **Recomienda RT007**, NO dice "no tengo opciones" (fix de hoy) |
| S1 | (con producto acordado) | "¿dónde están? voy por él" | auto | Menciona tienda en línea/envío, NO ofrece recoger (fix de hoy) |
| C1 | Cierre | turno previo: acordó RT006 → "Juan Pérez, 7777-7777, San Salvador col Escalón #5, contra entrega" | `create_order` | args con SKU correcto + datos |
| E1 | Reclamo | "el producto llegó dañado, quiero reembolso" | `notify_owner` | reason=complaint |
| L1 | Clasificación | flujo calificado | `classify_lead` (auto) | **Hallazgo**: documentar si el modelo lo llama o no (en prod `lead_class` está NULL en 132/132) |

### Cómo correr el eval en vivo

```bash
# Linux/Mac
RUN_LIVE_EVAL=1 OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-5-mini \
  DATABASE_URL="postgresql://...public..." npx vitest run src/__tests__/ia.eval.live.test.js

# Windows PowerShell
$env:RUN_LIVE_EVAL=1; $env:OPENAI_API_KEY="sk-..."; $env:OPENAI_MODEL="gpt-5-mini";
$env:DATABASE_URL="postgresql://...public..."; npx vitest run src/__tests__/ia.eval.live.test.js
```

Sin `RUN_LIVE_EVAL=1` el archivo se salta solo (no rompe CI ni gasta dinero).

---

## Hallazgos de la primera corrida (gpt-5-mini, 2026-06-01)

### 🔴 CRÍTICO — corregido
**gpt-5-mini devolvía respuestas VACÍAS.** Su `reasoning_effort` por defecto es
`medium`, que consume 500+ tokens de razonamiento ANTES de emitir texto. Con topes
bajos (`ai_max_tokens=120`) el modelo agotaba el presupuesto razonando y devolvía
`content=""` (`finish_reason=length`), además de latencias de 12-22s.
**Fix:** `ai-params.js` ahora envía `reasoning_effort: 'minimal'` + headroom de tokens
para modelos gpt-5/o-series. Resultado: respuestas completas, ~2.5s, más barato.
Configurable con `AI_REASONING_EFFORT` (default `minimal`) y `AI_REASONING_HEADROOM`.

| effort | latencia | reasoning tokens | resultado |
|--------|----------|------------------|-----------|
| minimal | 2.5s | 0 | ✅ |
| low | 4.9s | 192 | ✅ |
| medium (default) | 6.6s | 500 | ❌ vacío |

### 🟡 Pendientes (decisión de diseño)
1. **Reclamos no escalan (E1).** Si un reclamo contiene una palabra de producto
   (ej. "el *repetidor* me llegó dañado"), `looksLikeProductQuery` fuerza
   `searchProducts` y el modelo nunca llama `notify_owner`. Los reclamos sobre un
   producto no llegan al dueño. Posible fix: no forzar tool cuando hay señales de
   reclamo/negativas, o dejar `tool_choice:'auto'` y reforzar el prompt de escalada.
2. **`classify_lead` nunca se llama (L1).** En `auto` el modelo no la invoca →
   `lead_class` NULL en 132/132 perfiles reales. El handler funciona (test D6).
   Opciones: (a) clasificar de forma determinista desde el estado del lead en vez de
   depender del modelo, (b) forzar la tool en momentos clave, o (c) eliminarla si no
   aporta. Decisión de producto pendiente.
