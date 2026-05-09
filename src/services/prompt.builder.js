// src/services/prompt.builder.js — system prompt from tenant + categories in DB
import { tenantRepository } from '../repositories/tenant.repository.js';

function categoriesBlock(categories) {
  if (!categories?.length) {
    return 'No hay categorías configuradas aún. Usa búsqueda por texto libre y pregunta al cliente lo mínimo necesario.';
  }
  return categories
    .map(c => {
      const slots = typeof c.slots === 'string' ? c.slots : JSON.stringify(c.slots ?? {});
      const syns = Array.isArray(c.synonyms) ? c.synonyms.join(', ') : '';
      const filt = Array.isArray(c.db_filterable_specs) ? c.db_filterable_specs.join(', ') : '';
      return `- **${c.slug}** (${c.label}) — sinónimos: ${syns}\n  slots (JSON): ${slots}\n  filtros en DB hoy: ${filt || 'solo texto / categoría / marca / precio'}`;
    })
    .join('\n');
}

const DEFAULT_TEMPLATE = `Eres el asesor de ventas de {{storeName}} por WhatsApp. Hablas en {{language}} de forma natural, cercana y directa — como un buen vendedor humano, no como un bot. Tono: {{tone}}.

━━ ESTILO DE ESCRITURA ━━
• Mensajes cortos. Máximo 2-3 oraciones por mensaje. Nunca más de 280 caracteres.
• Usa el nombre del cliente si lo sabes. Tutéalo siempre ("¿lo quieres?", no "¿lo desea usted?").
• Nada de frases robóticas: ❌ "Permítame un momento" ❌ "Usted se interesa en" ❌ "Con mucho gusto le asisto"
• Sé directo y cálido: ✅ "¡Perfecto!" ✅ "Está bueno ese" ✅ "Te lo mandamos mañana"

━━ CÓMO CERRAR VENTAS ━━
REGLA DE ORO: cuando el cliente muestra interés → da el precio + 1 beneficio clave + cierra con una pregunta de acción.
Ejemplo: "El UPS Office 1000 está en $86, respalda tu compu y router hasta 30 min 🔋 ¿Te lo mandamos?"

Técnicas a usar según el momento:
1. INTERÉS → Confirma el producto + precio + pregunta "¿Te lo procesamos?" o "¿Lo pedimos?"
2. DUDA SOBRE PRECIO → Ancla el valor: "Vale $86, pero te evita perder trabajo si se va la luz. ¿Vale la pena para ti?"
3. DUDA SOBRE PRODUCTO → Haz UNA pregunta de calificación para recomendar mejor. Solo una.
4. LISTO PARA COMPRAR → Pide los datos de golpe, en un solo mensaje claro.
5. SILENCIO DESPUÉS DE COTIZAR → Reengánchalo: "¿Quedó alguna duda? 😊"

━━ CUÁNDO NO PREGUNTAR MÁS ━━
Si el cliente ya dijo qué quiere y a qué precio → NO preguntes para qué lo usará. Ve directo al cierre.
Si ya dijo que sí → pide datos de envío inmediatamente.

━━ PROCESO DE COMPRA ━━
Cuando el cliente confirme que quiere comprar, pide todo en un mensaje:

"Listo 🎉 Para coordinar el envío necesito:
• Nombre
• Teléfono
• Dirección (con referencia)
• Pago: contra entrega o transferencia (Bancoagrícola | LUIS VELASCO | Ahorro | 3670383795)"

Envío gratis. Entrega en 2-3 días hábiles (mismo día en San Salvador si hay stock).

Cuando tengas nombre + teléfono + dirección + método de pago → llama a create_order con el SKU. NO antes.

━━ REGLAS DE DATOS ━━
- Consulta la DB (searchProducts / listAllProducts) antes de decir que no hay algo.
- Máximo {{listMax}} productos por respuesta. Si pide más, afina filtros.
- No menciones stock a menos que el cliente lo pregunte.
- No inventes specs que no estén en la DB.
- No menciones herramientas internas ni SQL.

CATEGORÍAS Y SLOTS
{{categoriesBlock}}`;

function replaceAll(str, map) {
  let out = str;
  for (const [k, v] of Object.entries(map)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

export async function buildSystemPromptForTenant(tenant) {
  const categories = await tenantRepository.listCategories(tenant.id);
  const rs = tenant.response_style || {};
  const maxLines = String(rs.max_lines ?? 4);
  const listMax = String(rs.list_max_items ?? 5);
  const tone = String(rs.tone ?? 'amable, claro, consultivo');
  const closeCta = String(rs.close_cta ?? '¿Quieres ver más o filtrar por algo?');
  const lang =
    tenant.language === 'es'
      ? 'español'
      : tenant.language === 'en'
        ? 'inglés'
        : String(tenant.language || 'español');

  const block = categoriesBlock(categories);
  const template = tenant.system_prompt?.trim() ? tenant.system_prompt : DEFAULT_TEMPLATE;

  return replaceAll(template, {
    storeName: tenant.name || 'la tienda',
    language: lang,
    tone,
    maxLines,
    listMax,
    closeCta,
    categoriesBlock: block,
    wifiBasicPrice: String(rs.wifi_basic_price ?? ''),
    wifiPremiumPrice: String(rs.wifi_premium_price ?? ''),
    wifiWarranty: String(rs.wifi_warranty ?? ''),
    upsEntryModel: String(rs.ups_entry_model ?? ''),
    upsEntryPrice: String(rs.ups_entry_price ?? ''),
    upsOfficeModel: String(rs.ups_office_model ?? ''),
    upsOfficePrice: String(rs.ups_office_price ?? ''),
    upsMidModel: String(rs.ups_mid_model ?? ''),
    upsMidPrice: String(rs.ups_mid_price ?? ''),
    upsTopModel: String(rs.ups_top_model ?? ''),
    upsTopPrice: String(rs.ups_top_price ?? ''),
    upsWarranty: String(rs.ups_warranty ?? ''),
    shippingPolicy: String(rs.shipping_policy ?? ''),
    ownerHandoffPhrase: String(rs.owner_handoff_phrase ?? ''),
    orderIntakeFields: String(rs.order_intake_fields ?? ''),
    bankInfo: String(rs.bank_info ?? '')
  });
}

export async function buildSlotsPolicyJsonForTenant(tenantId) {
  const categories = await tenantRepository.listCategories(tenantId);
  return {
    version: 'db',
    global: {
      page_size: 5,
      stock_policy: 'on_demand',
      response_style: {
        max_lines: 4,
        list_max_items: 5
      },
      consistency_rules: [
        "Nunca digas 'no hay' sin consultar la DB.",
        'No contradigas resultados previos en la misma conversación.',
        'No menciones atributos que la DB no modela hoy.'
      ]
    },
    categories: Object.fromEntries(
      categories.map(c => [
        c.slug,
        {
          label: c.label,
          synonyms: c.synonyms || [],
          slots: c.slots || {},
          db_filterable_specs: c.db_filterable_specs || []
        }
      ])
    )
  };
}
