import OpenAI from 'openai';
import { searchProducts, listAllProducts } from './products.search.js';
import { buildSystemPromptForTenant, buildSlotsPolicyJsonForTenant } from './prompt.builder.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { adMapRepository } from '../repositories/ad-map.repository.js';
import { sendWaText } from './whatsapp.client.js';
import { sendPushToTenant } from './push.service.js';
import { notificationService } from './business/notification.service.js';
import { logger } from '../config/logger.js';
import { runEscalationChecks } from './escalation-detector.js';
import { resolveModel } from './ai-budget.js';
import { recordCompletionUsage } from './ai-usage.recorder.js';
import { maxTokensParam } from './ai-params.js';

const OWNER_PHONE = process.env.OWNER_PHONE || '50373130634';

const OPENAI_ENABLED = (process.env.OPENAI_ENABLED ?? 'true') !== 'false';

let openai = null;
if (OPENAI_ENABLED && process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const GENERIC_PRODUCT_TRIGGERS = [
  'precio', 'precios', 'cuesta', 'cuestan', 'cuanto', 'cuanta',
  'venden', 'vendes', 'vende', 'tienen', 'tienes', 'tiene',
  'manejan', 'manejas', 'maneja', 'hay', 'disponible', 'disponibles',
  'recomiendas', 'recomienda', 'recomendacion', 'recomendaciones',
  'producto', 'productos', 'modelo', 'modelos', 'marca', 'marcas',
  'stock', 'catalogo', 'opciones', 'comprar'
];

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function buildTriggerSet(categories) {
  const set = new Set(GENERIC_PRODUCT_TRIGGERS.map(normalizeText));
  for (const c of categories || []) {
    if (c.slug) set.add(normalizeText(c.slug));
    if (c.label) set.add(normalizeText(c.label));
    for (const s of c.synonyms || []) {
      const n = normalizeText(s);
      if (n) set.add(n);
    }
  }
  return set;
}

function looksLikeProductQuery(userText, triggers) {
  if (!userText || !triggers?.size) return false;
  const tokens = normalizeText(userText).split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    if (triggers.has(tok)) return true;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    if (triggers.has(tokens[i] + ' ' + tokens[i + 1])) return true;
  }
  return false;
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

// Builds messages for a second OpenAI call responding to a single tool call.
// Filters the assistant message to only include the handled tool_call to avoid
// "missing tool response" 400 errors when the model returned multiple tool calls.
function buildToolResponseMessages(messages, assistantMessage, handledCall, toolResultStr) {
  const filtered =
    assistantMessage.tool_calls?.length > 1
      ? { ...assistantMessage, tool_calls: [handledCall] }
      : assistantMessage;
  return [
    ...messages,
    filtered,
    { role: 'tool', tool_call_id: handledCall.id, content: toolResultStr }
  ];
}

async function answerWithProducts(messages, choice, call, products, maxTokens, escalationCtx = null) {
  const model = choice.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const r2 = await openai.chat.completions.create({
    model,
    messages: buildToolResponseMessages(messages, choice, call, JSON.stringify(products)),
    ...maxTokensParam(model, maxTokens)
  });
  recordCompletionUsage(r2, {
    tenantId: escalationCtx?.tenantId,
    waId: escalationCtx?.waId,
    purpose: 'agent'
  });

  const reply = r2.choices?.[0]?.message?.content?.trim() || null;
  if (reply && escalationCtx?.waId) {
    runEscalationChecks({
      tenantId: escalationCtx.tenantId,
      waId: escalationCtx.waId,
      userText: escalationCtx.userText,
      aiReply: reply,
      ctx: escalationCtx.ctx
    }).catch(e => logger.error({ action: 'escalation_check_error', error: e.message }));
  }
  return reply;
}

export async function aiReplyStrict(userText, ctx, tenant, waId = null) {
  if (!openai || !tenant) return null;

  const categories = await tenantRepository.listCategories(tenant.id);
  const specKeys = collectSpecKeys(categories);
  const triggerSet = buildTriggerSet(categories);
  const SLOTS_SCHEMA = await buildSlotsPolicyJsonForTenant(tenant.id);

  const preferredModel = tenant.ai_model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  // Aplica el tope mensual: si se superó el presupuesto, degrada al modelo económico.
  const { model, degraded } = await resolveModel(tenant.id, preferredModel);
  if (degraded) {
    logger.warn({ tenantId: tenant.id, waId, preferredModel, model }, 'ai model degraded by budget');
  }
  const maxOut = Math.max(
    1,
    parseInt(
      String(tenant.ai_max_tokens ?? process.env.AI_MAX_OUTPUT_TOKENS ?? '120').trim(),
      10
    ) || 120
  );

  // Use ad_id from current message referral, or from persistent profile if no summary yet
  // (summary signals a new conversation — revert to standard tenant prompt)
  const adId = ctx?.currentAdId ?? (!ctx?.summary ? ctx?.profileFacts?.referral?.ad_id : null) ?? null;
  const adEntry = adId
    ? await adMapRepository.findByAdIdWithProducts(tenant.id, adId).catch(() => null)
    : null;
  const adProducts = adEntry?.products || [];
  const SYSTEM = await buildSystemPromptForTenant(tenant, { adEntry, adProducts });

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
        description: 'Listar productos activos del comercio (máx. 20)',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getAdProducts',
        description:
          'Listar los productos vinculados al anuncio por el que llegó el cliente. Úsalo al inicio de la conversación o cuando el cliente pregunte qué tienen disponible.',
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
        name: 'create_order',
        description: 'Crea una orden de compra cuando el cliente ha proporcionado todos los datos requeridos (nombre, teléfono, dirección, método de pago).',
        parameters: {
          type: 'object',
          properties: {
            product_sku: { type: 'string', description: 'SKU del producto seleccionado' },
            customer_name: { type: 'string', description: 'Nombre completo del cliente' },
            delivery_phone: { type: 'string', description: 'Teléfono de quien recibe' },
            delivery_address: { type: 'string', description: 'Dirección exacta con punto de referencia' },
            payment_method: { type: 'string', enum: ['contra_entrega', 'transferencia'], description: 'Método de pago elegido' }
          },
          required: ['product_sku', 'customer_name', 'delivery_phone', 'delivery_address', 'payment_method']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'notify_owner',
        description:
          'Escala al dueño casos que requieren atención humana: reclamos, preguntas técnicas complejas, órdenes por volumen, o cuando el cliente quiere comprar pero FALTAN datos (nombre, teléfono, dirección o método de pago). NO usar si ya tienes todos los datos del pedido — usa create_order en ese caso.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              enum: ['missing_order_data', 'complaint', 'technical_question', 'bulk_order', 'other'],
              description: 'Razón de la escalada: missing_order_data = cliente quiere comprar pero faltan datos del pedido'
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

  const forceToolName = looksLikeProductQuery(userText, triggerSet)
    ? (adProducts.length ? 'getAdProducts' : 'searchProducts')
    : null;
  const toolChoice = forceToolName
    ? { type: 'function', function: { name: forceToolName } }
    : 'auto';

  if (forceToolName) {
    logger.debug({
      action: 'tool_choice_forced',
      tenantId: tenant.id,
      waId,
      tool: forceToolName
    });
  }

  try {
    const r = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: toolChoice,
      ...maxTokensParam(model, maxOut)
    });
    recordCompletionUsage(r, { tenantId: tenant.id, waId, purpose: 'agent' });

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
        return await answerWithProducts(messages, { ...choice, model }, call, products, maxOut, { tenantId: tenant.id, waId, userText, ctx });
      }

      if (call.function.name === 'listAllProducts') {
        const products = await listAllProducts(tenant.id);
        return await answerWithProducts(messages, { ...choice, model }, call, products, maxOut, { tenantId: tenant.id, waId, userText, ctx });
      }

      if (call.function.name === 'getAdProducts') {
        const products = adProducts.length
          ? adProducts.map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              price: p.base_price,
              currency: p.currency,
              category: p.category,
              brand: p.brand,
              specs: p.specs,
              sku: p.sku
            }))
          : [];
        return await answerWithProducts(messages, { ...choice, model }, call, products, maxOut, { tenantId: tenant.id, waId, userText, ctx });
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

          if (['qualified', 'negotiating', 'closed'].includes(classification)) {
            notificationService.notify(tenant.id, {
              type: 'new_lead',
              severity: 'info',
              title: `Lead ${classification}`,
              body: note || `Cliente clasificado como ${classification}`,
              data: { waId, classification, note: note || null }
            }, false).catch(e => logger.error({ action: 'notify_persist_error', error: e.message }));
          }

          const toolResult = JSON.stringify({ ok: true });
          const r2 = await openai.chat.completions.create({
            model,
            messages: buildToolResponseMessages(messages, choice, call, toolResult),
            ...maxTokensParam(model, maxOut)
          });
          recordCompletionUsage(r2, { tenantId: tenant.id, waId, purpose: 'agent' });

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

      if (call.function.name === 'create_order') {
        const args = JSON.parse(call.function.arguments || '{}');
        const { product_sku, customer_name, delivery_phone, delivery_address } = args;
        const rawMethod = (args.payment_method || '').toLowerCase();
        const payment_method = rawMethod.includes('transfer') ? 'transferencia' : 'contra_entrega';

        if (!waId) {
          logger.warn({ action: 'create_order_skipped', reason: 'no_waId' });
          return choice?.content?.trim() || null;
        }

        try {
          // Bug fix: cascade fallbacks when product has no SKU or AI used name/id instead
          let product = await productRepository.findBySku(tenant.id, product_sku);
          if (!product && product_sku) {
            // Fallback 1: search by name (AI may have used the product name as SKU)
            const fallback = await searchProducts({ tenantId: tenant.id, text: product_sku });
            if (fallback?.length === 1) {
              product = { id: fallback[0].id, name: fallback[0].name, basePrice: fallback[0].price, sku: fallback[0].sku };
            }
          }
          if (!product && product_sku && /^\d+$/.test(String(product_sku).trim())) {
            // Fallback 2: numeric ID — ads module uses product ID when SKU is null
            product = await productRepository.findById(tenant.id, Number(product_sku));
          }
          if (!product) {
            logger.warn({ action: 'create_order_sku_not_found', tenantId: tenant.id, product_sku });
            sendPushToTenant(tenant.id, {
              title: '⚠️ Pedido sin SKU válido',
              body: `${customer_name} quiere ordenar "${product_sku}" — revisar manualmente`,
              data: { waId, tenantId: tenant.id }
            }).catch(() => {});
            await sendWaText(tenant, OWNER_PHONE,
              `⚠️ Pedido recibido pero SKU no encontrado: "${product_sku}"\nCliente: ${customer_name}\nTel: ${delivery_phone}\nDirección: ${delivery_address}\nPago: ${payment_method}\nwa.me/${waId}`
            ).catch(() => {});
            return `¡Perfecto, ${customer_name}! Tu pedido ha sido recibido y en breve uno de nuestros agentes te confirmará los detalles por este mismo chat. 😊`;
          }

          const adId = ctx.profileFacts?.referral?.ad_id ?? null;

          const existing = await orderRepository.findRecentByWaIdAndProduct(tenant.id, waId, product.id);
          if (existing) {
            logger.info({ action: 'create_order_dedup', tenantId: tenant.id, waId, orderId: existing.id, product_sku });
            const r2 = await openai.chat.completions.create({
              model,
              messages: buildToolResponseMessages(messages, choice, call, JSON.stringify({ order_id: existing.id, total: existing.total, status: existing.status })),
              ...maxTokensParam(model, maxOut)
            });
            recordCompletionUsage(r2, { tenantId: tenant.id, waId, purpose: 'agent' });
            return r2.choices?.[0]?.message?.content?.trim() ||
              `✅ Tu orden ya fue registrada (#${existing.id}). Nos pondremos en contacto contigo pronto para coordinar la entrega. ¡Gracias!`;
          }

          const order = await orderRepository.createFromWA(tenant.id, {
            waId,
            productId: product.id,
            unitPrice: product.basePrice,
            deliveryName: customer_name,
            deliveryPhone: delivery_phone,
            deliveryAddress: delivery_address,
            paymentMethod: payment_method,
            adId
          });

          const payLabel = payment_method === 'transferencia' ? 'Transferencia bancaria' : 'Contra entrega';
          const notifMsg =
            `🛒 *Nueva orden #${order.id}*\n` +
            `Producto: ${product.name}\n` +
            `Precio: $${Number(product.basePrice).toFixed(2)}\n` +
            `Cliente: ${customer_name}\n` +
            `Tel: ${delivery_phone}\n` +
            `Dirección: ${delivery_address}\n` +
            `Pago: ${payLabel}` +
            (adId ? `\nAnuncio: ${adId}` : '');
          sendPushToTenant(tenant.id, {
            title: `🛒 Nueva orden #${order.id}`,
            body: `${customer_name} — ${product.name} ($${Number(product.basePrice).toFixed(2)})`,
            data: { waId, tenantId: tenant.id, orderId: order.id }
          }).catch(() => {});
          notificationService.notify(tenant.id, {
            type: 'new_order',
            severity: 'info',
            title: `🛒 Nueva orden #${order.id}`,
            body: `${customer_name} — ${product.name} ($${Number(product.basePrice).toFixed(2)})`,
            data: { waId, orderId: order.id, productSku: product_sku, paymentMethod: payment_method, adId }
          }, false).catch(e => logger.error({ action: 'notify_persist_error', error: e.message }));
          await sendWaText(tenant, OWNER_PHONE, notifMsg);

          logger.info({ action: 'create_order', tenantId: tenant.id, waId, orderId: order.id, product_sku, payment_method });

          const toolResult = JSON.stringify({ order_id: order.id, total: order.total, status: 'created' });
          const r2 = await openai.chat.completions.create({
            model,
            messages: buildToolResponseMessages(messages, choice, call, toolResult),
            ...maxTokensParam(model, maxOut)
          });
          recordCompletionUsage(r2, { tenantId: tenant.id, waId, purpose: 'agent' });
          return r2.choices?.[0]?.message?.content?.trim() ||
            `✅ Tu orden ha sido registrada con éxito (#${order.id}). Nos pondremos en contacto contigo pronto para coordinar la entrega. ¡Gracias!`;
        } catch (error) {
          logger.error({ action: 'create_order_error', tenantId: tenant.id, error: error.message });
          sendPushToTenant(tenant.id, {
            title: '⚠️ Error al registrar pedido',
            body: `${customer_name} — revisar manualmente`,
            data: { waId, tenantId: tenant.id }
          }).catch(() => {});
          await sendWaText(tenant, OWNER_PHONE,
            `⚠️ Error al crear orden (${error.message})\nCliente: ${customer_name}\nTel: ${delivery_phone}\nDirección: ${delivery_address}\nProducto: ${product_sku}\nPago: ${payment_method}\nwa.me/${waId}`
          ).catch(() => {});
          return `¡Listo, ${customer_name}! Tu pedido fue recibido y un agente te contactará pronto para confirmar los detalles de entrega. 🙌`;
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

          // Dedup: don't re-send WA notification if owner was already notified in the last 30 min
          const lastEscalation = ctx?.profileFacts?.escalated_at;
          const COOLDOWN_MS = 30 * 60 * 1000;
          const alreadyNotified =
            lastEscalation && Date.now() - new Date(lastEscalation).getTime() < COOLDOWN_MS;

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
            escalatedAt,
            skippedWA: !!alreadyNotified
          });

          const notifTypeMap = {
            missing_order_data: 'new_lead',
            complaint: 'lead_escalated',
            bulk_order: 'new_lead',
            technical_question: 'system',
            other: 'system'
          };
          notificationService.notify(tenant.id, {
            type: notifTypeMap[reason] || 'system',
            severity: reason === 'complaint' ? 'warning' : 'info',
            title: `Escalación: ${reason}`,
            body: summary,
            data: { waId, reason, escalatedAt }
          }, false).catch(e => logger.error({ action: 'notify_persist_error', error: e.message }));

          if (!alreadyNotified) {
            const reasonLabels = {
              missing_order_data: '🛒 Quiere comprar — faltan datos',
              complaint: '⚠️ Reclamo',
              bulk_order: '📦 Orden por volumen',
              technical_question: '🔧 Consulta técnica',
              other: 'ℹ️ Otro'
            };
            const notifMsg =
              `${reasonLabels[reason] || reason}\n` +
              `Cliente: wa.me/${waId}\n\n` +
              `${summary}`;
            await sendWaText(tenant, OWNER_PHONE, notifMsg);
          }

          const toolResult = JSON.stringify({ ok: true, message: 'Propietario notificado' });
          const r2 = await openai.chat.completions.create({
            model,
            messages: buildToolResponseMessages(messages, choice, call, toolResult),
            ...maxTokensParam(model, maxOut)
          });
          recordCompletionUsage(r2, { tenantId: tenant.id, waId, purpose: 'agent' });

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

    const finalReply = choice?.content?.trim() || null;
    if (finalReply && waId) {
      runEscalationChecks({ tenantId: tenant.id, waId, userText, aiReply: finalReply, ctx })
        .catch(e => logger.error({ action: 'escalation_check_error', error: e.message }));
    }
    return finalReply;
  } catch (e) {
    logger.error({ action: 'openai_error', status: e?.status, code: e?.code, message: e?.message });
    return null;
  }
}

// Cooldown en memoria por tenant para no spamear cuando OpenAI cae
const openaiErrorCooldown = new Map();
const OPENAI_ERROR_COOLDOWN_MS = 15 * 60 * 1000;

function shouldNotifyOpenAIError(tenantId) {
  const last = openaiErrorCooldown.get(tenantId);
  if (last && Date.now() - last < OPENAI_ERROR_COOLDOWN_MS) return false;
  openaiErrorCooldown.set(tenantId, Date.now());
  return true;
}

// Retries con backoff lineal: 30s, 60s, 90s... hasta ~18 min total (9 intentos)
export async function aiReplyWithRetry(text, ctx, tenant, from, { maxRetries = 9, delayMs = 30_000 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const reply = await aiReplyStrict(text, ctx, tenant, from);
    if (reply !== null) return { reply, failed: false };
    if (attempt < maxRetries) {
      logger.warn({ action: 'openai_retry', attempt, tenantId: tenant.id, from });
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }

  if (shouldNotifyOpenAIError(tenant.id)) {
    logger.error({ action: 'openai_exhausted', tenantId: tenant.id, from, attempts: maxRetries });
    const body = `OpenAI no respondió tras ${maxRetries} reintentos (~${Math.round((maxRetries * (maxRetries + 1) / 2 * delayMs) / 60000)} min). Cliente wa.me/${from} sin respuesta.`;
    notificationService.notify(tenant.id, {
      type: 'ai_error',
      severity: 'critical',
      title: '🚨 IA caída — sin respuesta',
      body,
      data: { waId: from, attempts: maxRetries }
    }, false).catch(e => logger.error({ action: 'notify_persist_error', error: e.message }));
    sendPushToTenant(tenant.id, {
      title: '🚨 IA caída — sin respuesta',
      body,
      data: { waId: from, tenantId: tenant.id }
    }).catch(() => {});
  }

  return { reply: null, failed: true };
}
