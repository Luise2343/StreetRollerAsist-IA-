// src/routes/whatsapp.webhook.js
import { Router } from 'express';
import { getContext, pushTurn, clearSession } from '../services/context.js';
import { aiReplyWithRetry } from '../services/ia.js';
import { logIncoming, logOutgoing } from '../services/message.store.js';
import { summarizeIfInactive } from '../services/summarize.service.js';
import { rehydrateContext } from '../services/context.rehydrate.js';
import { metaSignature } from '../middleware/meta-signature.js';
import { sendWaText, markAsRead } from '../services/whatsapp.client.js';
import { resolveTenantByWaPhoneNumberId } from '../middleware/tenant.js';
import { tenantRepository } from '../repositories/tenant.repository.js';
import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { debounceMessage } from '../services/message.debounce.js';
import { logger } from '../config/logger.js';

const router = Router();

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

router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || !challenge) return res.sendStatus(403);
  try {
    const tenant = await tenantRepository.findByWaVerifyToken(String(token || ''));
    if (!tenant) return res.sendStatus(403);
    return res.status(200).send(challenge);
  } catch (e) {
    console.error('WA GET verify error:', e.message);
    return res.sendStatus(500);
  }
});

router.post('/', metaSignature('META_APP_SECRET'), async (req, res) => {
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    console.log('[WA] entries:', entries.length, JSON.stringify(req.body).slice(0, 300));
    if (!entries.length) return res.sendStatus(200);

    const change = entries[0]?.changes?.[0];
    if (!change || change.field !== 'messages') {
      console.log('[WA] skip: field=', change?.field);
      return res.sendStatus(200);
    }

    const value = change.value || {};
    const metadata = value.metadata || {};
    const phoneNumberId = metadata.phone_number_id;
    console.log('[WA] phoneNumberId:', phoneNumberId);

    if (Array.isArray(value.statuses) && value.statuses.length) {
      console.log('[WA] skip: status update');
      return res.sendStatus(200);
    }

    const tenant = phoneNumberId ? await resolveTenantByWaPhoneNumberId(phoneNumberId) : null;
    console.log('[WA] tenant:', tenant?.id, 'hasToken:', !!tenant?.wa_token);
    if (!tenant?.wa_token || !tenant?.wa_phone_number_id) {
      return res.sendStatus(200);
    }

    const messages = Array.isArray(value.messages) ? value.messages : [];
    console.log('[WA] messages:', messages.length);
    if (!messages.length) return res.sendStatus(200);

    for (const msg of messages) {
      const textBody = msg?.text?.body;
      if (msg?.type !== 'text' || !textBody) continue;

      if (!remember(msg.id)) continue;

      await markAsRead(tenant, msg.id);

      const from = msg.from;
      const tenantId = tenant.id;

      const text = await debounceMessage(tenantId, from, textBody);
      if (text === null) continue; // absorbed into a batch already being processed

      // Capture referral data from Meta Ads if present
      if (msg.referral?.source_id) {
        try {
          await waProfileRepository.upsertProfileFact(tenantId, from, {
            referral: {
              ad_id: msg.referral.source_id,
              headline: msg.referral.headline || null,
              body: msg.referral.body || null,
              captured_at: new Date().toISOString()
            }
          });
          logger.info({ action: 'referral_captured', tenantId, from, ad_id: msg.referral.source_id });
        } catch (e) {
          logger.error({ action: 'referral_save_error', tenantId, from, message: e.message });
        }
      }

      try {
        await summarizeIfInactive(tenantId, from);
      } catch (e) {
        console.error('summarizeIfInactive error:', e.message);
      }

      const ctxRam = getContext(tenantId, from);

      let summary = null;
      let profileFacts = null;
      let dbTurns = [];
      try {
        const hyr = await rehydrateContext(tenantId, from);
        summary = hyr?.summary || null;
        profileFacts = hyr?.profileFacts || null;
        dbTurns = hyr?.turns || [];
        if (hyr?.hadHumanIntervention) {
          profileFacts = {
            ...(profileFacts || {}),
            _human_note: 'Un agente humano intervino recientemente en esta conversación. Retoma el hilo desde el último mensaje del cliente y continúa el flujo de venta normalmente.'
          };
        }
      } catch (e) {
        console.error('rehydrateContext error:', e.message);
      }

      const ctx = {
        turns: ctxRam?.turns?.length ? ctxRam.turns : dbTurns,
        summary,
        profileFacts
      };

      await logIncoming({
        tenantId,
        waId: from,
        providerMsgId: msg.id,
        body: text,
        msgType: 'text',
        meta: { meta_type: msg.type, timestamp: msg.timestamp }
      });

      console.log('WA IN', { tenantId, from, text: text.slice(0, 80) });

      if (/^(reset|reiniciar|nuevo)$/i.test(text.trim())) {
        clearSession(tenantId, from);
        const reply = 'Conversacion reiniciada.';
        await sendWaText(tenant, from, reply);
        await logOutgoing({
          tenantId,
          waId: from,
          providerMsgId: null,
          body: reply,
          msgType: 'text',
          meta: { reason: 'reset' }
        });
        continue;
      }

      const inTakeover = await waProfileRepository.isTakeover(tenantId, from);
      if (inTakeover) {
        logger.info({ action: 'takeover_skip', tenantId, from });
        continue;
      }

      const { reply: aiReply, failed } = await aiReplyWithRetry(text, ctx, tenant, from);
      const replySource = aiReply ? 'ai' : 'fallback';
      let reply = aiReply;

      if (failed) {
        const ownerPhone = process.env.OWNER_PHONE || '50373130634';
        const ownerTenant = tenant;
        await sendWaText(ownerTenant, ownerPhone,
          `⚠️ El agente falló tras reintentos.\nCliente: +${from}\nÚltimo mensaje: "${text}"\nRevisa y responde manualmente.`
        ).catch(() => {});
        reply = 'Disculpa, estoy teniendo un problema técnico en este momento. Un agente te contactará pronto. 🙏';
      }

      const outId = await sendWaText(tenant, from, reply);

      await logOutgoing({
        tenantId,
        waId: from,
        providerMsgId: outId,
        body: reply,
        msgType: 'text',
        meta: { source: replySource }
      });

      pushTurn(tenantId, from, text, reply);
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error('Webhook POST error:', e);
    return res.sendStatus(200);
  }
});

export default router;
