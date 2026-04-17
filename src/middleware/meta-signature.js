// src/middleware/meta-signature.js
// Validates Meta webhook HMAC-SHA256 signatures.
// Requires rawBody to be set by express.json verify callback.
import crypto from 'crypto';

/**
 * Returns an Express middleware that validates X-Hub-Signature-256.
 * @param {string} secretEnvVar - Name of the env var holding the app secret.
 */
export function metaSignature(secretEnvVar) {
  return (req, res, next) => {
    const secret = process.env[secretEnvVar];

    if (!secret) {
      console.warn(`[meta-signature] ${secretEnvVar} not set — skipping signature check`);
      return next();
    }

    const signature = req.get('X-Hub-Signature-256') || '';
    const payload = req.rawBody || Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (signature.length !== expected.length) {
      return res.sendStatus(403);
    }

    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return res.sendStatus(403);
      }
    } catch {
      return res.sendStatus(403);
    }

    next();
  };
}
