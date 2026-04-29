import { pool } from '../config/db.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { sendWaText } from '../services/whatsapp.client.js';
import { logOutgoing } from '../services/message.store.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { logger } from '../config/logger.js';

function tenantId(req) {
  return parseInt(req.query.tenantId || '3', 10);
}

export async function listConversations(req, res) {
  const tid = tenantId(req);
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);

  const { rows } = await pool.query(
    `SELECT
       m.wa_id AS "waId",
       p.facts_json->>'name' AS name,
       p.human_takeover AS "humanTakeover",
       m.last_msg AS "lastMessage",
       m.last_dir AS "lastDirection",
       m.last_at AS "lastAt",
       m.total AS "messageCount"
     FROM (
       SELECT
         wa_id,
         body AS last_msg,
         direction AS last_dir,
         created_at AS last_at,
         COUNT(*) OVER (PARTITION BY wa_id) AS total,
         ROW_NUMBER() OVER (PARTITION BY wa_id ORDER BY created_at DESC) AS rn
       FROM wa_message
       WHERE tenant_id = $1
     ) m
     LEFT JOIN wa_profile p ON p.tenant_id = $1 AND p.wa_id = m.wa_id
     WHERE m.rn = 1
     ORDER BY m.last_at DESC
     LIMIT $2 OFFSET $3`,
    [tid, limit, offset]
  );

  res.json({ ok: true, data: rows });
}

export async function getMessages(req, res) {
  const tid = tenantId(req);
  const { waId } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;

  const { rows } = await pool.query(
    `SELECT id, direction, body, msg_type AS "msgType", created_at AS "createdAt"
     FROM wa_message
     WHERE tenant_id = $1 AND wa_id = $2
       AND ($3::int IS NULL OR id < $3)
     ORDER BY created_at DESC
     LIMIT $4`,
    [tid, waId, before, limit]
  );

  res.json({ ok: true, data: rows.reverse() });
}

export async function getProfile(req, res) {
  const tid = tenantId(req);
  const { waId } = req.params;

  const { rows } = await pool.query(
    `SELECT facts_json AS "factsJson", human_takeover AS "humanTakeover", updated_at AS "updatedAt"
     FROM wa_profile WHERE tenant_id = $1 AND wa_id = $2`,
    [tid, waId]
  );

  res.json({ ok: true, data: rows[0] || { factsJson: {}, humanTakeover: false } });
}

export async function getSummary(req, res) {
  const tid = tenantId(req);
  const { waId } = req.params;

  const { rows } = await pool.query(
    `SELECT summary, facts_json AS "factsJson", messages_count AS "messagesCount",
            created_at AS "createdAt"
     FROM wa_summary WHERE tenant_id = $1 AND wa_id = $2`,
    [tid, waId]
  );

  res.json({ ok: true, data: rows[0] || null });
}

export async function setTakeover(req, res) {
  const tid = tenantId(req);
  const { waId } = req.params;
  await waProfileRepository.setTakeover(tid, waId, true);
  logger.info({ action: 'takeover_on', tenantId: tid, waId });
  res.json({ ok: true });
}

export async function releaseTakeover(req, res) {
  const tid = tenantId(req);
  const { waId } = req.params;
  await waProfileRepository.setTakeover(tid, waId, false);
  logger.info({ action: 'takeover_off', tenantId: tid, waId });
  res.json({ ok: true });
}

export async function sendMessage(req, res) {
  const tid = tenantId(req);
  const { waId } = req.params;
  const { text } = req.body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ ok: false, error: 'text is required' });
  }

  const tenant = await tenantRepository.findById(tid);
  if (!tenant?.wa_token) {
    return res.status(503).json({ ok: false, error: 'Tenant WA credentials not configured' });
  }

  const outId = await sendWaText(tenant, waId, text.trim());
  await logOutgoing({
    tenantId: tid,
    waId,
    providerMsgId: outId,
    body: text.trim(),
    msgType: 'text',
    meta: { source: 'human_admin' }
  });

  res.json({ ok: true, messageId: outId });
}
