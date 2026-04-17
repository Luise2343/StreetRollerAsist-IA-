// src/middleware/auth.js
// REST: Authorization: Bearer <tenant.api_key>
import { resolveTenantByApiKey } from './tenant.js';

export async function requireApiKey(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const tenant = await resolveTenantByApiKey(token);
    if (!tenant) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.tenant = tenant;
    return next();
  } catch {
    return res.status(500).json({ ok: false, error: 'Tenant resolution failed' });
  }
}
