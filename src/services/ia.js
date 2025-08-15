// src/services/ia.js
import OpenAI from 'openai';

const OPENAI_ENABLED = (process.env.OPENAI_ENABLED ?? 'true') !== 'false';
const OPENAI_MODEL   = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MAX_OUT = Math.max(1, parseInt(String(process.env.AI_MAX_OUTPUT_TOKENS ?? '120').trim(), 10) || 120);
const LANG = process.env.AI_LANG ?? 'es';

let openai = null;
if (OPENAI_ENABLED && process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM = `Eres un asistente de StreetRoller. Responde en ${LANG} de forma breve y clara (máx. 4 líneas).
Si te piden precios/stock y no hay dato, sugiere: "lista", "precio <producto>", "stock <producto>".
Si el usuario cambia de tema, síguele el hilo sin inventar datos.`;

/**
 * userText: texto actual del usuario
 * ctx: { turns: [{user, assistant}, ...] }
 */
export async function aiReplyStrict(userText, ctx) {
  if (!openai) return null;

  // construimos el historial breve: system + últimas N + turno actual
  const messages = [
    { role: 'system', content: SYSTEM },
    ...((ctx?.turns ?? []).flatMap(t => ([
      { role: 'user', content: t.user },
      { role: 'assistant', content: t.assistant }
    ]))),
    { role: 'user', content: String(userText || '').slice(0, 800) }
  ];

  try {
    const r = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_tokens: MAX_OUT,
      stop: ['Usuario:', 'User:', '\n\n\n']
    });
    return r.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('OpenAI error:', e?.status, e?.code || e?.message);
    return null;
  }
}
