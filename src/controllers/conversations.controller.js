import { pool } from '../config/db.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { sendWaText } from '../services/whatsapp.client.js';
import { logOutgoing } from '../services/message.store.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { logger } from '../config/logger.js';
import { subscribeConv, unsubscribeConv, subscribeGlobal, unsubscribeGlobal } from '../services/sse.service.js';

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

export async function getMetrics(req, res) {
  const tid = tenantId(req);
  const range = req.query.range || '7D';
  const days = range === '1D' ? 1 : range === '7D' ? 7 : range === '30D' ? 30 : 90;

  const [msgsByDay, convsByDay, totals, aiRate, avgResponse] = await Promise.all([
    // Messages per day
    pool.query(
      `SELECT TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'MM-DD') AS label,
              COUNT(*)::int AS v
       FROM wa_message
       WHERE tenant_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE(created_at AT TIME ZONE 'UTC')
       ORDER BY DATE(created_at AT TIME ZONE 'UTC')`,
      [tid, days]
    ),
    // New conversations per day (first message date of each wa_id)
    pool.query(
      `SELECT TO_CHAR(DATE(first_msg AT TIME ZONE 'UTC'), 'MM-DD') AS label,
              COUNT(*)::int AS v
       FROM (
         SELECT wa_id, MIN(created_at) AS first_msg
         FROM wa_message WHERE tenant_id = $1
         GROUP BY wa_id
       ) sub
       WHERE first_msg >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE(first_msg AT TIME ZONE 'UTC')
       ORDER BY DATE(first_msg AT TIME ZONE 'UTC')`,
      [tid, days]
    ),
    // Total messages + total conversations in range
    pool.query(
      `SELECT COUNT(*) AS total_msgs,
              COUNT(DISTINCT wa_id) AS total_convs
       FROM wa_message
       WHERE tenant_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval`,
      [tid, days]
    ),
    // AI rate: % of profiles NOT in human_takeover
    pool.query(
      `SELECT ROUND(
         COUNT(*) FILTER (WHERE NOT human_takeover) * 100.0 / NULLIF(COUNT(*), 0)
       )::int AS ai_rate
       FROM wa_profile WHERE tenant_id = $1`,
      [tid]
    ),
    // Avg response time in minutes (first bot reply after each incoming message)
    pool.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (out_time - in_time)) / 60)::numeric, 1) AS avg_mins
       FROM (
         SELECT m1.created_at AS in_time,
                MIN(m2.created_at) AS out_time
         FROM wa_message m1
         JOIN wa_message m2
           ON m2.tenant_id = m1.tenant_id
          AND m2.wa_id = m1.wa_id
          AND m2.direction = 'out'
          AND m2.created_at > m1.created_at
         WHERE m1.tenant_id = $1
           AND m1.direction = 'in'
           AND m1.created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY m1.id, m1.created_at
       ) t`,
      [tid, days]
    )
  ]);

  res.json({
    ok: true,
    data: {
      totalMsgs: parseInt(totals.rows[0]?.total_msgs || '0', 10),
      totalConvs: parseInt(totals.rows[0]?.total_convs || '0', 10),
      aiRate: aiRate.rows[0]?.ai_rate ?? 0,
      avgResponseMins: parseFloat(avgResponse.rows[0]?.avg_mins || '0'),
      msgPerDay: msgsByDay.rows,
      convPerDay: convsByDay.rows,
    }
  });
}

export function sseConvStream(req, res) {
  const { waId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  subscribeConv(waId, res);
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(hb); unsubscribeConv(waId, res); });
}

export function sseGlobalStream(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': connected\n\n');

  subscribeGlobal(res);
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(hb); unsubscribeGlobal(res); });
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
