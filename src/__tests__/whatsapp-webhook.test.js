/**
 * Tests for the WhatsApp webhook route.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../config/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    })
  },
  ping: vi.fn().mockResolvedValue({ ok: 1 })
}));

vi.mock('../repositories/tenant.repository.js', () => ({
  tenantRepository: {
    findByWaVerifyToken: vi.fn(),
    listCategories: vi.fn().mockResolvedValue([])
  }
}));

vi.mock('../middleware/tenant.js', () => ({
  resolveTenantByWaPhoneNumberId: vi.fn()
}));

vi.mock('../services/ia.js', () => ({
  aiReplyStrict: vi.fn().mockResolvedValue('Hola, en que te puedo ayudar?')
}));

vi.mock('../services/summarize.service.js', () => ({
  summarizeIfInactive: vi.fn().mockResolvedValue({ summarized: false }),
  INACT_MIN: 180,
  SUM_MAX_MSGS: 120,
  MODEL: 'gpt-4o-mini',
  summarizeCombined: vi.fn(),
  extractFactsWithAI: vi.fn(),
  mergeFacts: vi.fn()
}));

vi.mock('../services/second-sweep.js', () => ({
  startSecondSweepScheduler: vi.fn()
}));

globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ messages: [{ id: 'out-msg-id' }] })
});

vi.mock('../config/env.js', () => ({}));
vi.mock('../config/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock('../middleware/meta-signature.js', () => ({
  metaSignature: () => (_req, _res, next) => next()
}));

import { tenantRepository } from '../repositories/tenant.repository.js';
import { resolveTenantByWaPhoneNumberId } from '../middleware/tenant.js';

let request;
let app;

const mockTenant = {
  id: 1,
  name: 'Test',
  wa_token: 'test-wa-token',
  wa_phone_number_id: '123456789',
  wa_verify_token: 'test-verify-token',
  language: 'es',
  ai_model: 'gpt-4o-mini',
  ai_max_tokens: 120,
  response_style: {},
  system_prompt: null
};

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
  process.env.OPENAI_API_KEY = 'sk-test';

  vi.mocked(tenantRepository.findByWaVerifyToken).mockImplementation(token =>
    Promise.resolve(token === 'test-verify-token' ? mockTenant : null)
  );
  vi.mocked(resolveTenantByWaPhoneNumberId).mockResolvedValue(mockTenant);

  const { default: supertest } = await import('supertest');
  const { default: expressApp } = await import('../app.js');
  app = expressApp;
  request = supertest(app);
});

function makeWaPayload(text, from = '521234567890', msgId = 'msg-001') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '123456789' },
              messages: [
                {
                  id: msgId,
                  from,
                  type: 'text',
                  text: { body: text },
                  timestamp: String(Date.now())
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

describe('GET /webhooks/whatsapp', () => {
  it('returns 200 and challenge for valid verify token', async () => {
    const res = await request.get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-verify-token',
      'hub.challenge': 'abc123'
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  it('returns 403 for wrong verify token', async () => {
    const res = await request
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc' });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/whatsapp', () => {
  it('returns 200 for a valid text message', async () => {
    const res = await request
      .post('/webhooks/whatsapp')
      .send(makeWaPayload('Hola', '521234567890', 'unique-msg-001'));
    expect(res.status).toBe(200);
  });

  it('returns 200 for an empty payload', async () => {
    const res = await request
      .post('/webhooks/whatsapp')
      .send({ object: 'whatsapp_business_account', entry: [] });
    expect(res.status).toBe(200);
  });

  it('returns 200 for status update events (ignores them)', async () => {
    const res = await request.post('/webhooks/whatsapp').send({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: { statuses: [{ id: 'msg-001', status: 'delivered' }] }
            }
          ]
        }
      ]
    });
    expect(res.status).toBe(200);
  });

  it('returns 200 when tenant cannot be resolved (no processing)', async () => {
    vi.mocked(resolveTenantByWaPhoneNumberId).mockResolvedValueOnce(null);
    const res = await request
      .post('/webhooks/whatsapp')
      .send(makeWaPayload('Hola', '521234567890', 'unique-msg-002'));
    expect(res.status).toBe(200);
    vi.mocked(resolveTenantByWaPhoneNumberId).mockResolvedValue(mockTenant);
  });
});
