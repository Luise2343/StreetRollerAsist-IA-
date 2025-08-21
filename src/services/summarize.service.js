// src/services/summarize.service.js
import { pool } from '../config/db.js';
import OpenAI from 'openai';

 export const INACT_MIN    = Number(process.env.SUM_INACTIVITY_MIN || process.env.CTX_TTL_MIN || 180);
 export const SUM_MAX_MSGS = Number(process.env.SUM_MAX_MSGS || 120);
 export const MODEL        = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const openai       = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildTranscript(rows) {
  return rows
    .map(m => `${m.direction === 'in' ? 'Cliente' : 'Agente'}: ${String(m.body ?? '').trim()}`)
    .join('\n');
}

/* ----------------------- helpers para FACTS persistentes -------------------- */
function sanitizeFacts(f = {}) {
  const out = {};
  if (typeof f.name === 'string' && f.name.trim()) out.name = f.name.trim();

  if (Array.isArray(f.sizes)) {
    const s = Array.from(new Set(f.sizes.map(x => String(x).trim()).filter(Boolean)));
    if (s.length) out.sizes = s;
  }
  if (Array.isArray(f.interests)) {
    const s = Array.from(new Set(f.interests.map(x => String(x).trim()).filter(Boolean)));
    if (s.length) out.interests = s;
  }
  if (typeof f.notes === 'string' && f.notes.trim()) out.notes = f.notes.trim();

  return out; // sin nulls
}

export function mergeFacts(prev = {}, next = {}) {
  const merged = { ...prev };
  if (next.name) merged.name = next.name;

  if (next.sizes) {
    const a = Array.isArray(prev.sizes) ? prev.sizes : [];
    merged.sizes = Array.from(new Set([...a, ...next.sizes]));
  }
  if (next.interests) {
    const a = Array.isArray(prev.interests) ? prev.interests : [];
    merged.interests = Array.from(new Set([...a, ...next.interests]));
  }
  if (next.notes) merged.notes = next.notes;

  return merged;
}
/* ---------------------------------------------------------------------------- */

async function summarizeCombined(prevSummary, newTranscript) {
  // Prompt: construir un único resumen robusto (reemplaza al anterior).
  const messages = [
    {
      role: 'system',
      content:
        'Eres una asistente que crea un ÚNICO resumen acumulado de una conversación WhatsApp para CRM. ' +
        'Debes combinar el resumen previo con los nuevos mensajes y devolver un texto claro en español (120–200 palabras). ' +
        'No inventes datos. Mantén nombres, preferencias y acuerdos previos si siguen vigentes.'
    },
    {
      role: 'user',
      content:
        (prevSummary ? `Resumen previo:\n${prevSummary}\n\n` : '') +
        `Nuevos mensajes (Cliente ↔ Agente):\n${newTranscript}\n\n` +
        'Devuelve SOLO el nuevo resumen acumulado.'
    }
  ];

  const r = await openai.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 260
  });
  return (r.choices?.[0]?.message?.content || '').trim();
}

export async function extractFactsWithAI(transcript) {
  const schemaHint = `Devuelve SOLO JSON con esta forma:
{
  "name": string | null,
  "sizes": string[] | null,
  "interests": string[] | null,
  "notes": string | null
}`;
  const r = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'Eres una asistente que extrae hechos clave de una conversación para CRM.' },
      { role: 'user', content: schemaHint + '\n\nConversación:\n' + transcript }
    ],
    max_tokens: 220
  });

  const raw = (r.choices?.[0]?.message?.content || '').trim();
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    const slice = jsonStart >= 0 && jsonEnd >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : '{}';
    const parsed = JSON.parse(slice);
    return sanitizeFacts({
      name: parsed?.name ?? null,
      sizes: parsed?.sizes ?? null,
      interests: parsed?.interests ?? null,
      notes: parsed?.notes ?? null
    });
  } catch {
    return {};
  }
}

/**
 * Resumen tras inactividad:
 * - Lee resumen previo (si existe).
 * - Resume SOLO los mensajes pendientes desde el último to_message_id.
 * - Genera un NUEVO resumen acumulado (previo + nuevos) y lo UPSERTea por wa_id.
 * - Fusiona facts en wa_profile.
 * - Borra los mensajes ya resumidos.
 */
export async function summarizeIfInactive(waId) {
  // 1) ¿Hubo inactividad?
  const { rows: lastRows } = await pool.query(
    `SELECT MAX(created_at) AS last_at FROM public.wa_message WHERE wa_id = $1`,
    [waId]
  );
  const lastAt = lastRows?.[0]?.last_at ? new Date(lastRows[0].last_at) : null;
  if (!lastAt) return { summarized: false };

  const now = new Date();
  if (now.getTime() - lastAt.getTime() < INACT_MIN * 60 * 1000) {
    return { summarized: false };
  }

  // 2) Resumen previo (si lo hay) y último mensaje incluido
  const prevSummaryRow = await pool.query(
    `SELECT summary, from_message_id, to_message_id, messages_count
       FROM public.wa_summary
      WHERE wa_id = $1`,
    [waId]
  );
  const prevSummary = prevSummaryRow.rows?.[0]?.summary || null;
  const prevFromId  = Number(prevSummaryRow.rows?.[0]?.from_message_id || 0);
  const prevToId    = Number(prevSummaryRow.rows?.[0]?.to_message_id   || 0);
  const prevCount   = Number(prevSummaryRow.rows?.[0]?.messages_count  || 0);

  // 3) Mensajes pendientes desde el último to_message_id
  const { rows: msgRows } = await pool.query(
    `SELECT id, direction, body, created_at
       FROM public.wa_message
      WHERE wa_id = $1
        AND id > $2
        AND created_at <= $3
      ORDER BY id ASC
      LIMIT $4`,
    [waId, prevToId, lastAt, SUM_MAX_MSGS]
  );
  if (!msgRows?.length) return { summarized: false };

  const fromId = msgRows[0].id;
  const toId   = msgRows[msgRows.length - 1].id;
  const count  = msgRows.length;

  const transcript = buildTranscript(msgRows);

  // 4) Nuevo resumen acumulado (previo + nuevos)
  let summaryText = '';
  try {
    summaryText = await summarizeCombined(prevSummary, transcript);
    if (!summaryText) summaryText = `Resumen acumulado de ${prevCount + count} mensajes (hasta id ${toId}).`;
  } catch (e) {
    console.error('summarizeCombined error:', e.message);
    return { summarized: false, error: 'ai-summary-failed' };
  }

  // 5) Extrae facts de los NUEVOS mensajes y fusiona con perfil
  let facts = {};
  try {
    facts = await extractFactsWithAI(transcript); // ya sanitizado
  } catch (e) {
    console.error('extractFactsWithAI error:', e.message);
    facts = {};
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lee y bloquea perfil anterior para fusionar
    const prev = await client.query(
      `SELECT facts_json FROM public.wa_profile WHERE wa_id = $1 FOR UPDATE`,
      [waId]
    );
    const prevFacts = prev.rows?.[0]?.facts_json || {};
    const mergedFacts = mergeFacts(prevFacts, facts);

    // UPSERT del resumen ÚNICO por wa_id
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
             created_at       = now()`
      ,
      [
        waId,
        summaryText,
        JSON.stringify(mergedFacts || {}), // también dejamos facts del perfil aquí si quieres consultarlos rápido
        prevFromId || fromId,              // conserva inicio de la conversación
        toId,                              // último incluido
        count,                             // suma en DO UPDATE
        MODEL
      ]
    );

    // UPSERT del perfil persistente
    await client.query(
      `INSERT INTO public.wa_profile (wa_id, facts_json, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (wa_id) DO UPDATE
         SET facts_json = $2::jsonb,   -- ya viene MERGED
             updated_at = now()`,
      [waId, JSON.stringify(mergedFacts)]
    );

    // Borra el bloque ya resumido
    await client.query(
      `DELETE FROM public.wa_message
        WHERE wa_id = $1 AND id BETWEEN $2 AND $3`,
      [waId, fromId, toId]
    );

    await client.query('COMMIT');
    return { summarized: true, fromId, toId, count };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('summarizeIfInactive tx error:', e.message);
    return { summarized: false, error: 'tx-failed' };
  } finally {
    client.release();
  }
}
