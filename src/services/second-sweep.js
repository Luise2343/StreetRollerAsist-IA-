// src/services/second-sweep.js
import { pool } from '../config/db.js';
import {
  INACT_MIN,
  SUM_MAX_MSGS,
  MODEL,
  summarizeCombined,
  extractFactsWithAI,
  mergeFacts
} from './summarize.service.js';

const SECOND_SWEEP_MIN = Number(process.env.SUM_SECOND_SWEEP_MIN || 0);
const SWEEP_INTERVAL_SEC = Math.max(30, Number(process.env.SUM_SWEEP_INTERVAL_SEC || 300));
const SWEEP_MAX_WA = Math.max(1, Number(process.env.SWEEP_MAX_WA || 10));
const SWEEP_MAX_ROUNDS = Math.max(1, Number(process.env.SWEEP_MAX_ROUNDS || 5));

async function drainPendingFor(tenantId, waId, { maxRounds = SWEEP_MAX_ROUNDS } = {}) {
  let rounds = 0;
  let total = 0;

  while (rounds < maxRounds) {
    const prevRow = await pool.query(
      `SELECT summary, from_message_id, to_message_id, messages_count
         FROM public.wa_summary
        WHERE tenant_id = $1 AND wa_id = $2`,
      [tenantId, waId]
    );
    const prevSummary = prevRow.rows?.[0]?.summary || null;
    const prevFromId = Number(prevRow.rows?.[0]?.from_message_id || 0);
    const prevToId = Number(prevRow.rows?.[0]?.to_message_id || 0);
    const prevCount = Number(prevRow.rows?.[0]?.messages_count || 0);

    const { rows: msgRows } = await pool.query(
      `SELECT id, direction, body, created_at
         FROM public.wa_message
        WHERE tenant_id = $1 AND wa_id = $2 AND id > $3
        ORDER BY id ASC
        LIMIT $4`,
      [tenantId, waId, prevToId, SUM_MAX_MSGS]
    );
    if (!msgRows.length) break;

    const fromId = msgRows[0].id;
    const toId = msgRows[msgRows.length - 1].id;
    const count = msgRows.length;

    const transcript = msgRows
      .map(m => `${m.direction === 'in' ? 'Cliente' : 'Agente'}: ${String(m.body ?? '').trim()}`)
      .join('\n');

    let summaryText = await summarizeCombined(prevSummary, transcript);
    if (!summaryText) summaryText = `Resumen acumulado de ${prevCount + count} mensajes (hasta id ${toId}).`;

    let facts = {};
    try {
      facts = await extractFactsWithAI(transcript);
    } catch {
      /* empty */
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pf = await client.query(
        `SELECT facts_json FROM public.wa_profile WHERE tenant_id = $1 AND wa_id = $2 FOR UPDATE`,
        [tenantId, waId]
      );
      const prevFacts = pf.rows?.[0]?.facts_json || {};
      const mergedFacts = mergeFacts(prevFacts, facts);

      await client.query(
        `INSERT INTO public.wa_summary
          (tenant_id, wa_id, summary, facts_json, from_message_id, to_message_id, messages_count, model, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
         ON CONFLICT (tenant_id, wa_id) DO UPDATE
           SET summary          = EXCLUDED.summary,
               facts_json       = EXCLUDED.facts_json,
               from_message_id  = CASE
                 WHEN public.wa_summary.from_message_id IS NULL THEN EXCLUDED.from_message_id
                 ELSE LEAST(public.wa_summary.from_message_id, EXCLUDED.from_message_id)
               END,
               to_message_id    = EXCLUDED.to_message_id,
               messages_count   = COALESCE(public.wa_summary.messages_count, 0) + EXCLUDED.messages_count,
               model            = EXCLUDED.model,
               created_at       = now()`,
        [tenantId, waId, summaryText, JSON.stringify(mergedFacts), prevFromId || fromId, toId, count, MODEL]
      );

      await client.query(
        `INSERT INTO public.wa_profile (tenant_id, wa_id, facts_json, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (tenant_id, wa_id) DO UPDATE
           SET facts_json = $3::jsonb,
               updated_at = now()`,
        [tenantId, waId, JSON.stringify(mergedFacts)]
      );

      await client.query(
        `DELETE FROM public.wa_message
          WHERE tenant_id = $1 AND wa_id = $2 AND id BETWEEN $3 AND $4`,
        [tenantId, waId, fromId, toId]
      );

      await client.query('COMMIT');
      total += count;
      rounds += 1;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return { drained: total > 0, rounds, total };
}

export async function runSecondSweepOnce() {
  if (!SECOND_SWEEP_MIN) return { candidates: 0, results: [] };

  const cutoffMin = INACT_MIN + SECOND_SWEEP_MIN;
  const { rows } = await pool.query(
    `
    WITH last_activity AS (
      SELECT tenant_id, wa_id, MAX(created_at) AS last_at, MAX(id) AS max_id
      FROM public.wa_message
      GROUP BY tenant_id, wa_id
    ),
    last_to AS (
      SELECT tenant_id, wa_id, COALESCE(MAX(to_message_id), 0) AS last_to
      FROM public.wa_summary
      GROUP BY tenant_id, wa_id
    )
    SELECT a.tenant_id, a.wa_id
    FROM last_activity a
    LEFT JOIN last_to s ON s.tenant_id = a.tenant_id AND s.wa_id = a.wa_id
    WHERE a.last_at < now() - ($1 || ' minutes')::interval
      AND a.max_id > COALESCE(s.last_to, 0)
    ORDER BY a.last_at ASC
    LIMIT $2
    `,
    [cutoffMin, SWEEP_MAX_WA]
  );

  const results = [];
  for (const r of rows) {
    try {
      const out = await drainPendingFor(r.tenant_id, r.wa_id, { maxRounds: SWEEP_MAX_ROUNDS });
      results.push({ tenant_id: r.tenant_id, wa_id: r.wa_id, ...out });
    } catch (e) {
      results.push({ tenant_id: r.tenant_id, wa_id: r.wa_id, drained: false, error: e.message });
    }
  }

  return { candidates: rows.length, results };
}

export function startSecondSweepScheduler() {
  if (!SECOND_SWEEP_MIN) {
    console.log('[second-sweep] desactivado (SUM_SECOND_SWEEP_MIN=0)');
    return;
  }
  setInterval(async () => {
    try {
      const out = await runSecondSweepOnce();
      if (out.candidates) {
        console.log('[second-sweep]', out);
      }
    } catch (e) {
      console.error('[second-sweep] error:', e.message);
    }
  }, SWEEP_INTERVAL_SEC * 1000);
  console.log(`[second-sweep] activo: cada ${SWEEP_INTERVAL_SEC}s; umbral total=${INACT_MIN}+${SECOND_SWEEP_MIN} min`);
}
