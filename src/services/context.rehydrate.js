// src/services/context.rehydrate.js
import { pool } from '../config/db.js';

const CTX_TURNS = Number(process.env.CTX_TURNS || 8);

function toTurns(rows) {
  const turns = [];
  for (const m of rows) {
    const body = String(m.body ?? '');
    if (m.direction === 'in') {
      turns.push({ user: body, assistant: '' });
    } else {
      if (turns.length === 0 || turns[turns.length - 1].assistant) {
        turns.push({ user: '', assistant: body });
      } else {
        turns[turns.length - 1].assistant = body;
      }
    }
  }
  return turns.slice(Math.max(0, turns.length - CTX_TURNS));
}

export async function rehydrateContext(tenantId, waId) {
  const p = await pool.query(
    `SELECT facts_json FROM public.wa_profile WHERE tenant_id = $1 AND wa_id = $2`,
    [tenantId, waId]
  );
  const profileFacts = p.rows?.[0]?.facts_json || null;

  const s = await pool.query(
    `SELECT summary, to_message_id
       FROM public.wa_summary
      WHERE tenant_id = $1 AND wa_id = $2
      ORDER BY to_message_id DESC NULLS LAST
      LIMIT 1`,
    [tenantId, waId]
  );
  const summary = s.rows?.[0]?.summary || null;
  const lastTo = Number(s.rows?.[0]?.to_message_id || 0);

  const m = await pool.query(
    `SELECT direction, body, meta
       FROM public.wa_message
      WHERE tenant_id = $1 AND wa_id = $2 AND id > $3
      ORDER BY id ASC
      LIMIT $4`,
    [tenantId, waId, lastTo, CTX_TURNS * 2]
  );

  const rows = m.rows || [];
  const hadHumanIntervention = rows.some(
    (r) => r.direction === 'out' && r.meta?.source === 'human_admin'
  );

  return { profileFacts, summary, turns: toTurns(rows), hadHumanIntervention };
}
