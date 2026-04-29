import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/db.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../repositories/wa-profile.repository.js', () => ({
  waProfileRepository: {
    setTakeover: vi.fn(),
    isTakeover: vi.fn()
  }
}));
vi.mock('../services/whatsapp.client.js', () => ({ sendWaText: vi.fn() }));
vi.mock('../services/message.store.js', () => ({ logOutgoing: vi.fn() }));
vi.mock('../repositories/tenant.repository.js', () => ({
  tenantRepository: { findById: vi.fn() }
}));
vi.mock('../config/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { pool } from '../config/db.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { sendWaText } from '../services/whatsapp.client.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import adminRoutes from '../routes/admin.routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', requireAdmin, adminRoutes);
  return app;
}

const VALID_KEY = 'test-admin-key';

beforeEach(() => {
  process.env.ADMIN_API_KEY = VALID_KEY;
  vi.clearAllMocks();
});

describe('GET /admin/conversations', () => {
  it('returns 401 without token', async () => {
    const app = buildApp();
    const res = await request(app).get('/admin/conversations');
    expect(res.status).toBe(401);
  });

  it('returns conversation list', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { waId: '123', name: 'Luis', humanTakeover: false, lastMessage: 'Hola', lastAt: new Date() }
      ]
    });
    const app = buildApp();
    const res = await request(app)
      .get('/admin/conversations')
      .set('Authorization', `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].waId).toBe('123');
  });
});

describe('GET /admin/conversations/:waId/messages', () => {
  it('returns messages in order', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, direction: 'in', body: 'Hola', createdAt: new Date() },
        { id: 2, direction: 'out', body: 'Bienvenido', createdAt: new Date() }
      ]
    });
    const app = buildApp();
    const res = await request(app)
      .get('/admin/conversations/123/messages')
      .set('Authorization', `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('GET /admin/conversations/:waId/profile', () => {
  it('returns profile data', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ factsJson: { name: 'Luis' }, humanTakeover: false }]
    });
    const app = buildApp();
    const res = await request(app)
      .get('/admin/conversations/123/profile')
      .set('Authorization', `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.data.humanTakeover).toBe(false);
  });

  it('returns empty defaults when no profile', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const app = buildApp();
    const res = await request(app)
      .get('/admin/conversations/123/profile')
      .set('Authorization', `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.data.humanTakeover).toBe(false);
  });
});

describe('POST /admin/conversations/:waId/takeover', () => {
  it('activates takeover', async () => {
    waProfileRepository.setTakeover.mockResolvedValueOnce();
    const app = buildApp();
    const res = await request(app)
      .post('/admin/conversations/123/takeover')
      .set('Authorization', `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(waProfileRepository.setTakeover).toHaveBeenCalledWith(3, '123', true);
  });
});

describe('POST /admin/conversations/:waId/release', () => {
  it('releases takeover', async () => {
    waProfileRepository.setTakeover.mockResolvedValueOnce();
    const app = buildApp();
    const res = await request(app)
      .post('/admin/conversations/123/release')
      .set('Authorization', `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(waProfileRepository.setTakeover).toHaveBeenCalledWith(3, '123', false);
  });
});

describe('POST /admin/conversations/:waId/send', () => {
  it('returns 400 when text is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/admin/conversations/123/send')
      .set('Authorization', `Bearer ${VALID_KEY}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('sends message and logs it', async () => {
    tenantRepository.findById.mockResolvedValueOnce({
      id: 3,
      wa_token: 'tok',
      wa_phone_number_id: '111'
    });
    sendWaText.mockResolvedValueOnce('wamid.abc');
    const app = buildApp();
    const res = await request(app)
      .post('/admin/conversations/123/send')
      .set('Authorization', `Bearer ${VALID_KEY}`)
      .send({ text: 'Hola desde admin' });
    expect(res.status).toBe(200);
    expect(res.body.messageId).toBe('wamid.abc');
    expect(sendWaText).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), '123', 'Hola desde admin');
  });
});
