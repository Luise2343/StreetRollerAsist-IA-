// src/services/auth.service.js
import jwt from 'jsonwebtoken';
import { hash, verify } from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as appUserRepo from '../repositories/app-user.repository.js';
import * as userSessionRepo from '../repositories/user-session.repository.js';
import * as passwordResetRepo from '../repositories/password-reset.repository.js';

const REFRESH_TOKEN_BYTES = 32;
const RESET_TOKEN_BYTES = 32;
const ARGON2_OPTS = { type: 2, timeCost: 3, memoryCost: 65536 };

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL }
  );
}

async function issueSession({ user, userAgent, ip }) {
  const refreshTokenRaw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
  const refreshTokenHash = sha256Hex(refreshTokenRaw);
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await userSessionRepo.create({
    userId: user.id,
    tenantId: user.tenant_id,
    refreshTokenHash,
    expiresAt,
    userAgent,
    ip
  });

  return refreshTokenRaw;
}

export async function register({ tenantId, email, password, fullName, role = 'agent' }) {
  const existing = await appUserRepo.findByEmail(tenantId, email);
  if (existing) {
    const err = new Error('Email already registered for this tenant');
    err.status = 409;
    throw err;
  }
  const passwordHash = await hash(password, ARGON2_OPTS);
  const user = await appUserRepo.create({ tenantId, email, passwordHash, fullName, role });
  logger.info({ userId: user.id, tenantId }, 'User registered');
  return sanitizeUser(user);
}

export async function login({ tenantId, email, password, userAgent = '', ip = '' }) {
  const user = await appUserRepo.findByEmail(tenantId, email);
  if (!user || !user.active) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  let valid = false;
  try {
    valid = await verify(user.password_hash, password);
  } catch (e) {
    logger.warn({ error: e.message, userId: user.id }, 'Argon2 verify failed');
  }
  if (!valid) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  await appUserRepo.updateLastLogin(user.id);
  const refreshToken = await issueSession({ user, userAgent, ip });
  const accessToken = signAccessToken(user);

  logger.info({ userId: user.id, tenantId }, 'User logged in');
  return { accessToken, refreshToken, user: sanitizeUser(user) };
}

export async function refresh({ refreshToken, userAgent = '', ip = '' }) {
  if (!refreshToken) {
    const err = new Error('Missing refresh token');
    err.status = 400;
    throw err;
  }
  const tokenHash = sha256Hex(refreshToken);
  const session = await userSessionRepo.findByTokenHash(tokenHash);
  if (!session) {
    const err = new Error('Invalid or expired refresh token');
    err.status = 401;
    throw err;
  }

  const user = await appUserRepo.findById(session.user_id);
  if (!user || !user.active) {
    const err = new Error('User not found or inactive');
    err.status = 401;
    throw err;
  }

  // Rotate: revoke old session, issue new
  await userSessionRepo.revoke(session.id);
  const newRefreshToken = await issueSession({ user, userAgent, ip });
  const accessToken = signAccessToken(user);

  return { accessToken, refreshToken: newRefreshToken, user: sanitizeUser(user) };
}

export async function logout({ refreshToken, userId } = {}) {
  if (refreshToken) {
    const session = await userSessionRepo.findByTokenHash(sha256Hex(refreshToken));
    if (session) await userSessionRepo.revoke(session.id);
    return 1;
  }
  if (userId) {
    const rows = await userSessionRepo.revokeAllForUser(userId);
    return rows.length;
  }
  return 0;
}

export async function requestPasswordReset({ tenantId, email }) {
  const user = await appUserRepo.findByEmail(tenantId, email);
  if (!user) {
    logger.info({ email, tenantId }, 'Password reset requested for non-existent email');
    return null;
  }
  const tokenRaw = randomBytes(RESET_TOKEN_BYTES).toString('hex');
  const tokenHash = sha256Hex(tokenRaw);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await passwordResetRepo.create({ userId: user.id, tokenHash, expiresAt });
  logger.info({ userId: user.id }, 'Password reset token created');
  return tokenRaw;
}

export async function resetPassword({ token, newPassword }) {
  if (!token || !newPassword || newPassword.length < 8) {
    const err = new Error('Invalid token or password too short');
    err.status = 400;
    throw err;
  }
  const tokenHash = sha256Hex(token);
  const reset = await passwordResetRepo.findByTokenHash(tokenHash);
  if (!reset) {
    const err = new Error('Invalid or expired reset token');
    err.status = 400;
    throw err;
  }
  const passwordHash = await hash(newPassword, ARGON2_OPTS);
  await appUserRepo.updatePassword(reset.user_id, passwordHash);
  await passwordResetRepo.markUsed(reset.id);
  // Revoke all sessions: force re-login everywhere
  await userSessionRepo.revokeAllForUser(reset.user_id);
  logger.info({ userId: reset.user_id }, 'Password reset completed');
  return { ok: true };
}

export async function getMe(userId) {
  const user = await appUserRepo.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return sanitizeUser(user);
}

export async function invite({ tenantId, email, fullName, role = 'agent' }) {
  const existing = await appUserRepo.findByEmail(tenantId, email);
  if (existing) {
    const err = new Error('Email already registered for this tenant');
    err.status = 409;
    throw err;
  }
  const temporaryPassword = randomBytes(16).toString('hex');
  const passwordHash = await hash(temporaryPassword, ARGON2_OPTS);
  const user = await appUserRepo.create({ tenantId, email, passwordHash, fullName, role });

  // Also create a password-reset token so the invitee can set their own password
  const tokenRaw = randomBytes(RESET_TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await passwordResetRepo.create({ userId: user.id, tokenHash: sha256Hex(tokenRaw), expiresAt });

  logger.info({ userId: user.id, tenantId, role }, 'User invited');
  return { user: sanitizeUser(user), inviteToken: tokenRaw, temporaryPassword };
}

export async function verifyEmail(userId) {
  const user = await appUserRepo.setEmailVerified(userId);
  return sanitizeUser(user);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}
