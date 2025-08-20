// src/services/summarize.service.js
import { pool } from '../config/db.js';
import OpenAI from 'openai';

const INACT_MIN    = Number(process.env.SUM_INACTIVITY_MIN || process.env.CTX_TTL_MIN || 180);
const SUM_MAX_MSGS = Number(process.env.SUM_MAX_MSGS || 120);
const MODEL        = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const openai       = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildTranscript(rows) {
  return rows.map(m => `${m.direction === 'in' ? 'Cliente' : 'Agente'}: ${String(m.body ?? '').trim()}`).join('\n');
}

// === NUEVO: sanitizar y fusionar facts ===
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

  return out; // sin campos null
}

function mergeFacts(prev = {}, next = {}) {
  const merged = { ...prev };

  // Solo sobreescribe si NEXT trae valor NO vacío
  if (next.name) merged.name = next.name;

  if (next.sizes) {
    const a = Array.isArray(prev.sizes) ? prev.sizes : [];
    merged.sizes = Array.from(new Set([...a, ...next.sizes]));
  }
  if (next.interests) {
    const a = Array.isArray(prev.interests) ? prev.interests : [];
    merged.interests = Array.from(new Set([...a, ...next.interests]));
  }
  // Para notes: si viene nueva, reemplaza; si no, queda la anterior
  if (next.notes) merged.notes = next.notes;

  return merged;
}
// === FIN NUEVO ===

async function summarizeWithAI(transcript) {
  const r = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'Eres una asistente que hace resúmenes breves de conversaciones de WhatsApp para CRM. Español, 100–140 palabras, sin inventar.' },
      { role: 'user', content: 'Resume la conversación (Cliente ↔ Agente). Enfócate en intención, productos, acuerdos y siguientes pasos.\n\n' + transcript }
    ],
    max_tokens: 200
  });
  return (r.choices?.[0]?.message?.content || '').trim();
}

async function extractFactsWithAI(transcript) {
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

    // === NUEVO: sanitiza aquí para NO enviar nulls al merge ===
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

export async function summarizeIfInactive(waId) {
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

  const { rows: sumRows } = await pool.query(
    `SELECT COALESCE(MAX(to_message_id), 0) AS last_to
       FROM public.wa_summary WHERE wa_id = $1`,
    [waId]
  );
  const lastTo = Number(sumRows?.[0]?.last_to || 0);

  const { rows: msgRows } = await pool.query(
    `SELECT id, direction, body, created_at
       FROM public.wa_message
      WHERE wa_id = $1 AND id > $2 AND created_at <= $3
      ORDER BY id ASC
      LIMIT $4`,
    [waId, lastTo, lastAt, SUM_MAX_MSGS]
  );
  if (!msgRows?.length) return { summarized: false };

  const fromId = msgRows[0].id;
  const toId   = msgRows[msgRows.length - 1].id;
  const count  = msgRows.length;

  const transcript = buildTranscript(msgRows);

  let summaryText = '';
  try {
    summaryText = await summarizeWithAI(transcript);
    if (!summaryText) summaryText = `Resumen de ${count} mensajes (ids ${fromId}-${toId}).`;
  } catch (e) {
    console.error('summarizeWithAI error:', e.message);
    return { summarized: false, error: 'ai-summary-failed' };
  }

  // === NUEVO: obtener facts sanitizados
  let facts = {};
  try {
    facts = await extractFactsWithAI(transcript); // ya viene sin nulls
  } catch (e) {
    console.error('extractFactsWithAI error:', e.message);
    facts = {};
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.wa_summary
         (wa_id, summary, facts_json, from_message_id, to_message_id, messages_count, model)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [waId, summaryText, JSON.stringify(facts || {}), fromId, toId, count, MODEL]
    );

    // === NUEVO: merge "inteligente" del perfil (sin sobrescribir con null)
    const prev = await client.query(
      `SELECT facts_json FROM public.wa_profile WHERE wa_id = $1 FOR UPDATE`,
      [waId]
    );
    const prevFacts = prev.rows?.[0]?.facts_json || {};
    const mergedFacts = mergeFacts(prevFacts, facts); // <-- aquí se respeta el nombre previo

    await client.query(
      `INSERT INTO public.wa_profile (wa_id, facts_json, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (wa_id) DO UPDATE
         SET facts_json = EXCLUDED.facts_json,  -- usamos el MERGED calculado
             updated_at = now()`,
      [waId, JSON.stringify(mergedFacts)]
    );

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
