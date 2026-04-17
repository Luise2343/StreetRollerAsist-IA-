// src/services/whatsapp.client.js
// WhatsApp Cloud API — credentials come from tenant row.

const WA_API_VERSION = 'v20.0';

function baseUrl(tenant) {
  const id = tenant?.wa_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  return `https://graph.facebook.com/${WA_API_VERSION}/${id}`;
}

function headers(tenant) {
  const token = tenant?.wa_token || process.env.WHATSAPP_TOKEN;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

export async function sendWaText(tenant, to, body) {
  const url = `${baseUrl(tenant)}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(tenant),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      text: { body }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('WA OUT error', res.status, data);
    return null;
  }
  console.log('WA OUT ok', data?.messages?.[0]?.id);
  return data?.messages?.[0]?.id || null;
}

export async function markAsRead(tenant, messageId) {
  if (!messageId) return;
  const url = `${baseUrl(tenant)}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: headers(tenant),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    })
  }).catch(err => console.error('markAsRead error', err.message));
}
