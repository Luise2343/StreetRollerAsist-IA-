// src/services/message.store.js
import { pool } from '../config/db.js';

export async function logIncoming({
  tenantId,
  waId,
  providerMsgId,
  body,
  msgType = 'text',
  meta = {}
}) {
  try {
    await pool.query(
      `INSERT INTO public.wa_message
         (tenant_id, wa_id, direction, provider_msg_id, body, msg_type, meta)
       VALUES ($1,$2,'in',$3,$4,$5,$6::jsonb)
       ON CONFLICT (provider_msg_id) DO NOTHING`,
      [tenantId, waId, providerMsgId || null, String(body ?? ''), msgType, JSON.stringify(meta)]
    );
  } catch (e) {
    console.error('logIncoming error', e.message);
  }
}

export async function logOutgoing({
  tenantId,
  waId,
  providerMsgId,
  body,
  msgType = 'text',
  meta = {}
}) {
  try {
    await pool.query(
      `INSERT INTO public.wa_message
         (tenant_id, wa_id, direction, provider_msg_id, body, msg_type, meta)
       VALUES ($1,$2,'out',$3,$4,$5,$6::jsonb)
       ON CONFLICT (provider_msg_id) DO NOTHING`,
      [tenantId, waId, providerMsgId || null, String(body ?? ''), msgType, JSON.stringify(meta)]
    );
  } catch (e) {
    console.error('logOutgoing error', e.message);
  }
}
