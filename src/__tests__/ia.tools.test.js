/**
 * Tests deterministas del agente IA (aiReplyStrict).
 *
 * Mockean OpenAI y los repositorios para verificar que el CABLEADO de cada tool
 * sea correcto, independientemente del juicio del modelo. Aquí controlamos qué
 * tool_call "emite" OpenAI y comprobamos que el handler haga lo correcto:
 *   - searchProducts / listAllProducts / getAdProducts → consultas correctas
 *   - classify_lead  → guarda lead_class en wa_profile
 *   - create_order   → crea orden + notifica al dueño (con dedup y fallback SKU)
 *   - notify_owner   → escala al dueño (con cooldown)
 * También verifica el ruteo anuncio vs orgánico (tool_choice forzado).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock del cliente OpenAI: una sola fn `create` que controlamos por test.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.chat = { completions: { create: createMock } };
    }
  }
}));

// Repos y servicios con efectos colaterales → mockeados.
const searchProductsMock = vi.fn();
const listAllProductsMock = vi.fn();
vi.mock('../services/products.search.js', () => ({
  searchProducts: searchProductsMock,
  listAllProducts: listAllProductsMock
}));

vi.mock('../services/prompt.builder.js', () => ({
  buildSystemPromptForTenant: vi.fn().mockResolvedValue('SYSTEM PROMPT'),
  buildSlotsPolicyJsonForTenant: vi.fn().mockResolvedValue({})
}));

vi.mock('../repositories/tenant.repository.js', () => ({
  tenantRepository: { listCategories: vi.fn().mockResolvedValue([]) }
}));

const upsertProfileFactMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../repositories/wa-profile.repository.js', () => ({
  waProfileRepository: { upsertProfileFact: upsertProfileFactMock }
}));

const findBySkuMock = vi.fn();
const findByIdMock = vi.fn();
vi.mock('../repositories/product.repository.js', () => ({
  productRepository: { findBySku: findBySkuMock, findById: findByIdMock }
}));

const createFromWAMock = vi.fn();
const findRecentMock = vi.fn();
vi.mock('../repositories/order.repository.js', () => ({
  orderRepository: {
    createFromWA: createFromWAMock,
    findRecentByWaIdAndProduct: findRecentMock
  }
}));

const findByAdIdWithProductsMock = vi.fn();
vi.mock('../repositories/ad-map.repository.js', () => ({
  adMapRepository: { findByAdIdWithProducts: findByAdIdWithProductsMock }
}));

const sendWaTextMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../services/whatsapp.client.js', () => ({ sendWaText: sendWaTextMock }));

vi.mock('../services/push.service.js', () => ({
  sendPushToTenant: vi.fn().mockResolvedValue(undefined)
}));

const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/business/notification.service.js', () => ({
  notificationService: { notify: notifyMock }
}));

vi.mock('../services/escalation-detector.js', () => ({
  runEscalationChecks: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/ai-budget.js', () => ({
  resolveModel: vi.fn().mockResolvedValue({ model: 'gpt-5-mini', degraded: false })
}));

vi.mock('../services/ai-usage.recorder.js', () => ({
  recordCompletionUsage: vi.fn()
}));

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

const tenant = {
  id: 3,
  name: 'VoltiPod',
  ai_model: 'gpt-5-mini',
  ai_max_tokens: 120,
  response_style: {},
  system_prompt: null
};
const WA = '50300000000';

// Helpers para construir respuestas de OpenAI.
function toolCallResponse(name, args) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }
          ]
        }
      }
    ]
  };
}
function textResponse(content) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

let aiReplyStrict;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.OPENAI_ENABLED = 'true';
  ({ aiReplyStrict } = await import('../services/ia.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  searchProductsMock.mockResolvedValue([]);
  listAllProductsMock.mockResolvedValue([]);
  findByAdIdWithProductsMock.mockResolvedValue(null);
});

describe('ruteo de tools (default: se confía en el modelo, tool_choice=auto)', () => {
  it('D1: consulta de producto sin anuncio → tool_choice=auto (no forzado)', async () => {
    createMock
      .mockResolvedValueOnce(toolCallResponse('searchProducts', { query: 'teclados' }))
      .mockResolvedValueOnce(textResponse('Tenemos estos teclados...'));

    const ctx = { turns: [], summary: null, profileFacts: null, currentAdId: null };
    await aiReplyStrict('precio de teclados', ctx, tenant, WA);

    // Con gpt-5-mini no forzamos: el modelo decide. Si elige searchProducts, se ejecuta.
    expect(createMock.mock.calls[0][0].tool_choice).toBe('auto');
    expect(searchProductsMock).toHaveBeenCalled();
  });

  it('D2: consulta desde anuncio → tool_choice=auto; si el modelo elige getAdProducts, no toca searchProducts', async () => {
    findByAdIdWithProductsMock.mockResolvedValue({
      id: 1,
      name: 'Repetidores',
      products: [{ id: 10, name: 'RT006', base_price: 29, sku: 'RT006', currency: 'USD' }]
    });
    createMock
      .mockResolvedValueOnce(toolCallResponse('getAdProducts', {}))
      .mockResolvedValueOnce(textResponse('Del anuncio: RT006...'));

    const ctx = { turns: [], summary: null, profileFacts: null, currentAdId: 'AD1' };
    await aiReplyStrict('qué precios manejan', ctx, tenant, WA);

    expect(createMock.mock.calls[0][0].tool_choice).toBe('auto');
    expect(searchProductsMock).not.toHaveBeenCalled();
  });
});

describe('handlers de cada tool', () => {
  it('D3: searchProducts → consulta con args parseados y responde', async () => {
    searchProductsMock.mockResolvedValue([{ id: 1, name: 'Silla GC-913', price: 158 }]);
    createMock
      .mockResolvedValueOnce(
        toolCallResponse('searchProducts', { query: 'silla', category: 'sillas' })
      )
      .mockResolvedValueOnce(textResponse('La silla GC-913 está en $158'));

    const ctx = { turns: [], summary: null, profileFacts: null, currentAdId: null };
    const reply = await aiReplyStrict('busco una silla', ctx, tenant, WA);

    expect(searchProductsMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 3, text: 'silla', category: 'sillas' })
    );
    expect(reply).toBe('La silla GC-913 está en $158');
  });

  it('D4: listAllProducts → lista del comercio', async () => {
    listAllProductsMock.mockResolvedValue([{ id: 1, name: 'X' }]);
    createMock
      .mockResolvedValueOnce(toolCallResponse('listAllProducts', {}))
      .mockResolvedValueOnce(textResponse('Tenemos varios productos...'));

    const ctx = { turns: [], summary: null, profileFacts: null, currentAdId: null };
    const reply = await aiReplyStrict('qué venden', ctx, tenant, WA);

    expect(listAllProductsMock).toHaveBeenCalledWith(3);
    expect(reply).toBe('Tenemos varios productos...');
  });

  it('D5: getAdProducts → usa los productos del anuncio, no searchProducts', async () => {
    findByAdIdWithProductsMock.mockResolvedValue({
      id: 1,
      name: 'Repetidores',
      products: [{ id: 10, name: 'RT007', base_price: 56, sku: 'RT007', currency: 'USD' }]
    });
    createMock
      .mockResolvedValueOnce(toolCallResponse('getAdProducts', {}))
      .mockResolvedValueOnce(textResponse('Del anuncio tenemos el RT007 a $56'));

    const ctx = { turns: [], summary: null, profileFacts: null, currentAdId: 'AD1' };
    const reply = await aiReplyStrict('hola quiero info', ctx, tenant, WA);

    expect(searchProductsMock).not.toHaveBeenCalled();
    expect(reply).toBe('Del anuncio tenemos el RT007 a $56');
  });

  it('D6: classify_lead → guarda lead_class y notifica', async () => {
    createMock
      .mockResolvedValueOnce(
        toolCallResponse('classify_lead', { classification: 'qualified', note: 'busca UPS' })
      )
      .mockResolvedValueOnce(textResponse('¡Perfecto! ¿Te lo procesamos?'));

    const ctx = { turns: [], summary: null, profileFacts: null, currentAdId: null };
    const reply = await aiReplyStrict('quiero el UPS de 86', ctx, tenant, WA);

    expect(upsertProfileFactMock).toHaveBeenCalledWith(
      3,
      WA,
      expect.objectContaining({ lead_class: 'qualified' })
    );
    expect(notifyMock).toHaveBeenCalled();
    expect(reply).toBe('¡Perfecto! ¿Te lo procesamos?');
  });
});

describe('create_order', () => {
  const orderArgs = {
    product_sku: 'RT006',
    customer_name: 'Juan Pérez',
    delivery_phone: '7777-7777',
    delivery_address: 'San Salvador, col Escalón #5',
    payment_method: 'contra_entrega'
  };

  it('D7: datos completos + SKU existe → crea orden y notifica al dueño', async () => {
    findBySkuMock.mockResolvedValue({ id: 10, name: 'Repetidor RT006', basePrice: 29, sku: 'RT006' });
    findRecentMock.mockResolvedValue(null);
    createFromWAMock.mockResolvedValue({ id: 77, total: 29, status: 'created' });
    createMock
      .mockResolvedValueOnce(toolCallResponse('create_order', orderArgs))
      .mockResolvedValueOnce(textResponse('✅ Orden #77 registrada'));

    const ctx = { turns: [], summary: null, profileFacts: {}, currentAdId: null };
    const reply = await aiReplyStrict('mis datos: Juan...', ctx, tenant, WA);

    expect(createFromWAMock).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        waId: WA,
        productId: 10,
        deliveryName: 'Juan Pérez',
        paymentMethod: 'contra_entrega'
      })
    );
    expect(sendWaTextMock).toHaveBeenCalled(); // notificación al dueño
    expect(reply).toBe('✅ Orden #77 registrada');
  });

  it('D8: orden reciente ya existe → no duplica', async () => {
    findBySkuMock.mockResolvedValue({ id: 10, name: 'RT006', basePrice: 29, sku: 'RT006' });
    findRecentMock.mockResolvedValue({ id: 50, total: 29, status: 'created' });
    createMock
      .mockResolvedValueOnce(toolCallResponse('create_order', orderArgs))
      .mockResolvedValueOnce(textResponse('Tu orden #50 ya estaba registrada'));

    const ctx = { turns: [], summary: null, profileFacts: {}, currentAdId: null };
    await aiReplyStrict('mis datos...', ctx, tenant, WA);

    expect(createFromWAMock).not.toHaveBeenCalled();
  });

  it('D9: SKU inexistente → avisa al dueño y responde "pedido recibido"', async () => {
    findBySkuMock.mockResolvedValue(null);
    searchProductsMock.mockResolvedValue([]); // fallback por nombre vacío
    createMock.mockResolvedValueOnce(
      toolCallResponse('create_order', { ...orderArgs, product_sku: 'NOEXISTE' })
    );

    const ctx = { turns: [], summary: null, profileFacts: {}, currentAdId: null };
    const reply = await aiReplyStrict('mis datos...', ctx, tenant, WA);

    expect(createFromWAMock).not.toHaveBeenCalled();
    expect(sendWaTextMock).toHaveBeenCalled(); // aviso de SKU no encontrado al dueño
    expect(reply).toMatch(/recibido/i);
  });
});

describe('notify_owner', () => {
  it('D10: reclamo → escala al dueño', async () => {
    createMock
      .mockResolvedValueOnce(
        toolCallResponse('notify_owner', { reason: 'complaint', summary: 'producto dañado' })
      )
      .mockResolvedValueOnce(textResponse('Lamento lo ocurrido, ya escalé tu caso'));

    const ctx = { turns: [], summary: null, profileFacts: {}, currentAdId: null };
    const reply = await aiReplyStrict('me llegó dañado', ctx, tenant, WA);

    expect(upsertProfileFactMock).toHaveBeenCalledWith(
      3,
      WA,
      expect.objectContaining({ escalation_reason: 'complaint' })
    );
    expect(sendWaTextMock).toHaveBeenCalled();
    expect(reply).toBe('Lamento lo ocurrido, ya escalé tu caso');
  });

  it('D11: cooldown activo (<30 min) → no reenvía WA al dueño', async () => {
    createMock
      .mockResolvedValueOnce(
        toolCallResponse('notify_owner', { reason: 'complaint', summary: 'otra vez' })
      )
      .mockResolvedValueOnce(textResponse('Ya tomé nota'));

    const ctx = {
      turns: [],
      summary: null,
      profileFacts: { escalated_at: new Date().toISOString() },
      currentAdId: null
    };
    await aiReplyStrict('sigo molesto', ctx, tenant, WA);

    expect(sendWaTextMock).not.toHaveBeenCalled();
  });
});
