import webpush from 'web-push';
import { pool } from '../config/db.js';
import { logger } from '../config/logger.js';

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails(
    `mailto:${VAPID_EMAIL || 'admin@voltipod.com'}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
}

export async function saveSubscription(tenantId, subscription, userAgent = null) {
  const { endpoint, keys } = subscription;
  await pool.query(
    `INSERT INTO push_subscription (tenant_id, endpoint, keys, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys`,
    [tenantId, endpoint, JSON.stringify(keys), userAgent]
  );
}

export async function removeSubscription(tenantId, endpoint) {
  await pool.query(
    'DELETE FROM push_subscription WHERE tenant_id = $1 AND endpoint = $2',
    [tenantId, endpoint]
  );
}

export async function sendPushToTenant(tenantId, payload) {
  ensureVapid();
  if (!vapidConfigured) {
    logger.warn({ action: 'push_skip', reason: 'VAPID not configured' });
    return;
  }

  const { rows } = await pool.query(
    'SELECT endpoint, keys FROM push_subscription WHERE tenant_id = $1',
    [tenantId]
  );
  if (!rows.length) return;

  const notification = JSON.stringify(payload);
  const dead = [];

  await Promise.allSettled(
    rows.map(async row => {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: row.keys }, notification);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(row.endpoint);
        } else {
          logger.warn({ action: 'push_error', endpoint: row.endpoint, status: err.statusCode });
        }
      }
    })
  );

  // Clean up expired subscriptions
  for (const endpoint of dead) {
    await pool.query('DELETE FROM push_subscription WHERE endpoint = $1', [endpoint]).catch(() => {});
  }
}
