import { Router } from 'express';
import { pool } from '../config/db.js';
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


// GET verificación (ya lo tienes)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

async function replyFromDB(text) {
  const t = (text || '').trim().toLowerCase();

  // 1) lista → 5 productos recientes
  if (t.startsWith('lista')) {
    const { rows } = await pool.query(`
      SELECT name, base_price, currency
      FROM product
      WHERE active = true
      ORDER BY id DESC
      LIMIT 5
    `);
    if (!rows.length) return 'No hay productos aún.';
    const lines = rows.map(r => `• ${r.name} — ${r.base_price} ${r.currency}`);
    return `Top productos:\n${lines.join('\n')}\n\nPide "precio <nombre>" o "stock <nombre>".`;
  }

  // 2) precio <texto>
  const mPrecio = t.match(/^precio\s+(.+)/);
  if (mPrecio) {
    const q = `%${mPrecio[1]}%`;
    const { rows } = await pool.query(`
      SELECT name, base_price, currency
      FROM product
      WHERE LOWER(name) LIKE LOWER($1)
      ORDER BY id DESC
      LIMIT 1
    `, [q]);
    if (!rows.length) return 'No encontré ese producto.';
    const p = rows[0];
    return `Precio de ${p.name}: ${p.base_price} ${p.currency}`;
  }

  // 3) stock <texto>
  const mStock = t.match(/^stock\s+(.+)/);
  if (mStock) {
    const q = `%${mStock[1]}%`;
    const { rows } = await pool.query(`
      SELECT p.name, COALESCE(i.qty_on_hand,0) AS qty
      FROM product p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE LOWER(p.name) LIKE LOWER($1)
      ORDER BY p.id DESC
      LIMIT 1
    `, [q]);
    if (!rows.length) return 'No encontré ese producto.';
    const r = rows[0];
    return `Stock de ${r.name}: ${r.qty} unidades.`;
  }

  // nada matcheó → que responda el fallback/IA
  return null;
}

function isMetaSignatureValid(req) {
  try {
    const signature = req.get('X-Hub-Signature-256'); // formato: sha256=HEX
    if (!signature || !req.rawBody) return false;

    const expected = 'sha256=' + crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

    // comparación “tiempo-constante”
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// POST: leer mensaje y responder texto fijo
router.post('/', async (req, res) => {
  // rechaza si la firma no coincide
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
        // ignora no-text y duplicados
        if (msg.type !== 'text') continue;
        if (seen.has(msg.id)) continue;
        remember(msg.id);

        // marca como leído (mejor UX)
        await markAsRead(msg.id);
        const from = msg.from;
        const text = msg.text?.body ?? '';
        // 0) si hubo inactividad, resumimos el bloque anterior y lo depuramos
          try {
            await summarizeIfInactive(from);
          } catch (e) {
            console.error('summarizeIfInactive error:', e.message);
          }
         const ctxRam = await getContext(from);
          let ctx = ctxRam;
          if (!ctxRam?.turns?.length) {
            try {
              const hyr = await rehydrateContext(from);
              // ctx para la IA = turns rehidratados + summary (sin tocar aún la RAM)
              ctx = { turns: hyr.turns || [], summary: hyr.summary || null, profileFacts: hyr.profileFacts || null };
            } catch (e) {
              console.error('rehydrateContext error:', e.message);
            }
          }
        // Guarda el entrante
          await logIncoming({
            waId: from,
            providerMsgId: msg.id,         // id de Meta del mensaje entrante
            body: text,
            msgType: 'text',
            meta: { meta_type: msg.type, timestamp: msg.timestamp }
          });


        console.log('WA IN ⬇️', { from, text, type: msg.type });
        if (/^(reset|reiniciar|nuevo)$/i.test(text.trim())) {
          clearSession(from);
          const reply = 'Conversación reiniciada ✅';
          await sendWaText(from, reply); // usa tu misma lógica de envío
          await logOutgoing({
            waId: from,
            providerMsgId: null,   // la función sendWaText no devuelve el id; está ok dejarlo en null
            body: reply,
            msgType: 'text',
            meta: { reason: 'reset' }
          });
          continue;
          }    
           // 1) IA primero
            let replySource = 'ai';
            let reply = await aiReplyStrict(text, ctx);

            // 2) Si IA falla (null), intenta con la BD
            if (!reply) {
              reply = await replyFromDB(text);
              replySource = reply ? 'db' : replySource;
            }

            // 3) Si tampoco hay respuesta, mensaje guía ultra-corto
            if (!reply) {
              reply = 'Puedo ayudarte con precios y stock. Escribe "lista", "precio <producto>" o "stock <producto>".';
              replySource = 'guide';
            }

        // 2) enviar por WhatsApp
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
          providerMsgId: outId,        // id de Meta del mensaje enviado (si viene)
          body: reply,
          msgType: 'text',
          meta: { source: replySource, httpStatus: r.status }
        });

        if (!r.ok) console.error('WA OUT ❌', r.status, data);
        else       console.log('WA OUT ✅', data);
        pushTurn(from, text, reply);
  }
    }

    // WhatsApp requiere 200 rápido
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook POST error:', e);
    res.sendStatus(200);
  }
});


export default router;
