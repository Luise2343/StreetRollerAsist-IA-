// src/services/second-sweep.js
import { pool } from '../config/db.js';
import {
  INACT_MIN, SUM_MAX_MSGS, MODEL,
  summarizeCombined, extractFactsWithAI, mergeFacts
} from './summarize.service.js';

const SECOND_SWEEP_MIN   = Number(process.env.SUM_SECOND_SWEEP_MIN || 0);        // 0 = desactivado
const SWEEP_INTERVAL_SEC = Math.max(30, Number(process.env.SUM_SWEEP_INTERVAL_SEC || 300)); // cada N s
const SWEEP_MAX_WA       = Math.max(1, Number(process.env.SWEEP_MAX_WA || 10));  // wa_id por pasada
const SWEEP_MAX_ROUNDS   = Math.max(1, Number(process.env.SWEEP_MAX_ROUNDS || 5)); // bloques por wa_id

async function drainPendingFor(waId, { maxRounds = SWEEP_MAX_ROUNDS } = {}) {
  let rounds = 0;
  let total = 0;

  while (rounds < maxRounds) {
    // Resumen único previo
    const prevRow = await pool.query(
      `SELECT summary, from_message_id, to_message_id, messages_count
         FROM public.wa_summary
        WHERE wa_id = $1`,
      [waId]
    );
    const prevSummary = prevRow.rows?.[0]?.summary || null;
    const prevFromId  = Number(prevRow.rows?.[0]?.from_message_id || 0);
    const prevToId    = Number(prevRow.rows?.[0]?.to_message_id   || 0);
    const prevCount   = Number(prevRow.rows?.[0]?.messages_count  || 0);

    // Siguiente bloque pendiente
    const { rows: msgRows } = await pool.query(
      `SELECT id, direction, body, created_at
         FROM public.wa_message
        WHERE wa_id = $1 AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [waId, prevToId, SUM_MAX_MSGS]
    );
    if (!msgRows.length) break;

    const fromId = msgRows[0].id;
    const toId   = msgRows[msgRows.length - 1].id;
    const count  = msgRows.length;

    const transcript = msgRows.map(m =>
      `${m.direction === 'in' ? 'Cliente' : 'Agente'}: ${String(m.body ?? '').trim()}`
    ).join('\n');

    // Resumen acumulado (previo + bloque)
    let summaryText = await summarizeCombined(prevSummary, transcript);
    if (!summaryText) summaryText = `Resumen acumulado de ${prevCount + count} mensajes (hasta id ${toId}).`;

    // Facts del bloque y merge con perfil
    let facts = {};
    try { facts = await extractFactsWithAI(transcript); } catch { facts = {}; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pf = await client.query(
        `SELECT facts_json FROM public.wa_profile WHERE wa_id = $1 FOR UPDATE`,
        [waId]
      );
      const prevFacts   = pf.rows?.[0]?.facts_json || {};
      const mergedFacts = mergeFacts(prevFacts, facts);

      // UPSERT del resumen único por wa_id (acumula)
      await client.query(
        `INSERT INTO public.wa_summary
          (wa_id, summary, facts_json, from_message_id, to_message_id, messages_count, model, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, now())
         ON CONFLICT (wa_id) DO UPDATE
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
        [waId, summaryText, JSON.stringify(mergedFacts), prevFromId || fromId, toId, count, MODEL]
      );

      // Perfil persistente
      await client.query(
        `INSERT INTO public.wa_profile (wa_id, facts_json, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (wa_id) DO UPDATE
           SET facts_json = $2::jsonb,
               updated_at = now()`,
        [waId, JSON.stringify(mergedFacts)]
      );

      // Purga del bloque drenado
      await client.query(
        `DELETE FROM public.wa_message
          WHERE wa_id = $1 AND id BETWEEN $2 AND $3`,
        [waId, fromId, toId]
      );

      await client.query('COMMIT');
      total  += count;
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

/**
 * Corre UNA pasada: busca wa_id cuyo último mensaje sea más viejo que
 * (INACT_MIN + SUM_SECOND_SWEEP_MIN) y tengan pendientes > last_to.
 */
export async function runSecondSweepOnce() {
  if (!SECOND_SWEEP_MIN) return { candidates: 0, results: [] };

  const cutoffMin = INACT_MIN + SECOND_SWEEP_MIN;
  const { rows } = await pool.query(
    `
    WITH last_activity AS (
      SELECT wa_id, MAX(created_at) AS last_at, MAX(id) AS max_id
      FROM public.wa_message
      GROUP BY wa_id
    ),
    last_to AS (
      SELECT wa_id, COALESCE(MAX(to_message_id), 0) AS last_to
      FROM public.wa_summary
      GROUP BY wa_id
    )
    SELECT a.wa_id
    FROM last_activity a
    LEFT JOIN last_to s ON s.wa_id = a.wa_id
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
      const out = await drainPendingFor(r.wa_id, { maxRounds: SWEEP_MAX_ROUNDS });
      results.push({ wa_id: r.wa_id, ...out });
    } catch (e) {
      results.push({ wa_id: r.wa_id, drained: false, error: e.message });
    }
  }

  return { candidates: rows.length, results };
}

/** Programador interno: ejecuta runSecondSweepOnce() cada SWEEP_INTERVAL_SEC. */
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
