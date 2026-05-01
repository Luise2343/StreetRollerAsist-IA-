// Per-conversation SSE clients: Map<waId, Set<Response>>
const convClients = new Map();

// Global clients (notified on any conversation activity)
const globalClients = new Set();

export function subscribeConv(waId, res) {
  if (!convClients.has(waId)) convClients.set(waId, new Set());
  convClients.get(waId).add(res);
}

export function unsubscribeConv(waId, res) {
  convClients.get(waId)?.delete(res);
  if (convClients.get(waId)?.size === 0) convClients.delete(waId);
}

export function subscribeGlobal(res) {
  globalClients.add(res);
}

export function unsubscribeGlobal(res) {
  globalClients.delete(res);
}

export function emit(waId, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  convClients.get(waId)?.forEach(res => {
    try { res.write(payload); } catch {}
  });

  const globalPayload = `data: ${JSON.stringify({ ...event, waId })}\n\n`;
  globalClients.forEach(res => {
    try { res.write(globalPayload); } catch {}
  });
}
