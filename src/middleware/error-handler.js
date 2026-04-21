// src/middleware/error-handler.js
// Centralized error response helper for controllers.
// In production, hides internal error details from clients.

/**
 * Sends a standardized error response.
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {Error|string} err - Error object or message string
 * @param {string} [fallback] - Safe message to show in production
 */
export function sendError(res, status, err, fallback = 'An error occurred') {
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd ? fallback : err instanceof Error ? err.message : String(err);
  if (err instanceof Error) console.error('[controller error]', err.message);
  return res.status(status).json({ ok: false, error: message });
}
