// src/services/context.js
const SESSIONS = new Map();

const MAX_TURNS = Number(process.env.CTX_TURNS ?? 6);
const TTL_MIN = Number(process.env.CTX_TTL_MIN ?? 120);

function sessionKey(tenantId, waId) {
  return `${tenantId}:${waId}`;
}

function ensure(tenantId, waId) {
  const key = sessionKey(tenantId, waId);
  let s = SESSIONS.get(key);
  const now = Date.now();
  if (!s || now - s.updatedAt > TTL_MIN * 60_000) {
    s = { turns: [], updatedAt: now };
    SESSIONS.set(key, s);
  }
  s.updatedAt = now;
  return s;
}

export function getContext(tenantId, waId) {
  return ensure(tenantId, waId);
}

export function pushTurn(tenantId, waId, userText, assistantText) {
  const s = ensure(tenantId, waId);
  s.turns.push({ user: String(userText || ''), assistant: String(assistantText || '') });
  if (s.turns.length > MAX_TURNS) s.turns = s.turns.slice(-MAX_TURNS);
}

export function clearSession(tenantId, waId) {
  SESSIONS.delete(sessionKey(tenantId, waId));
}
