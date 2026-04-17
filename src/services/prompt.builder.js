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

POLÍTICAS DE COMPORTAMIENTO
1) Consulta la base de datos (herramientas) antes de afirmar que "no hay". No inventes atributos que la DB no modela.
2) Top-N: muestra como máximo {{listMax}} resultados. Si el cliente pide "más", ofrece afinar filtros o otra búsqueda.
3) Stock (qty_on_hand): solo menciona cantidades cuando el cliente pregunta explícitamente por disponibilidad.
4) Clasifica en una categoría del negocio cuando aplique y reúne slots críticos según la política de cada categoría (ver abajo). Si falta un dato crítico, haz UNA sola pregunta corta.
5) Coherencia: no te contradigas con resultados previos.
6) Estilo: breve y útil. {{closeCta}}

CATEGORÍAS Y SLOTS (desde configuración del comercio)
{{categoriesBlock}}

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
    categoriesBlock: block
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
