// src/routes/whatsaap.webhook.js
import { Router } from 'express';
import { getContext, pushTurn, clearSession } from '../services/context.js';
import { aiReplyStrict } from '../services/ia.js';
// import crypto from 'crypto'; // ⟵ eliminado: no validamos firma
import { logIncoming, logOutgoing } from '../services/message.store.js';
import { summarizeIfInactive } from '../services/summarize.service.js';
import { rehydrateContext } from '../services/context.rehydrate.js';

const router = Router();

// dedupe muy simple (memoria, con recorte de tamaño)
const seen = new Set();
function remember(id) {
  if (!id) return false;
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 2000) {
    const it = seen.values();
    for (let i = 0; i < 1000; i++) seen.delete(it.next().value);
  }
  return true;
}

async function sendWaText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, text: { body } })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('WA OUT ❌', res.status, data); else console.log('WA OUT ✅', data);
}

async function markAsRead(messageId) {
  if (!messageId) return;
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
  }).catch(() => {});
}

// GET verificación (Meta callback)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ⚠️ SIN validación de firma (eliminado isMetaSignatureValid)

// POST: recibir mensaje y responder
router.post('/', async (req, res) => {
  try {
    // 1) Forma estándar del payload
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    if (!entries.length) return res.sendStatus(200);

    const change = entries[0]?.changes?.[0];
    if (!change || change.field !== 'messages') return res.sendStatus(200);

    const value = change.value || {};

    // 2) Ignora eventos que NO son mensajes (statuses, acks, template updates, etc.)
    if (Array.isArray(value.statuses) && value.statuses.length) {
      return res.sendStatus(200);
    }

    // 3) Toma solo mensajes reales
    const messages = Array.isArray(value.messages) ? value.messages : [];
    if (!messages.length) return res.sendStatus(200);

    for (const msg of messages) {
      // SOLO texto del usuario (ignoramos botones/listas/audio/imágenes/etc.)
      const textBody = msg?.text?.body;
      if (msg?.type !== 'text' || !textBody) continue;

      // dedupe por id
      if (!remember(msg.id)) continue;

      await markAsRead(msg.id);

      const from = msg.from;
      const text = textBody;

      // 0) si hubo inactividad, resumimos (no debe romper el flujo)
      try {
        await summarizeIfInactive(from);
      } catch (e) {
        console.error('summarizeIfInactive error:', e.message);
      }

      // 1) RAM (turnos recientes)
      const ctxRam = await getContext(from);

      // 2) DB (resumen + facts)
      let summary = null, profileFacts = null, dbTurns = [];
      try {
        const hyr = await rehydrateContext(from);
        summary      = hyr?.summary || null;
        profileFacts = hyr?.profileFacts || null;
        dbTurns      = hyr?.turns || [];
      } catch (e) {
        console.error('rehydrateContext error:', e.message);
      }

      // 3) Construye el ctx
      const ctx = {
        turns: (ctxRam?.turns?.length ? ctxRam.turns : dbTurns),
        summary,
        profileFacts
      };

      console.log('CTX listo →', {
        hasSummary: !!summary,
        hasFacts: !!profileFacts,
        turnsFrom: (ctxRam?.turns?.length ? 'ram' : 'db'),
        turns: (ctxRam?.turns?.length ? ctxRam.turns.length : dbTurns.length)
      });

      // Guarda el entrante
      await logIncoming({
        waId: from,
        providerMsgId: msg.id,
        body: text,
        msgType: 'text',
        meta: { meta_type: msg.type, timestamp: msg.timestamp }
      });

      console.log('WA IN ⬇️', { from, text, type: msg.type });

      if (/^(reset|reiniciar|nuevo)$/i.test(text.trim())) {
        clearSession(from);
        const reply = 'Conversación reiniciada ✅';
        await sendWaText(from, reply);
        await logOutgoing({
          waId: from,
          providerMsgId: null,
          body: reply,
          msgType: 'text',
          meta: { reason: 'reset' }
        });
        continue;
      }

      // IA responde (ella decide si llama a la DB o no)
      let replySource = 'ai';
      let reply = await aiReplyStrict(text, ctx);

      if (!reply) {
        reply = "Lo siento, no entendí tu mensaje. ¿Quieres que te muestre productos disponibles?";
        replySource = 'fallback';
      }

      // enviar por WhatsApp
      const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      const body = {
        messaging_product: 'whatsapp',
        to: from,
        text: { body: reply }
      };
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const data = await r.json().catch(() => ({}));
      const outId = data?.messages?.[0]?.id || null;
      await logOutgoing({
        waId: from,
        providerMsgId: outId,
        body: reply,
        msgType: 'text',
        meta: { source: replySource, httpStatus: r.status }
      });

      if (!r.ok) console.error('WA OUT ❌', r.status, data);
      else       console.log('WA OUT ✅', data);

      pushTurn(from, text, reply);
    }

    return res.sendStatus(200); // WhatsApp requiere 200 rápido
  } catch (e) {
    console.error('Webhook POST error:', e);
    return res.sendStatus(200);
  }
});

export default router;
