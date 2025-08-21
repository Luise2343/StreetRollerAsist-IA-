// src/services/message.store.js
import { pool } from '../config/db.js';

/**
 * Inserta un mensaje entrante
 * @param {object} p
 * @param {string} p.waId
 * @param {string|null} p.providerMsgId
 * @param {string} p.body
 * @param {string} [p.msgType='text']
 * @param {object} [p.meta]
 */
export async function logIncoming({ waId, providerMsgId, body, msgType = 'text', meta = {} }) {
  try {
    await pool.query(
      `INSERT INTO public.wa_message
         (wa_id, direction, provider_msg_id, body, msg_type, meta)
       VALUES ($1,'in',$2,$3,$4,$5::jsonb)
       ON CONFLICT (provider_msg_id) DO NOTHING`,
      [waId, providerMsgId || null, String(body ?? ''), msgType, JSON.stringify(meta)]
    );
  } catch (e) {
    console.error('logIncoming error', e.message);
  }
}

/**
 * Inserta un mensaje saliente
 */
export async function logOutgoing({ waId, providerMsgId, body, msgType = 'text', meta = {} }) {
  try {
    await pool.query(
      `INSERT INTO public.wa_message
         (wa_id, direction, provider_msg_id, body, msg_type, meta)
       VALUES ($1,'out',$2,$3,$4,$5::jsonb)
       ON CONFLICT (provider_msg_id) DO NOTHING`,
      [waId, providerMsgId || null, String(body ?? ''), msgType, JSON.stringify(meta)]
    );
  } catch (e) {
    console.error('logOutgoing error', e.message);
  }
}
