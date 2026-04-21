import OpenAI from 'openai';
import { searchProducts, listAllProducts } from './products.search.js';
import { buildSystemPromptForTenant, buildSlotsPolicyJsonForTenant } from './prompt.builder.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { logger } from '../config/logger.js';

const OPENAI_ENABLED = (process.env.OPENAI_ENABLED ?? 'true') !== 'false';

let openai = null;
if (OPENAI_ENABLED && process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function collectSpecKeys(categories) {
  const keys = new Set();
  for (const c of categories || []) {
    for (const k of c.db_filterable_specs || []) {
      if (k) keys.add(String(k));
    }
  }
  return [...keys];
}

function buildSpecsFromArgs(args, specKeys) {
  const out = {};
  for (const k of specKeys) {
    const v = args[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      const n = Number(v);
      out[k] = Number.isFinite(n) && String(v).trim() === String(n) ? n : v;
    }
  }
  if (args.size !== null && args.size !== undefined && args.size !== '') {
    const d = String(args.size).replace(/[^\d]/g, '');
    if (d) out.size = Number(d);
  }
  return Object.keys(out).length ? out : null;
}

function buildSearchToolSchema(specKeys) {
  const properties = {
    query: {
      type: 'string',
      description: 'Palabras clave (nombre, modelo, color, etc.)'
    },
    category: { type: 'string', description: 'Slug de categoría del comercio' },
    brand: { type: 'string', description: 'Marca' },
    priceMin: { type: 'number', description: 'Precio mínimo' },
    priceMax: { type: 'number', description: 'Precio máximo' },
    size: {
      type: 'string',
      description: 'Talla o medida numérica (se guarda en specs.size cuando aplique)'
    }
  };
  for (const k of specKeys) {
    if (properties[k]) continue;
    properties[k] = { type: 'string', description: `Valor para filtrar specs.${k}` };
  }
  return {
    type: 'function',
    function: {
      name: 'searchProducts',
      description: 'Buscar productos del comercio con filtros opcionales',
      parameters: {
        type: 'object',
        properties
      }
    }
  };
}

async function answerWithProducts(messages, choice, call, products, maxTokens) {
  const r2 = await openai.chat.completions.create({
    model: choice.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      ...messages,
      choice,
      {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(products)
      }
    ],
    max_tokens: maxTokens
  });

  return r2.choices?.[0]?.message?.content?.trim() || null;
}

export async function aiReplyStrict(userText, ctx, tenant, waId = null) {
  if (!openai || !tenant) return null;

  const categories = await tenantRepository.listCategories(tenant.id);
  const specKeys = collectSpecKeys(categories);
  const SYSTEM = await buildSystemPromptForTenant(tenant);
  const SLOTS_SCHEMA = await buildSlotsPolicyJsonForTenant(tenant.id);

  const model = tenant.ai_model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxOut = Math.max(
    1,
    parseInt(
      String(tenant.ai_max_tokens ?? process.env.AI_MAX_OUTPUT_TOKENS ?? '120').trim(),
      10
    ) || 120
  );

  const messages = [{ role: 'system', content: SYSTEM }];

  messages.push({
    role: 'system',
    content: `POLÍTICA DE SLOTS (JSON). Usa estas categorías y slots para NBQ y coherencia:\n${JSON.stringify(SLOTS_SCHEMA)}`
  });

  if (ctx?.last_frame) {
    messages.push({
      role: 'system',
      content: `Estado previo del usuario (last_frame): ${JSON.stringify(ctx.last_frame)}`
    });
  }

  if (ctx?.summary) {
    messages.push({
      role: 'system',
      content: `Resumen previo de la conversación:\n${String(ctx.summary).slice(0, 1500)}`
    });
  }

  if (ctx?.profileFacts && Object.keys(ctx.profileFacts).length) {
    messages.push({
      role: 'system',
      content: `Datos persistentes del cliente (pueden estar desactualizados): ${JSON.stringify(ctx.profileFacts)}`
    });
  }

  for (const t of ctx?.turns ?? []) {
    const u = (t?.user ?? '').trim();
    const a = (t?.assistant ?? '').trim();
    if (u) messages.push({ role: 'user', content: u });
    if (a) messages.push({ role: 'assistant', content: a });
  }

  messages.push({ role: 'user', content: String(userText || '').slice(0, 800) });

  const tools = [
    buildSearchToolSchema(specKeys),
    {
      type: 'function',
      function: {
        name: 'listAllProducts',
        description: 'Listar productos activos del comercio (máx. 10)',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'classify_lead',
        description:
          'Clasifica el tipo de lead para tracking. Llamá esto después de entender la intención del cliente.',
        parameters: {
          type: 'object',
          properties: {
            classification: {
              type: 'string',
              enum: ['ghost', 'ignorant', 'qualified', 'negotiating', 'closed', 'lost'],
              description:
                'ghost=mandó predeterminado y no responde más, ignorant=no sabe qué es el producto, qualified=tiene claro lo que busca, negotiating=pidiendo precio/descuento, closed=dio datos de envío, lost=dijo que no'
            },
            note: {
              type: 'string',
              description: 'Nota opcional sobre el estado del lead'
            }
          },
          required: ['classification']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'notify_owner',
        description:
          'Notifica al dueño cuando hay una venta lista para cerrar o un caso que requiere atención humana',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              enum: ['ready_to_buy', 'complaint', 'technical_question', 'bulk_order', 'other'],
              description: 'Razón de la escalada'
            },
            summary: {
              type: 'string',
              description: 'Resumen de la conversación y siguiente paso esperado'
            }
          },
          required: ['reason', 'summary']
        }
      }
    }
  ];

  try {
    const r = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto'
    });

    const choice = r.choices?.[0]?.message;
    if (choice?.tool_calls?.[0]) {
      const call = choice.tool_calls[0];

      if (call.function.name === 'searchProducts') {
        const args = JSON.parse(call.function.arguments || '{}');
        const specs = buildSpecsFromArgs(args, specKeys);
        const products = await searchProducts({
          tenantId: tenant.id,
          text: args.query || '',
          category: args.category || null,
          brand: args.brand || null,
          specs,
          priceMin: args.priceMin,
          priceMax: args.priceMax
        });
        return await answerWithProducts(messages, { ...choice, model }, call, products, maxOut);
      }

      if (call.function.name === 'listAllProducts') {
        const products = await listAllProducts(tenant.id);
        return await answerWithProducts(messages, { ...choice, model }, call, products, maxOut);
      }

      if (call.function.name === 'classify_lead') {
        const args = JSON.parse(call.function.arguments || '{}');
        const { classification, note } = args;

        if (!waId) {
          logger.warn({ action: 'classify_lead_skipped', reason: 'no_waId' });
          return choice?.content?.trim() || null;
        }

        try {
          const facts = {
            lead_class: classification,
            lead_note: note || null,
            lead_updated_at: new Date().toISOString()
          };

          await waProfileRepository.upsertProfileFact(tenant.id, waId, facts);
          logger.info({
            action: 'classify_lead',
            tenantId: tenant.id,
            waId,
            classification,
            note
          });

          const toolResult = JSON.stringify({ ok: true });
          const r2 = await openai.chat.completions.create({
            model,
            messages: [
              ...messages,
              choice,
              {
                role: 'tool',
                tool_call_id: call.id,
                content: toolResult
              }
            ],
            max_tokens: maxOut
          });

          return r2.choices?.[0]?.message?.content?.trim() || null;
        } catch (error) {
          logger.error({
            action: 'classify_lead_error',
            tenantId: tenant.id,
            error: error.message
          });
          return null;
        }
      }

      if (call.function.name === 'notify_owner') {
        const args = JSON.parse(call.function.arguments || '{}');
        const { reason, summary } = args;

        if (!waId) {
          logger.warn({ action: 'notify_owner_skipped', reason: 'no_waId' });
          return choice?.content?.trim() || null;
        }

        try {
          const escalatedAt = new Date().toISOString();

          const facts = {
            escalated_at: escalatedAt,
            escalation_reason: reason,
            escalation_summary: summary
          };

          await waProfileRepository.upsertProfileFact(tenant.id, waId, facts);

          logger.info({
            action: 'notify_owner',
            tenantId: tenant.id,
            waId,
            reason,
            summary,
            escalatedAt
          });

          const toolResult = JSON.stringify({ ok: true, message: 'Propietario notificado' });
          const r2 = await openai.chat.completions.create({
            model,
            messages: [
              ...messages,
              choice,
              {
                role: 'tool',
                tool_call_id: call.id,
                content: toolResult
              }
            ],
            max_tokens: maxOut
          });

          return r2.choices?.[0]?.message?.content?.trim() || null;
        } catch (error) {
          logger.error({
            action: 'notify_owner_error',
            tenantId: tenant.id,
            error: error.message
          });
          return null;
        }
      }
    }

    return choice?.content?.trim() || null;
  } catch (e) {
    logger.error({ action: 'openai_error', status: e?.status, code: e?.code, message: e?.message });
    return null;
  }
}
