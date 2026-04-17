import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { sendError } from '../middleware/error-handler.js';

describe('sendError helper', () => {
  let originalNodeEnv;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('exposes error message in development', () => {
    process.env.NODE_ENV = 'development';
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendError(res, 500, new Error('DB connection failed'), 'Internal error');
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'DB connection failed' });
  });

  it('hides error detail in production', () => {
    process.env.NODE_ENV = 'production';
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendError(res, 500, new Error('DB connection failed'), 'Internal error');
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Internal error' });
  });

  it('uses correct HTTP status code', () => {
    process.env.NODE_ENV = 'development';
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendError(res, 422, new Error('Validation error'), 'Bad input');
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('handles string error in development', () => {
    process.env.NODE_ENV = 'development';
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendError(res, 400, 'Bad input string', 'Bad input');
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Bad input string' });
  });

  it('uses fallback for string error in production', () => {
    process.env.NODE_ENV = 'production';
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendError(res, 400, 'Bad input string', 'Safe fallback');
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Safe fallback' });
  });
});
