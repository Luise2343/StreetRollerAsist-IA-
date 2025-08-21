import { Router } from 'express';
import { getContext, pushTurn, clearSession } from '../services/context.js';
import { aiReplyStrict } from '../services/ia.js';
import crypto from 'crypto';
import { logIncoming, logOutgoing } from '../services/message.store.js';
import { summarizeIfInactive } from '../services/summarize.service.js';
import { rehydrateContext } from '../services/context.rehydrate.js';

const router = Router();

// dedupe muy simple (memoria, con recorte de tamaño)
const seen = new Set();
function remember(id) {
  seen.add(id);
  if (seen.size > 2000) {
    // recorta para no crecer sin límite
    const it = seen.values(); for (let i = 0; i < 1000; i++) seen.delete(it.next().value);
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

function isMetaSignatureValid(req) {
  try {
    const signature = req.get('X-Hub-Signature-256'); // formato: sha256=HEX
    if (!signature || !req.rawBody) return false;

    const expected = 'sha256=' + crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// POST: recibir mensaje y responder
router.post('/', async (req, res) => {
  if (!isMetaSignatureValid(req)) {
    return res.sendStatus(403);
  }
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.type !== 'text') continue;
        if (seen.has(msg.id)) continue;
        remember(msg.id);

        await markAsRead(msg.id);
        const from = msg.from;
        const text = msg.text?.body ?? '';

        // 0) si hubo inactividad, resumimos
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
    }

    res.sendStatus(200); // WhatsApp requiere 200 rápido
  } catch (e) {
    console.error('Webhook POST error:', e);
    res.sendStatus(200);
  }
});

export default router;
