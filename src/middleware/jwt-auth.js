// src/middleware/jwt-auth.js
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as appUserRepo from '../repositories/app-user.repository.js';

/**
 * Middleware to verify JWT access token and attach user to request
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      logger.warn({ error: err.message }, 'JWT verification failed');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Optional: refresh user data from DB to ensure role/active status is current
    const user = await appUserRepo.findById(decoded.userId);
    if (!user || !user.active) {
      logger.warn({ userId: decoded.userId }, 'User not found or inactive');
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Attach user and decoded token claims to request
    req.user = user;
    req.auth = decoded;
    next();
  } catch (err) {
    logger.error({ error: err.message }, 'Unexpected error in JWT auth middleware');
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Middleware to verify user has required role(s)
 * Usage: requireRole('admin', 'owner') — allows either role
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        { userId: req.user.id, userRole: req.user.role, allowedRoles },
        'User does not have required role'
      );
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

/**
 * Middleware to verify user belongs to the correct tenant
 * Compares req.user.tenant_id with req.params.tenantId or req.body.tenantId
 */
export function requireTenantScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const tenantId = req.params.tenantId || req.body?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID required' });
  }

  const requestTenantId = parseInt(tenantId, 10);
  if (req.user.tenant_id !== requestTenantId) {
    logger.warn(
      { userId: req.user.id, userTenant: req.user.tenant_id, requestTenant: requestTenantId },
      'Tenant scope mismatch'
    );
    return res.status(403).json({ error: 'Access denied: tenant mismatch' });
  }

  next();
}
