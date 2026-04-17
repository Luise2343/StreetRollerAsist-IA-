// src/middleware/admin-auth.js — ADMIN_API_KEY via Authorization: Bearer

export function requireAdmin(req, res, next) {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    return res.status(503).json({ ok: false, error: 'Admin API disabled (set ADMIN_API_KEY)' });
  }
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || token !== key) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}
