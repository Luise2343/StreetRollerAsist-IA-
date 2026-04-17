// src/services/summarize.service.js
import { pool } from '../config/db.js';
import OpenAI from 'openai';

export const INACT_MIN = Number(process.env.SUM_INACTIVITY_MIN || process.env.CTX_TTL_MIN || 180);
export const SUM_MAX_MSGS = Number(process.env.SUM_MAX_MSGS || 120);
export const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildTranscript(rows) {
  return rows
    .map(m => `${m.direction === 'in' ? 'Cliente' : 'Agente'}: ${String(m.body ?? '').trim()}`)
    .join('\n');
}

function sanitizeFacts(f = {}) {
  const out = {};
  if (typeof f.name === 'string' && f.name.trim()) out.name = f.name.trim();
  if (f.preferences && typeof f.preferences === 'object' && !Array.isArray(f.preferences)) {
    out.preferences = { ...f.preferences };
  }
  if (typeof f.notes === 'string' && f.notes.trim()) out.notes = f.notes.trim();
  return out;
}

export function mergeFacts(prev = {}, next = {}) {
  const merged = { ...prev };
  if (next.name) merged.name = next.name;
  if (next.notes) merged.notes = next.notes;
  if (next.preferences && typeof next.preferences === 'object') {
    merged.preferences = {
      ...(typeof merged.preferences === 'object' && merged.preferences && !Array.isArray(merged.preferences)
        ? merged.preferences
        : {}),
      ...next.preferences
    };
  }
  return merged;
}

export async function summarizeCombined(prevSummary, newTranscript) {
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
  "preferences": object | null,
  "notes": string | null
}
"preferences" es un objeto libre con pares clave-valor (presupuesto, categoría, talla, etc.).`;
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
    const jsonEnd = raw.lastIndexOf('}');
    const slice = jsonStart >= 0 && jsonEnd >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : '{}';
    const parsed = JSON.parse(slice);
    return sanitizeFacts({
      name: parsed?.name ?? null,
      preferences: parsed?.preferences ?? null,
      notes: parsed?.notes ?? null
    });
  } catch {
    return {};
  }
}

export async function summarizeIfInactive(tenantId, waId) {
  const { rows: lastRows } = await pool.query(
    `SELECT MAX(created_at) AS last_at FROM public.wa_message WHERE tenant_id = $1 AND wa_id = $2`,
    [tenantId, waId]
  );
  const lastAt = lastRows?.[0]?.last_at ? new Date(lastRows[0].last_at) : null;
  if (!lastAt) return { summarized: false };

  const now = new Date();
  if (now.getTime() - lastAt.getTime() < INACT_MIN * 60 * 1000) {
    return { summarized: false };
  }

  const prevSummaryRow = await pool.query(
    `SELECT summary, from_message_id, to_message_id, messages_count
       FROM public.wa_summary
      WHERE tenant_id = $1 AND wa_id = $2`,
    [tenantId, waId]
  );
  const prevSummary = prevSummaryRow.rows?.[0]?.summary || null;
  const prevFromId = Number(prevSummaryRow.rows?.[0]?.from_message_id || 0);
  const prevToId = Number(prevSummaryRow.rows?.[0]?.to_message_id || 0);
  const prevCount = Number(prevSummaryRow.rows?.[0]?.messages_count || 0);

  const { rows: msgRows } = await pool.query(
    `SELECT id, direction, body, created_at
       FROM public.wa_message
      WHERE tenant_id = $1 AND wa_id = $2
        AND id > $3
        AND created_at <= $4
      ORDER BY id ASC
      LIMIT $5`,
    [tenantId, waId, prevToId, lastAt, SUM_MAX_MSGS]
  );
  if (!msgRows?.length) return { summarized: false };

  const fromId = msgRows[0].id;
  const toId = msgRows[msgRows.length - 1].id;
  const count = msgRows.length;

  const transcript = buildTranscript(msgRows);

  let summaryText;
  try {
    summaryText = await summarizeCombined(prevSummary, transcript);
    if (!summaryText) summaryText = `Resumen acumulado de ${prevCount + count} mensajes (hasta id ${toId}).`;
  } catch (e) {
    console.error('summarizeCombined error:', e.message);
    return { summarized: false, error: 'ai-summary-failed' };
  }

  let facts = {};
  try {
    facts = await extractFactsWithAI(transcript);
  } catch (e) {
    console.error('extractFactsWithAI error:', e.message);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prev = await client.query(
      `SELECT facts_json FROM public.wa_profile WHERE tenant_id = $1 AND wa_id = $2 FOR UPDATE`,
      [tenantId, waId]
    );
    const prevFacts = prev.rows?.[0]?.facts_json || {};
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
      [
        tenantId,
        waId,
        summaryText,
        JSON.stringify(mergedFacts || {}),
        prevFromId || fromId,
        toId,
        count,
        MODEL
      ]
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
    return { summarized: true, fromId, toId, count };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('summarizeIfInactive tx error:', e.message);
    return { summarized: false, error: 'tx-failed' };
  } finally {
    client.release();
  }
}
