// src/middleware/admin-auth.js
// Authorization: Bearer <token> — accepts ADMIN_API_KEY (legacy) or JWT with owner/admin role.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import * as appUserRepo from '../repositories/app-user.repository.js';
import { logger } from '../config/logger.js';

export async function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return res.status(503).json({ ok: false, error: 'Admin API disabled (set ADMIN_API_KEY)' });
  }

  // EventSource can't send headers — accept token via query param as fallback (legacy)
  const queryToken = req.query.apiKey;
  if (queryToken) {
    if (queryToken === adminKey) return next();
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Legacy admin API key match
  if (token === adminKey) return next();

  // JWT path
  const looksLikeJwt = token.split('.').length === 3;
  if (looksLikeJwt) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      if (!['owner', 'admin'].includes(decoded?.role)) {
        return res.status(403).json({ ok: false, error: 'Insufficient role' });
      }
      const tenantId = Number(decoded?.tenantId);
      if (Number.isFinite(tenantId)) {
        const tenant = await tenantRepository.findById(tenantId);
        if (tenant && tenant.active) {
          req.tenant = tenant;
          req.auth = decoded;
          if (decoded.userId) {
            const user = await appUserRepo.findById(decoded.userId).catch(() => null);
            if (user && user.active) req.user = user;
          }
          return next();
        }
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'Admin JWT verify failed');
    }
  }

  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}
