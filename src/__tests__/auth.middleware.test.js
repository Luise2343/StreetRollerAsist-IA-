import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../middleware/tenant.js', () => ({
  resolveTenantByApiKey: vi.fn()
}));

import { resolveTenantByApiKey } from '../middleware/tenant.js';
import { requireApiKey } from '../middleware/auth.js';

describe('requireApiKey middleware', () => {
  beforeEach(() => {
    vi.mocked(resolveTenantByApiKey).mockReset();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await requireApiKey({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when tenant is not found for token', async () => {
    vi.mocked(resolveTenantByApiKey).mockResolvedValue(null);
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await requireApiKey({ headers: { authorization: 'Bearer unknown' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and sets req.tenant when token resolves', async () => {
    const tenant = { id: 7, name: 'Shop', api_key: 'k' };
    vi.mocked(resolveTenantByApiKey).mockResolvedValue(tenant);
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req = { headers: { authorization: 'Bearer k' } };
    await requireApiKey(req, res, next);
    expect(req.tenant).toBe(tenant);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 for non-Bearer scheme', async () => {
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await requireApiKey({ headers: { authorization: 'Basic x' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
