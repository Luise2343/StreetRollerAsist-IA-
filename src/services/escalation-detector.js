/**
 * @file escalation-detector.js
 * @description Detects escalation needs from AI reply and user input via regex patterns.
 * Fires notifications automatically without depending on the model's tool-calling decision.
 *
 * Usage: runEscalationChecks({ tenantId, waId, userText, aiReply, ctx })
 * This is fire-and-forget — callers should `.catch()` errors without awaiting.
 */

import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { notificationService } from './business/notification.service.js';
import { sendPushToTenant } from './push.service.js';
import { logger } from '../config/logger.js';

// Cooldown windows per severity (ms)
const COOLDOWN_MS = {
  critical: 1 * 60 * 60 * 1000,  // 1 hour
  warning: 4 * 60 * 60 * 1000,   // 4 hours
  info: 24 * 60 * 60 * 1000      // 24 hours
};

/**
 * Layer A — AI output patterns (checked against aiReply)
 * @type {Array<{ key: string, pattern: RegExp, severity: string, title: string, type: string }>}
 */
const AI_PATTERNS = [
  {
    key: 'ai_no_media',
    // Matches "no tengo imágenes/fotos/videos" or "no puedo/sé enviar/mandar/compartir fotos/imágenes/videos"
    // accent-insensitive via character classes
    pattern:
      /\bno tengo (im[áa]genes?|fotos?|videos?)\b|\bno (puedo|s[ée]) (enviar|mandar|compartir) (fotos?|im[áa]genes?|videos?)\b/i,
    severity: 'warning',
    title: '📷 IA admitió no tener fotos',
    type: 'human_takeover_requested'
  },
  {
    key: 'ai_unknown_info',
    // Matches "no tengo/manejo/dispongo de esa información/info"
    pattern: /\bno (tengo|manejo|dispongo de) esa (informaci[óo]n|info)\b/i,
    severity: 'warning',
    title: '❓ IA dijo no tener esa info',
    type: 'human_takeover_requested'
  },
  {
    key: 'ai_uncertain',
    // Matches "no estoy seguro" or "déjame consultar/verificar/revisar"
    pattern: /\bno estoy seguro\b|\bd[ée]jame (consultar|verificar|revisar)\b/i,
    severity: 'info',
    title: '🤔 IA expresó incertidumbre',
    type: 'human_takeover_requested'
  },
  {
    key: 'ai_deferred_to_human',
    // Matches "un agente/asesor ... contactará/ayudará/atenderá" or "alguien del equipo ... contactará/atenderá"
    pattern:
      /\bun (agente|asesor)\b.*(contactar[áa]|ayudar[áa]|atender[áa])|\balguien del equipo\b.*(contactar[áa]|atender[áa])/i,
    severity: 'warning',
    title: '👤 IA derivó a un asesor',
    type: 'human_takeover_requested'
  },
  {
    key: 'ai_capability_limit',
    // Matches "lamento no poder" or "no tengo acceso"
    pattern: /\blamento no poder\b|\bno tengo acceso\b/i,
    severity: 'warning',
    title: '🚧 IA mencionó limitación',
    type: 'human_takeover_requested'
  }
];

/**
 * Layer B — User input patterns (checked against userText)
 * @type {Array<{ key: string, pattern: RegExp, severity: string, title: string, type: string }>}
 */
const USER_PATTERNS = [
  {
    key: 'customer_wants_human',
    // Matches "humano/persona real/asesor/operador/alguien del equipo" in interrogative/imperative context
    pattern: /\b(humano|persona real|asesor|operador|alguien del equipo)\b/i,
    severity: 'critical',
    title: '🆘 Cliente pide hablar con humano',
    type: 'lead_escalated'
  },
  {
    key: 'customer_wants_media',
    // Matches "mándame/pásame/envíame/me mandas foto/imagen/video" or "tienes fotos/imágenes/videos"
    pattern:
      /\b(m[áa]ndame|p[áa]same|env[íi]ame|me mandas)\b.*(foto|imagen|video)|\btienes (fotos?|im[áa]genes?|videos?)\b/i,
    severity: 'warning',
    title: '📷 Cliente pide foto/video',
    type: 'human_takeover_requested'
  },
  {
    key: 'customer_complaint',
    // Matches complaint keywords
    pattern:
      /\b(reclamo|devoluci[óo]n|garant[íi]a|defectuoso|no funciona|est[áa] da[ñn]ado)\b/i,
    severity: 'critical',
    title: '⚠️ Posible reclamo',
    type: 'lead_escalated'
  },
  {
    key: 'customer_invoice',
    // Matches "factura ... a nombre de / con cuit / con nit / fiscal / empresa"
    pattern: /\bfactura\b.*(a nombre de|con cuit|con nit|fiscal|empresa)\b/i,
    severity: 'info',
    title: '🧾 Cliente pide factura fiscal',
    type: 'human_takeover_requested'
  }
];

/**
 * Check whether a trigger is within its cooldown window.
 * @param {string} triggerKey
 * @param {string} severity
 * @param {object} cooldowns - existing { [triggerKey]: ISO timestamp } map
 * @returns {boolean} true if still in cooldown (should skip)
 */
function isInCooldown(triggerKey, severity, cooldowns) {
  if (!cooldowns || !cooldowns[triggerKey]) return false;
  const lastFired = new Date(cooldowns[triggerKey]).getTime();
  if (Number.isNaN(lastFired)) return false;
  const windowMs = COOLDOWN_MS[severity] ?? COOLDOWN_MS.info;
  return Date.now() - lastFired < windowMs;
}

/**
 * Build a short snippet (max 120 chars) from text for notification body context.
 * @param {string} text
 * @returns {string}
 */
function snippet(text) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= 120 ? clean : clean.slice(0, 117) + '…';
}

/**
 * Detect escalation patterns from AI reply and user input,
 * then fire notifications for each unique trigger that is not in cooldown.
 *
 * This function is designed to be called fire-and-forget — the caller should
 * use `.catch()` and NOT await the result.
 *
 * @param {object} params
 * @param {number} params.tenantId
 * @param {string} params.waId - WhatsApp sender ID
 * @param {string|null} params.userText - incoming user message
 * @param {string|null} params.aiReply - outgoing AI reply
 * @param {object} params.ctx - conversation context (used for profileFacts)
 * @returns {Promise<void>}
 */
export async function runEscalationChecks({ tenantId, waId, userText, aiReply, ctx }) {
  if (!tenantId || !waId) return;

  const matches = [];

  // Layer A — scan aiReply
  if (aiReply) {
    for (const def of AI_PATTERNS) {
      if (def.pattern.test(aiReply)) {
        matches.push({ ...def, sourceText: aiReply });
      }
    }
  }

  // Layer B — scan userText
  if (userText) {
    for (const def of USER_PATTERNS) {
      if (def.pattern.test(userText)) {
        matches.push({ ...def, sourceText: userText });
      }
    }
  }

  if (matches.length === 0) return;

  // Dedupe by key (in case both layers somehow share a key — not in current config but defensive)
  const seen = new Set();
  const unique = [];
  for (const m of matches) {
    if (!seen.has(m.key)) {
      seen.add(m.key);
      unique.push(m);
    }
  }

  // Read current cooldowns from profile facts
  const existingCooldowns = ctx?.profileFacts?.escalation_cooldowns ?? {};
  const updatedCooldowns = { ...existingCooldowns };
  const now = new Date().toISOString();

  for (const match of unique) {
    const { key, severity, title, type, sourceText } = match;

    if (isInCooldown(key, severity, existingCooldowns)) {
      logger.info({
        action: 'escalation_cooldown_skip',
        tenantId,
        waId,
        trigger: key,
        severity
      });
      continue;
    }

    const bodyText = snippet(sourceText);

    logger.info({ action: 'escalation_detected', tenantId, waId, trigger: key, severity });

    // Fire notification (persist to DB, no push — push handled separately below)
    notificationService
      .notify(
        tenantId,
        {
          type,
          severity,
          title,
          body: bodyText,
          data: { waId, trigger: key, severity, snippet: bodyText }
        },
        false
      )
      .catch(e => logger.error({ action: 'escalation_notify_error', trigger: key, error: e.message }));

    // Fire-and-forget push
    sendPushToTenant(tenantId, {
      title,
      body: bodyText,
      data: { waId, tenantId }
    }).catch(() => {});

    // Record cooldown timestamp
    updatedCooldowns[key] = now;
  }

  // Persist updated cooldowns back to profile (only if we actually fired something)
  const firedCount = Object.keys(updatedCooldowns).filter(k => updatedCooldowns[k] !== existingCooldowns[k]).length;
  if (firedCount > 0) {
    await waProfileRepository
      .upsertProfileFact(tenantId, waId, { escalation_cooldowns: updatedCooldowns })
      .catch(e => logger.error({ action: 'escalation_cooldown_persist_error', error: e.message }));
  }
}
