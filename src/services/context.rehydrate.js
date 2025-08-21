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

export async function rehydrateContext(waId) {
  // 1) perfil persistente
  const p = await pool.query(
    `SELECT facts_json FROM public.wa_profile WHERE wa_id = $1`,
    [waId]
  );
  const profileFacts = p.rows?.[0]?.facts_json || null;

  // 2) último resumen
  const s = await pool.query(
    `SELECT summary, to_message_id
       FROM public.wa_summary
      WHERE wa_id = $1
      ORDER BY to_message_id DESC
      LIMIT 1`,
    [waId]
  );
  const summary = s.rows?.[0]?.summary || null;
  const lastTo  = Number(s.rows?.[0]?.to_message_id || 0);

  // 3) últimos mensajes
  const m = await pool.query(
    `SELECT direction, body
       FROM public.wa_message
      WHERE wa_id = $1 AND id > $2
      ORDER BY id ASC
      LIMIT $3`,
    [waId, lastTo, CTX_TURNS * 2]
  );

  return { profileFacts, summary, turns: toTurns(m.rows || []) };
}
