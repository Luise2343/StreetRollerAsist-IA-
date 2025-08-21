// src/services/context.js
const SESSIONS = new Map();

const MAX_TURNS = Number(process.env.CTX_TURNS ?? 6);
const TTL_MIN   = Number(process.env.CTX_TTL_MIN ?? 120);

function ensure(waId) {
  let s = SESSIONS.get(waId);
  const now = Date.now();
  if (!s || (now - s.updatedAt) > TTL_MIN * 60_000) {
    s = { turns: [], updatedAt: now }; // turns: [{user, assistant}]
    SESSIONS.set(waId, s);
  }
  s.updatedAt = now;
  return s;
}

export function getContext(waId) {
  return ensure(waId);
}

export function pushTurn(waId, userText, assistantText) {
  const s = ensure(waId);
  s.turns.push({ user: String(userText || ''), assistant: String(assistantText || '') });
  // conserva solo las últimas N interacciones
  if (s.turns.length > MAX_TURNS) s.turns = s.turns.slice(-MAX_TURNS);
}

export function clearSession(waId) {
  SESSIONS.delete(waId);
}
