import { Router } from 'express';
const router = Router();

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

// POST: leer mensaje entrante y loguearlo
// POST: leer mensaje y responder texto fijo
router.post('/', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const from = msg.from;                     // número E.164
        const text = msg.text?.body ?? '';
        console.log('WA IN ⬇️', { from, text, type: msg.type });

        // --- responder por WhatsApp ---
        const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const body = {
          messaging_product: 'whatsapp',
          to: from,
          text: { body: `👋 Hola! Recibí: ${text || '(vacío)'}` }
        };

        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const data = await r.json().catch(() => ({}));
        if (!r.ok) console.error('WA OUT ❌', r.status, data);
        else       console.log('WA OUT ✅', data);
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
