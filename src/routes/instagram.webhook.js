// src/routes/instagram.webhook.js
import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// --- Firma de Meta (opcional pero recomendado)
function isMetaSignatureValid(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // si no hay secret, no bloquear (parche)
  const signature = req.get('X-Hub-Signature-256') || '';
  const payload = req.rawBody || Buffer.from(JSON.stringify(req.body), 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  // tiempo-constante
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// --- GET /webhooks/instagram (verificación)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.IG_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- POST /webhooks/instagram (recepción)
router.post('/', async (req, res) => {
  try {
    if (process.env.META_APP_SECRET && !isMetaSignatureValid(req)) {
      return res.sendStatus(403);
    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    if (!entries.length) return res.sendStatus(200);

    // IG puede llegar en distintos “shapes”; filtramos SOLO mensajes de texto
    let handled = false;

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        const value = ch?.value || {};
        const msgs = value?.messages || value?.messaging || []; // distintos nombres según producto
        if (!Array.isArray(msgs) || !msgs.length) continue;

        for (const m of msgs) {
          // normalizamos: IG suele tener m.from, m.text?.body
          const txt = m?.text?.body;
          if (!txt) continue; // ignorar no-texto

          // TODO: aquí llamarías a tu orquestador IA (igual que en WhatsApp),
          // pero por ahora solo dejamos ACK y log.
          console.log('IG IN ⬇️', { from: m.from || m.sender?.id, text: txt, type: 'text' });

          // Si quisieras responder aquí, necesitarás:
          //   - process.env.IG_ACCESS_TOKEN
          //   - process.env.IG_USER_ID (business IG user id)
          // y POST a https://graph.facebook.com/vXX.X/{IG_USER_ID}/messages
          handled = true;
        }
      }
    }

    if (!handled) {
      // ignoramos statuses/entregas/otros eventos
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('IG webhook error', err);
    return res.sendStatus(200); // no provocar reintentos con 5xx
  }
});

export default router;
