# Plan: Implementar system prompt operativo de VoltiPod

> Plan aprobado, pendiente de ejecutar. Cuando se ejecute hay que aplicar los cambios listados en "Archivos a modificar", correr la migración contra Railway, validar con la verificación de abajo y luego hacer commit + push.

## Contexto

VoltiPod (tenant_id=3, slug=`voltipod`) hoy no tiene `system_prompt` propio: usa el `DEFAULT_TEMPLATE` genérico de [src/services/prompt.builder.js](../src/services/prompt.builder.js). El usuario destiló un prompt operativo de ~50 conversaciones reales (Apr 2026) con tono salvadoreño, guion de calificación, manejo de objeciones (las 2 confusiones grandes: "el repetidor genera internet" y "el UPS es solar"), criterios de escalación y FAQs. Lo queremos en producción.

Se decidió:
- **Cobertura**: catálogo completo, énfasis en WiFi + UPS. Las otras categorías (perif./audio/monitores/sillas/escritorios/accesorios/redes) se mencionan brevemente y el agente las atiende vía `searchProducts`.
- **Forma**: plantilla con variables (no texto crudo), interpoladas por `prompt.builder.js` desde `tenant.response_style` JSONB.
- **Mecanismo**: nueva migración `migrations/004_voltipod_prompt.sql`.
- **Garantías**: UPS = 1 año, WiFi = 6 meses.
- **Datos bancarios**: SÍ se hardcodean en `response_style.bank_info` (Bancoagrícola / Cuenta de Ahorro / titular LUIS VELASCO / No. 3670383795). El agente los comparte cuando el cliente elige transferencia y pide captura de pantalla del comprobante.
- **Escalación**: prompt instruye llamar al tool `notify_owner` ya existente y decir la frase de handoff.

Diferencias con el documento original que el usuario aprobó implícitamente:
- Catálogo real **no tiene** UPS de $156, $200 ni $460+. Tope es COLCD1000 = $84. Esos modelos se eliminan del prompt.
- Precios reales (no los del doc): WiFi RT006 = $26.24, RT007 = $50.35; UPS LCD700CH = $58, CO800 = $66.95, CP1000 = $69, COLCD1000 = $84.
- Script de toma de pedido y tiempos de entrega: nombre / teléfono receptor / dirección con punto de referencia; entrega 2–3 días hábiles.

## Archivos a modificar

| Acción | Path | Qué cambia |
|---|---|---|
| Crear | `migrations/004_voltipod_prompt.sql` | `UPDATE tenant SET system_prompt = $$ ... $$, response_style = response_style \|\| '{...}'::jsonb, ai_max_tokens = 260 WHERE slug='voltipod';` |
| Modificar | `src/services/prompt.builder.js` | Extender el bloque `replaceAll` con los nuevos placeholders (cambio aditivo, defaults `?? ''`). |

`src/services/ia.js` no se toca: el tool `notify_owner` ya está registrado y su handler ya graba `escalation_reason` + `escalation_summary` en `wa_profile` y reescribe la respuesta visible. Lo único que falta es decirle al modelo *cuándo* llamarlo — eso vive en el prompt.

## Cambios en `prompt.builder.js`

En la función `buildSystemPromptForTenant`, ampliar el extract de `rs` y el `replaceAll` con estos nuevos placeholders. Cada uno con default `?? ''` para no romper otros tenants:

| Placeholder | Fuente en `response_style` |
|---|---|
| `{{wifiBasicPrice}}` | `wifi_basic_price` |
| `{{wifiPremiumPrice}}` | `wifi_premium_price` |
| `{{wifiWarranty}}` | `wifi_warranty` |
| `{{upsEntryModel}}` / `{{upsEntryPrice}}` | `ups_entry_model` / `ups_entry_price` |
| `{{upsOfficeModel}}` / `{{upsOfficePrice}}` | `ups_office_model` / `ups_office_price` |
| `{{upsMidModel}}` / `{{upsMidPrice}}` | `ups_mid_model` / `ups_mid_price` |
| `{{upsTopModel}}` / `{{upsTopPrice}}` | `ups_top_model` / `ups_top_price` |
| `{{upsWarranty}}` | `ups_warranty` |
| `{{shippingPolicy}}` | `shipping_policy` |
| `{{ownerHandoffPhrase}}` | `owner_handoff_phrase` |
| `{{orderIntakeFields}}` | `order_intake_fields` |
| `{{bankInfo}}` | `bank_info` |

Placeholders existentes (`storeName`, `language`, `tone`, `maxLines`, `listMax`, `closeCta`, `categoriesBlock`) se mantienen.

## Nuevas keys de `response_style` (merge con `||`)

```json
{
  "tone": "cálido, profesional, salvadoreño, consultivo",
  "wifi_basic_price": "$26.24",
  "wifi_premium_price": "$50.35",
  "wifi_warranty": "6 meses",
  "ups_entry_model": "LCD700CH (700VA/350W, 8 tomas, LCD, USB)",
  "ups_entry_price": "$58",
  "ups_office_model": "CO800 (800VA/400W, 12 tomas, USB-C/A, supresión coaxial+RJ45)",
  "ups_office_price": "$66.95",
  "ups_mid_model": "CP1000 (1000VA/500W, 8 tomas)",
  "ups_mid_price": "$69",
  "ups_top_model": "COLCD1000 (1000VA/500W, 12 tomas, LCD, USB-C/A, coaxial+RJ45)",
  "ups_top_price": "$84",
  "ups_warranty": "1 año",
  "shipping_policy": "Envío gratis a todo El Salvador. Entrega en 2 a 3 días hábiles. En San Salvador podemos entregar el mismo día (2-3 horas).",
  "owner_handoff_phrase": "Permítame un momento, voy a coordinar con mi compañero para darle la mejor respuesta. Lo retomamos en breve.",
  "order_intake_fields": "Nombre completo / Número de teléfono de la persona que recibe / Dirección exacta con punto de referencia",
  "bank_info": "Banco: Bancoagrícola\nNombre de la cuenta: LUIS VELASCO\nTipo de cuenta: Cuenta de Ahorro\nNo. de cuenta: 3670383795\n\nFavor compartir captura de pantalla de la transacción."
}
```

Las keys ya existentes (`max_lines`, `list_max_items`, `close_cta`) se preservan vía operador `||`. `tone` se sobrescribe con el nuevo valor.

También subo `tenant.ai_max_tokens` de 180 a **260** en la misma migración: el guion de UPS lista 4 modelos y el de objeciones puede correr largo.

## Estructura del prompt (lo que va a `tenant.system_prompt`)

Texto en español, ~3000 chars, dollar-quoted con `$PROMPT$`. Secciones numeradas en este orden:

1. **Identidad y tono** — "Eres el agente de ventas de {{storeName}}, empresa salvadoreña, vende por WhatsApp con tráfico 100% Meta ads". Usa `{{tone}}`, `{{maxLines}}`, `{{listMax}}`, `{{closeCta}}`. Reglas duras: usted por defecto, mensajes cortos separados, emojis con propósito (✅📡💡📦), nunca mayúsculas para enfatizar, nunca corregir ortografía del cliente.
2. **Catálogo (foco y resto)** — "Vendemos principalmente repetidores WiFi y UPS. También tenemos: periféricos, audio, monitores, sillas, escritorios, accesorios y redes." Instrucción: para cualquier consulta fuera de WiFi/UPS, llamar `searchProducts` antes de afirmar precios. Apunta a `{{categoriesBlock}}` (auto-inyectado) para detalles del resto.
3. **Guion WiFi** — Productos: básico `{{wifiBasicPrice}}` (1200Mbps, 15m, 1-2 hab) y premium `{{wifiPremiumPrice}}` (2167Mbps, 25m, casa completa). Garantía `{{wifiWarranty}}`. Discovery: ¿qué área?, ¿cuántos dispositivos? Resolver objeción "el repetidor no genera internet — extiende el WiFi que ya tienes; ¿tenés internet con algún proveedor?".
4. **Guion UPS** — Tabla con `{{upsEntryModel}}/{{upsEntryPrice}}`, `{{upsOfficeModel}}/{{upsOfficePrice}}`, `{{upsMidModel}}/{{upsMidPrice}}`, `{{upsTopModel}}/{{upsTopPrice}}`. Garantía `{{upsWarranty}}`. Discovery: qué equipos, ¿solo proteger picos o también respaldo?, ¿cuántas tomas? Resolver objeción "el UPS no es solar — se carga con la red, da X minutos cuando se va la luz". Lista de equipos compatibles/no compatibles. CO800 se etiqueta "caballito de batalla para hogar". **Si el cliente pide más autonomía que la del modelo top ($84), escalar — NO inventar modelos de mayor capacidad.**
5. **Flujo de cierre (7 pasos resumidos)** — saludo → calificación → educación → recomendación específica → argumentos (envío gratis, contra entrega o transferencia, garantía) → pregunta de cierre → toma de datos.
6. **Toma de datos, pago y entrega** — "Para procesar su orden necesitamos: {{orderIntakeFields}}." Política de envío: `{{shippingPolicy}}`. Pago: contra entrega o transferencia. **Si el cliente elige transferencia → compartir literal `{{bankInfo}}` (incluye instrucción de captura de pantalla) y, una vez recibida la captura, llamar `notify_owner` con `reason='ready_to_buy'` y `summary` (producto/zona/datos cliente) para que el equipo coordine entrega.**
7. **Manejo de objeciones cortas** — autonomía baja → escalar a modelo superior dentro de catálogo (no inventar). Tarjeta/cuotas → "solo contra entrega o transferencia". CCF → escalar. "¿Son de Tigo/Claro?" → no, vendemos equipos. "Solo consulto" → cerrar con frase suave, no presionar.
8. **Escalación a humano** — Lista de triggers: producto fuera de catálogo con interés serio, CCF, descuento por volumen (>2 unidades), reclamo post-venta, cliente pide humano explícito, >10 turnos sin avanzar, comprobante de transferencia recibido. Acción: llamar `notify_owner` con `reason` apropiado (`ready_to_buy` / `complaint` / `bulk_order` / `technical_question` / `other`) y `summary` 1-2 frases. Responder con `{{ownerHandoffPhrase}}` salvo cuando ya se compartió `{{bankInfo}}` (en ese caso confirmar al cliente que se está coordinando la entrega).
9. **Reglas duras (NUNCA)** — no inventar specs ni precios; no prometer descuentos; máx `{{listMax}}` ítems; no usar mayúsculas para gritar; no chistes; no cerrar abruptamente aunque no compre. Compartir `{{bankInfo}}` SOLO cuando el cliente confirma transferencia.
10. **Frases de oro** — "Justamente así lo uso yo", "Ese es nuestro mejor vendido" (solo si BD lo respalda), "¿A qué zona sería el envío?", "¿Sería pago contra entrega o transferencia?".

Las referencias a UPS de $156/$200/$460 del documento original están eliminadas. La lista de modelos está acotada por `{{upsTopPrice}}`.

## Migración 004 — esqueleto

```sql
BEGIN;

UPDATE tenant
SET
  system_prompt = $PROMPT$
[texto del prompt completo con {{placeholders}}, secciones 1-10 arriba]
$PROMPT$,
  response_style = response_style || $JSON$
{
  "tone": "cálido, profesional, salvadoreño, consultivo",
  "wifi_basic_price": "$26.24",
  ... [resto de keys arriba]
}
$JSON$::jsonb,
  ai_max_tokens = 260,
  updated_at = now()
WHERE slug = 'voltipod';

COMMIT;
```

Idempotente porque es UPDATE; uso `||` para merge no destructivo del JSONB; `$PROMPT$` y `$JSON$` como dollar-tags para evitar problemas con comillas y `'` dentro del prompt.

## Verificación

1. **Aplicar localmente** contra Railway pública con el bloque Node de [CLAUDE.md](../CLAUDE.md) (no `psql` local). Esperar `OK`.
2. **Inspección DB**:
   ```sql
   SELECT length(system_prompt), ai_max_tokens FROM tenant WHERE slug='voltipod';
   SELECT jsonb_pretty(response_style) FROM tenant WHERE slug='voltipod';
   ```
   Verificar `length(system_prompt)` entre 2500 y 3500 y todas las keys nuevas presentes; `max_lines`, `close_cta`, `list_max_items` preservadas.
3. **Render en REPL**:
   ```js
   import { buildSystemPromptForTenant } from './src/services/prompt.builder.js';
   import { tenantRepository } from './src/repositories/tenant.repository.js';
   const t = await tenantRepository.findById(3);
   const cats = await tenantRepository.listCategories(3);
   const out = buildSystemPromptForTenant(t, cats);
   console.log(out.includes('{{'), out.includes('$26.24'), out.includes('1 año'));
   ```
   Esperado: `false true true` y ningún `undefined` literal.
4. **`npm test`** — la suite vitest debe seguir verde (cambio aditivo).
5. **End-to-end manual** vía WhatsApp (ngrok o número productivo en staging):
   - "necesito un repetidor wifi" → respuesta con `$26.24` y `$50.35`, tono cálido, pregunta de calificación.
   - "necesito un UPS para mi PC" → recomienda CO800 a `$66.95`, menciona `1 año` de garantía.
   - "quiero pagar por transferencia" → agente comparte datos de Bancoagrícola y pide captura. Tras recibir captura → log con `action: 'notify_owner'` (`reason: ready_to_buy`).
   - "venden powerbanks?" → `searchProducts` se llama; si no hay match, agente lo dice y ofrece alternativa.
6. **Regresión tenant `default`** — `buildSystemPromptForTenant` sobre tenant 1 no debe contener `undefined` ni `{{` literal (los nuevos placeholders quedan vacíos por `?? ''`).

## Riesgos y pendientes

- **`notify_owner` solo loguea** (escribe a `wa_profile` y reescribe la respuesta). No envía notificación out-of-band a un humano. Si el operador no monitorea `wa_profile.facts_json.escalation_reason`, una venta cerrada por transferencia puede quedarse sin atender. Fuera del alcance de esta migración, pero hay que decidir un canal de alerta (correo, otra cuenta WA, Slack).
- **Datos bancarios viajan en el system prompt** — si en el futuro el banco/cuenta cambia, basta con un `PATCH /admin/tenants/3` actualizando `response_style.bank_info`. Si la cuenta queda comprometida, hay que rotarla rápido en BD; los chats viejos en `wa_message` ya tendrán los datos antiguos (no se purgan).
- **`ai_max_tokens=260`** puede seguir siendo justo si el cliente pregunta varias cosas a la vez. Revisar logs de truncamiento la primera semana.
- **Antes de aplicar**: confirmar que el texto final no menciona los UPS de $156/$200/$460. Y confirmar el modelo concreto sugerido en cada caso (CO800 para PC + monitor + router; LCD700CH para setup mínimo).
- **No hay test automatizado** del prompt renderizado. Recomendado agregar 1 test vitest mínimo en `src/__tests__/prompt-builder.test.js` que valide que un tenant con `response_style` completo renderiza sin `{{` y contiene precios y garantías esperadas. Lo puedo incluir o dejarlo para una segunda PR.
