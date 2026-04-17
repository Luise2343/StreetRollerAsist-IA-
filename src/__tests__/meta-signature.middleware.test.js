import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { metaSignature } from '../middleware/meta-signature.js';

function makeSignedRequest(secret, payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return {
    get: key => (key === 'X-Hub-Signature-256' ? sig : undefined),
    rawBody,
    body: payload
  };
}

describe('metaSignature middleware', () => {
  afterEach(() => {
    delete process.env.TEST_SECRET;
  });

  it('passes when env var not set', () => {
    const mw = metaSignature('TEST_SECRET');
    const next = vi.fn();
    const res = { sendStatus: vi.fn() };
    mw({ get: () => undefined, rawBody: Buffer.from('{}'), body: {} }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 for invalid signature', () => {
    process.env.TEST_SECRET = 'mysecret';
    const mw = metaSignature('TEST_SECRET');
    const next = vi.fn();
    const res = { sendStatus: vi.fn() };
    const req = {
      get: key => (key === 'X-Hub-Signature-256' ? 'sha256=bad' : undefined),
      rawBody: Buffer.from('{}'),
      body: {}
    };
    mw(req, res, next);
    expect(res.sendStatus).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for valid signature', () => {
    process.env.TEST_SECRET = 'mysecret';
    const mw = metaSignature('TEST_SECRET');
    const next = vi.fn();
    const res = { sendStatus: vi.fn() };
    const req = makeSignedRequest('mysecret', { hello: 'world' });
    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
