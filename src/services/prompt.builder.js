// src/services/prompt.builder.js — system prompt from tenant + categories + live ad context
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

const DEFAULT_TEMPLATE = [
  'Eres el asesor de ventas de {{storeName}} por WhatsApp. Hablas en {{language}} de forma natural, cercana y directa — como un buen vendedor humano, no como un bot. Tono: {{tone}}.',
  '',
  '━━ ESTILO DE ESCRITURA ━━',
  '• Mensajes cortos. Máximo {{maxLines}} líneas por mensaje. Nunca más de 280 caracteres.',
  '• Usa el nombre del cliente si lo sabes. Tutéalo siempre.',
  '• Nada de frases robóticas ni excesivamente formales.',
  '• Sé directo y cálido. Confirma con acción ("¡Perfecto!", "Te lo mandamos").',
  '',
  '━━ CÓMO CERRAR VENTAS ━━',
  'REGLA DE ORO: cuando el cliente muestre interés → da el precio + 1 beneficio clave + cierra con una pregunta de acción.',
  '',
  'Técnicas según el momento:',
  '1. INTERÉS → Confirma producto + precio + pregunta de cierre ("¿Te lo procesamos?").',
  '2. DUDA SOBRE PRECIO → Ancla el valor con un beneficio claro y vuelve a cerrar.',
  '3. DUDA SOBRE PRODUCTO → Una sola pregunta de calificación para recomendar mejor.',
  '4. LISTO PARA COMPRAR → Pide todos los datos en un único mensaje.',
  '5. SILENCIO TRAS COTIZAR → Reengánchalo con una pregunta corta y cálida.',
  '',
  '━━ CUÁNDO NO PREGUNTAR MÁS ━━',
  'Si el cliente ya dijo qué quiere y a qué precio → ve directo al cierre.',
  'Si ya dijo que sí → pide datos de envío inmediatamente.',
  '',
  '━━ PROCESO DE COMPRA ━━',
  'Cuando el cliente confirme que quiere comprar, pide en un solo mensaje los datos definidos en {{orderIntakeFields}}.',
  '{{shippingPolicy}}',
  'Si elige transferencia → comparte EXACTAMENTE el siguiente bloque (sin modificarlo):',
  '{{bankInfo}}',
  '',
  'Cuando tengas todos los datos del cliente y el método de pago → llama a create_order con el SKU del producto confirmado. Nunca antes.',
  '',
  '━━ REGLAS DE DATOS ━━ (CRÍTICO — violación = información falsa al cliente)',
  '- ANTES de mencionar cualquier producto, precio, modelo o especificación → DEBES llamar a searchProducts, listAllProducts o getAdProducts. Sin excepción.',
  '- NUNCA inventes productos, precios, SKUs ni specs. Si no los tienes de la DB, búscalos primero.',
  '- Si el cliente pregunta qué tienes, qué hay o qué recomiendas → llama a listAllProducts o searchProducts antes de responder.',
  '- Consulta la DB también antes de decir que algo "no está disponible".',
  '- Máximo {{listMax}} productos por respuesta. Si el catálogo trae más, resume y afina filtros.',
  '- No menciones stock a menos que el cliente lo pregunte.',
  '- No menciones herramientas internas ni SQL.',
  '',
  '━━ USO DE CATEGORÍAS EN searchProducts ━━',
  '- Cuando el término del cliente coincida con un sinónimo de alguna categoría (ver CATEGORÍAS Y SLOTS abajo), pasa siempre ese slug en el campo category de searchProducts — aunque también pases query.',
  '- Si la búsqueda por texto devuelve vacío, reintenta usando solo category con el slug correspondiente antes de decir que no hay productos.',
  '',
  '━━ ESCALACIÓN ━━',
  'Llama notify_owner cuando: hay un reclamo post-venta, una pregunta técnica que no puedes responder con la DB, una orden por volumen, o el cliente pide explícitamente hablar con un humano.',
  'Responde con: {{ownerHandoffPhrase}}',
  '',
  'CATEGORÍAS Y SLOTS',
  '{{categoriesBlock}}'
].join('\n');

function renderAdContextBlock(adEntry, adProducts) {
  if (!adEntry) return '';
  const priceTag = adEntry.price ? ` — $${Number(adEntry.price).toFixed(2)}` : '';
  const description = adEntry.description ? `\n${adEntry.description}` : '';

  const productLines = adProducts?.length
    ? adProducts
        .map(p => {
          const price =
            p.base_price !== null && p.base_price !== undefined
              ? `$${Number(p.base_price).toFixed(2)}`
              : 'precio a consultar';
          const specs =
            p.specs && Object.keys(p.specs).length
              ? ' (' +
                Object.entries(p.specs)
                  .slice(0, 4)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ') +
                ')'
              : '';
          const tag = p.sku ? ` [SKU:${p.sku}]` : ` [SKU:${p.id}]`;
          return `• ${p.name} — ${price}${specs}${tag}`;
        })
        .join('\n')
    : '(usa getAdProducts para listar los productos vinculados a este anuncio)';

  return [
    '',
    '━━ CONTEXTO DEL ANUNCIO ━━',
    `Cliente llegó por el anuncio: "${adEntry.name}"${priceTag}${description}`,
    '',
    'PRODUCTOS DEL ANUNCIO (úsalos como foco principal de la conversación):',
    productLines,
    '',
    'Abre la conversación recomendando uno de estos productos directamente. Mantén la conversación centrada en ellos. Solo cambia de foco si el cliente lo pide explícitamente; en ese caso usa searchProducts.',
    'El SKU para create_order viene del marcador [SKU:...] de cada producto de la lista.'
  ].join('\n');
}

function replaceAll(str, map) {
  let out = str;
  for (const [k, v] of Object.entries(map)) {
    out = out.split('{{' + k + '}}').join(v);
  }
  return out;
}

export async function buildSystemPromptForTenant(tenant, { adEntry = null, adProducts = [] } = {}) {
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

  const rendered = replaceAll(template, {
    storeName: tenant.name || 'la tienda',
    language: lang,
    tone,
    maxLines,
    listMax,
    closeCta,
    categoriesBlock: block,
    // Optional placeholders, default to empty so any tenant template renders cleanly
    bankInfo: String(rs.bank_info ?? ''),
    shippingPolicy: String(rs.shipping_policy ?? ''),
    orderIntakeFields: String(
      rs.order_intake_fields ?? 'nombre, teléfono, dirección con referencia y método de pago'
    ),
    ownerHandoffPhrase: String(
      rs.owner_handoff_phrase ?? 'Permíteme un momento, lo coordino con mi equipo.'
    ),
    // Legacy keys kept for tenants still using them in tenant.system_prompt
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
    upsWarranty: String(rs.ups_warranty ?? '')
  });

  return rendered + renderAdContextBlock(adEntry, adProducts);
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
