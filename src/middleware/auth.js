// src/middleware/auth.js
// Authorization: Bearer <token>
// Accepts either a JWT (preferred) or a tenant API key (legacy).
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import * as appUserRepo from '../repositories/app-user.repository.js';
import { resolveTenantByApiKey } from './tenant.js';
import { logger } from '../config/logger.js';

export async function requireApiKey(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Heuristic: JWTs have 3 dot-separated base64 segments
  const looksLikeJwt = token.split('.').length === 3;

  if (looksLikeJwt) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
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
      logger.warn({ tenantId }, 'JWT decoded but tenant not found/active');
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    } catch (err) {
      // Fall through to API key path
      logger.debug({ err: err.message }, 'JWT verify failed, trying API key');
    }
  }

  // Legacy: tenant API key
  try {
    const tenant = await resolveTenantByApiKey(token);
    if (!tenant) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.tenant = tenant;
    return next();
  } catch (err) {
    logger.error({ err: err.message }, 'Tenant resolution failed');
    return res.status(500).json({ ok: false, error: 'Tenant resolution failed' });
  }
}
