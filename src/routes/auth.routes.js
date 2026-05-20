// src/routes/auth.routes.js
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import * as authService from '../services/auth.service.js';
import { requireAuth, requireRole } from '../middleware/jwt-auth.js';

const router = express.Router();

// Stricter rate limit for credential-heavy endpoints
const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts, please try again later.' }
});

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function pickIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || '';
}

function pickUserAgent(req) {
  return (req.headers['user-agent'] || '').toString().slice(0, 500);
}

const loginSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  email: z.string().email(),
  password: z.string().min(1)
});

router.post('/login', credentialsLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return send(res, 400, { ok: false, error: 'Invalid body', details: parsed.error.issues });
  try {
    const result = await authService.login({
      ...parsed.data,
      userAgent: pickUserAgent(req),
      ip: pickIp(req)
    });
    return send(res, 200, { ok: true, ...result });
  } catch (e) {
    logger.warn({ err: e.message }, 'Login failed');
    return send(res, e.status || 401, { ok: false, error: e.message || 'Invalid credentials' });
  }
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

router.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return send(res, 400, { ok: false, error: 'Invalid body' });
  try {
    const result = await authService.refresh({
      refreshToken: parsed.data.refreshToken,
      userAgent: pickUserAgent(req),
      ip: pickIp(req)
    });
    return send(res, 200, { ok: true, ...result });
  } catch (e) {
    return send(res, e.status || 401, { ok: false, error: e.message || 'Invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  try {
    const count = await authService.logout({ refreshToken });
    return send(res, 200, { ok: true, revoked: count });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'Logout failed' });
  }
});

const forgotSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  email: z.string().email()
});

router.post('/forgot-password', credentialsLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return send(res, 400, { ok: false, error: 'Invalid body' });
  try {
    const tokenRaw = await authService.requestPasswordReset(parsed.data);
    // Always 200 to prevent enumeration. Token exposed only in non-production.
    const expose = process.env.NODE_ENV !== 'production' && tokenRaw;
    return send(res, 200, { ok: true, ...(expose ? { resetToken: tokenRaw } : {}) });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'Failed to process request' });
  }
});

const resetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8)
});

router.post('/reset-password', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return send(res, 400, { ok: false, error: 'Invalid body' });
  try {
    await authService.resetPassword(parsed.data);
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, e.status || 400, { ok: false, error: e.message || 'Reset failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await authService.getMe(req.user.id);
    return send(res, 200, { ok: true, user });
  } catch (e) {
    return send(res, e.status || 404, { ok: false, error: e.message });
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: z.enum(['owner', 'admin', 'agent']).default('agent')
});

router.post('/invite', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return send(res, 400, { ok: false, error: 'Invalid body' });
  try {
    const result = await authService.invite({
      tenantId: req.user.tenant_id,
      ...parsed.data
    });
    return send(res, 201, { ok: true, ...result });
  } catch (e) {
    return send(res, e.status || 400, { ok: false, error: e.message });
  }
});

export default router;
