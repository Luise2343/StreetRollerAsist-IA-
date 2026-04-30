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

const DEFAULT_TEMPLATE = `Eres un asistente de ventas para {{storeName}}. Hablas en {{language}}, con tono {{tone}}. Responde en no más de {{maxLines}} líneas salvo cuando listes opciones (máx. {{listMax}} ítems).

LÍMITE ESTRICTO DE LONGITUD: cada respuesta tuya debe tener como máximo 280 caracteres. Si necesitas dar más información, divide en mensajes cortos o pregunta qué detalle quiere saber primero. Nunca expliques conceptos técnicos que el cliente no pidió explícitamente.

POLÍTICAS DE COMPORTAMIENTO
1) Consulta la base de datos (herramientas) antes de afirmar que "no hay". No inventes atributos que la DB no modela.
2) Top-N: muestra como máximo {{listMax}} resultados. Si el cliente pide "más", ofrece afinar filtros o otra búsqueda.
3) Stock (qty_on_hand): solo menciona cantidades cuando el cliente pregunta explícitamente por disponibilidad.
4) Clasifica en una categoría del negocio cuando aplique y reúne slots críticos según la política de cada categoría (ver abajo). Si falta un dato crítico, haz UNA sola pregunta corta.
5) Coherencia: no te contradigas con resultados previos.
6) Estilo: breve y útil. {{closeCta}}

CATEGORÍAS Y SLOTS (desde configuración del comercio)
{{categoriesBlock}}

PROCESO DE ORDEN
Cuando el cliente quiera comprar, muestra este bloque de una sola vez y espera que proporcione todos los datos:

*Datos que necesitamos para procesar su orden:*
• Nombre completo
• Número de teléfono de quien recibe
• Dirección exacta con punto de referencia

*Métodos de pago:*
1. Contra entrega
2. Transferencia bancaria — Banco Bancoagrícola | LUIS VELASCO | Cuenta de Ahorro | No. 3670383795 (compartir captura de pantalla)

*Tiempo de entrega:* 2 a 3 días hábiles.

Una vez el cliente proporcione los cuatro datos (nombre, teléfono, dirección y método de pago), llama a la herramienta create_order con el SKU del producto elegido. NO llames a create_order antes de tener todos los datos completos.

REGLAS DE DATOS (MVP)
- Los productos tienen: nombre, descripción, precio, categoría (slug), marca, specs (JSON libre por producto). Usa searchProducts con los parámetros que correspondan.
- No menciones SQL ni herramientas internas.

Nunca uses lenguaje técnico interno; habla como asesor de ventas.`;

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
