/**
 * Tests for src/services/escalation-detector.js
 *
 * Mocks: notificationService.notify, sendPushToTenant,
 *        waProfileRepository.upsertProfileFact, logger
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be declared before dynamic imports) ---

vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock('../repositories/wa-profile.repository.js', () => ({
  waProfileRepository: {
    upsertProfileFact: vi.fn().mockResolvedValue({})
  }
}));

vi.mock('../services/business/notification.service.js', () => ({
  notificationService: {
    notify: vi.fn().mockResolvedValue({ id: 1 })
  }
}));

vi.mock('../services/push.service.js', () => ({
  sendPushToTenant: vi.fn().mockResolvedValue(undefined)
}));

// Import after mocks
import { runEscalationChecks } from '../services/escalation-detector.js';
import { notificationService } from '../services/business/notification.service.js';
import { sendPushToTenant } from '../services/push.service.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';

// Helper: build a minimal ctx with optional profileFacts
function makeCtx(profileFacts = {}) {
  return { profileFacts };
}

// Helper: call runEscalationChecks and wait for all microtasks/fire-and-forget
async function check(params) {
  await runEscalationChecks(params);
  // Allow any fire-and-forget promises to settle
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('runEscalationChecks — Layer A (AI reply patterns)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. fires ai_no_media warning when AI says it has no photos', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'información del DK-06?', // neutral user text — no Layer B trigger
      aiReply: 'Lo siento, no tengo fotos del DK-06.',
      ctx: makeCtx()
    });

    expect(notificationService.notify).toHaveBeenCalledOnce();
    const [, notifArg] = notificationService.notify.mock.calls[0];
    expect(notifArg.data.trigger).toBe('ai_no_media');
    expect(notifArg.severity).toBe('warning');
    expect(notifArg.title).toMatch(/fotos/i);
  });

  it('2. fires ai_uncertain info when AI says "Déjame consultar"', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '¿hay stock?',
      aiReply: 'Déjame consultar el stock disponible.',
      ctx: makeCtx()
    });

    expect(notificationService.notify).toHaveBeenCalledOnce();
    const [, notifArg] = notificationService.notify.mock.calls[0];
    expect(notifArg.data.trigger).toBe('ai_uncertain');
    expect(notifArg.severity).toBe('info');
  });
});

describe('runEscalationChecks — Layer B (user input patterns)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('3. fires customer_wants_human critical when user asks for a human', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'quiero hablar con un humano por favor',
      aiReply: 'Claro, puedo ayudarte.',
      ctx: makeCtx()
    });

    expect(notificationService.notify).toHaveBeenCalledOnce();
    const [, notifArg] = notificationService.notify.mock.calls[0];
    expect(notifArg.data.trigger).toBe('customer_wants_human');
    expect(notifArg.severity).toBe('critical');
    expect(notifArg.type).toBe('lead_escalated');
  });

  it('4. fires customer_complaint critical when user says product is defective', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'este producto está defectuoso, no funciona',
      aiReply: 'Lamentamos eso.',
      ctx: makeCtx()
    });

    // Both "defectuoso" and "no funciona" are in the same pattern; one trigger fires once
    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_complaint');
    const complaintCall = notificationService.notify.mock.calls.find(
      c => c[1].data.trigger === 'customer_complaint'
    );
    expect(complaintCall[1].severity).toBe('critical');
    expect(complaintCall[1].type).toBe('lead_escalated');
  });

  it('5. does NOT fire any notification when AI reply has no escalation patterns', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'cuánto cuesta la silla GC-913?',
      aiReply: 'La silla GC-913 cuesta $158.86. ¿Te interesa?',
      ctx: makeCtx()
    });

    expect(notificationService.notify).not.toHaveBeenCalled();
    expect(sendPushToTenant).not.toHaveBeenCalled();
  });
});

describe('runEscalationChecks — cooldown logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('6. skips second fire for same trigger within cooldown window', async () => {
    const recentTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago (< 4h warning cooldown)
    const ctx = makeCtx({
      escalation_cooldowns: { ai_no_media: recentTimestamp }
    });

    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'cuánto cuesta?', // neutral user text — no Layer B trigger
      aiReply: 'No tengo fotos del producto.',
      ctx
    });

    // Should be skipped because of cooldown
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('7. fires again when cooldown has expired', async () => {
    const oldTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago (> 4h warning cooldown)
    const ctx = makeCtx({
      escalation_cooldowns: { ai_no_media: oldTimestamp }
    });

    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'cuánto cuesta la silla?', // neutral user text — no Layer B trigger
      aiReply: 'No tengo fotos disponibles.',
      ctx
    });

    expect(notificationService.notify).toHaveBeenCalledOnce();
    const [, notifArg] = notificationService.notify.mock.calls[0];
    expect(notifArg.data.trigger).toBe('ai_no_media');
  });

  it('6b. critical trigger: skips within 1h cooldown', async () => {
    const recentTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const ctx = makeCtx({
      escalation_cooldowns: { customer_wants_human: recentTimestamp }
    });

    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'necesito un asesor humano',
      aiReply: 'Claro.',
      ctx
    });

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('6c. info trigger: skips within 24h cooldown', async () => {
    const recentTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    const ctx = makeCtx({
      escalation_cooldowns: { ai_uncertain: recentTimestamp }
    });

    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '¿hay stock?',
      aiReply: 'No estoy seguro del stock.',
      ctx
    });

    expect(notificationService.notify).not.toHaveBeenCalled();
  });
});

describe('runEscalationChecks — multiple matches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('8. fires multiple different triggers from one call', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'hay fotos disponibles?',
      // AI reply matches ai_no_media AND ai_uncertain
      aiReply: 'No tengo fotos del producto. Déjame consultar con el equipo.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_no_media');
    expect(triggers).toContain('ai_uncertain');
    expect(notificationService.notify).toHaveBeenCalledTimes(2);
  });
});

describe('runEscalationChecks — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('9a. handles null aiReply without throwing', async () => {
    await expect(
      check({
        tenantId: 3,
        waId: '50312345678',
        userText: 'hola',
        aiReply: null,
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('9b. handles null userText without throwing', async () => {
    await expect(
      check({
        tenantId: 3,
        waId: '50312345678',
        userText: null,
        aiReply: 'Aquí te ayudo con cualquier cosa.',
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('9c. handles empty strings without throwing', async () => {
    await expect(
      check({
        tenantId: 3,
        waId: '50312345678',
        userText: '',
        aiReply: '',
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('9d. returns early when tenantId is missing', async () => {
    await expect(
      check({
        tenantId: null,
        waId: '50312345678',
        userText: 'quiero hablar con un humano',
        aiReply: 'No tengo fotos.',
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('9e. returns early when waId is missing', async () => {
    await expect(
      check({
        tenantId: 3,
        waId: null,
        userText: 'quiero hablar con un humano',
        aiReply: 'No tengo fotos.',
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();

    expect(notificationService.notify).not.toHaveBeenCalled();
  });
});

describe('runEscalationChecks — accent variants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('10a. matches "no tengo imagenes" (no accent)', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Lo siento, no tengo imagenes del producto.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_no_media');
  });

  it('10b. matches "no tengo imágenes" (with accent)', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Lo siento, no tengo imágenes del producto.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_no_media');
  });

  it('10c. matches "no sé enviar fotos"', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Lamentablemente no sé enviar fotos por este canal.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_no_media');
  });

  it('10d. matches "déjame verificar" (with accent)', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Déjame verificar el inventario.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_uncertain');
  });

  it('10e. matches "dejame revisar" (no accent)', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Espera un momento, dejame revisar eso.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_uncertain');
  });
});

describe('runEscalationChecks — push and cooldown persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls sendPushToTenant in fire-and-forget mode for each fired trigger', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'No tengo fotos disponibles para enviarte.',
      ctx: makeCtx()
    });

    expect(sendPushToTenant).toHaveBeenCalledOnce();
    const [tenantId, payload] = sendPushToTenant.mock.calls[0];
    expect(tenantId).toBe(3);
    expect(payload).toHaveProperty('title');
    expect(payload.data).toMatchObject({ waId: '50312345678', tenantId: 3 });
  });

  it('persists escalation_cooldowns after firing', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'No tengo fotos del modelo.',
      ctx: makeCtx()
    });

    expect(waProfileRepository.upsertProfileFact).toHaveBeenCalledOnce();
    const [tenantId, waId, facts] = waProfileRepository.upsertProfileFact.mock.calls[0];
    expect(tenantId).toBe(3);
    expect(waId).toBe('50312345678');
    expect(facts).toHaveProperty('escalation_cooldowns');
    expect(facts.escalation_cooldowns).toHaveProperty('ai_no_media');
  });

  it('does NOT persist cooldowns when nothing fired', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'hola',
      aiReply: 'Hola, ¿en qué te ayudo?',
      ctx: makeCtx()
    });

    expect(waProfileRepository.upsertProfileFact).not.toHaveBeenCalled();
  });
});

describe('runEscalationChecks — additional AI patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires ai_unknown_info when AI says no tiene esa información', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Lo siento, no tengo esa información disponible.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_unknown_info');
  });

  it('fires ai_unknown_info when AI says no manejo esa info', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'No manejo esa info, te recomiendo contactar directamente.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_unknown_info');
  });

  it('fires ai_deferred_to_human when AI says an agent will contact', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Un asesor te contactará a la brevedad para ayudarte.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_deferred_to_human');
  });

  it('fires ai_capability_limit when AI says lamento no poder', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'Lamento no poder enviarte esa información por este canal.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_capability_limit');
  });

  it('fires ai_capability_limit when AI says no tengo acceso', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: '',
      aiReply: 'No tengo acceso a esa información del sistema.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('ai_capability_limit');
  });
});

describe('runEscalationChecks — error path coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles notificationService.notify rejection gracefully (no throw)', async () => {
    notificationService.notify.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      check({
        tenantId: 3,
        waId: '50312345678',
        userText: '',
        aiReply: 'No tengo fotos del producto.',
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();
  });

  it('handles waProfileRepository.upsertProfileFact rejection gracefully (no throw)', async () => {
    waProfileRepository.upsertProfileFact.mockRejectedValueOnce(new Error('DB timeout'));

    await expect(
      check({
        tenantId: 3,
        waId: '50312345678',
        userText: '',
        aiReply: 'No tengo fotos del DK-06.',
        ctx: makeCtx()
      })
    ).resolves.toBeUndefined();
  });
});

describe('runEscalationChecks — additional user patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires customer_wants_media when user asks for media via "mándame foto"', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'mándame foto del producto por favor',
      aiReply: 'Claro, revisaré.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_wants_media');
    const call = notificationService.notify.mock.calls.find(c => c[1].data.trigger === 'customer_wants_media');
    expect(call[1].severity).toBe('warning');
  });

  it('fires customer_wants_media when user asks "tienes fotos"', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'tienes fotos del escritorio DK-06?',
      aiReply: 'Déjame revisar.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_wants_media');
  });

  it('fires customer_complaint when user mentions reclamo', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'tengo un reclamo sobre mi pedido',
      aiReply: 'Lamentamos el inconveniente.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_complaint');
  });

  it('fires customer_invoice when user asks for factura fiscal', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'necesito factura fiscal para mi empresa',
      aiReply: 'Entiendo.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_invoice');
    const call = notificationService.notify.mock.calls.find(c => c[1].data.trigger === 'customer_invoice');
    expect(call[1].severity).toBe('info');
  });

  it('fires customer_wants_human when user mentions "persona real"', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'quiero hablar con una persona real',
      aiReply: 'Puedo ayudarte.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_wants_human');
  });

  it('fires customer_wants_human when user mentions "operador"', async () => {
    await check({
      tenantId: 3,
      waId: '50312345678',
      userText: 'necesito hablar con el operador',
      aiReply: 'Puedo ayudarte.',
      ctx: makeCtx()
    });

    const triggers = notificationService.notify.mock.calls.map(c => c[1].data.trigger);
    expect(triggers).toContain('customer_wants_human');
  });
});
