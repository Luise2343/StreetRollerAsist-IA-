// Debounce incoming messages per (tenantId, waId).
// Accumulates texts for DEBOUNCE_MS and resolves with all of them joined.

const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || '10000', 10);

// key: `${tenantId}:${waId}` → { timer, texts, resolve }
const pending = new Map();

/**
 * @param {number} tenantId
 * @param {string} waId
 * @param {string} text
 * @returns {Promise<string|null>} joined text when debounce fires, or null if
 *   this call was absorbed into an already-pending batch (caller should skip).
 */
export function debounceMessage(tenantId, waId, text) {
  const key = `${tenantId}:${waId}`;

  if (pending.has(key)) {
    const entry = pending.get(key);
    entry.texts.push(text);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flush(key), DEBOUNCE_MS);
    // Return a promise that resolves when the batch fires
    return new Promise((resolve) => entry.waiters.push(resolve));
  }

  // First message in the batch — create entry and return a promise
  return new Promise((resolve) => {
    const entry = {
      texts: [text],
      waiters: [resolve],
      timer: setTimeout(() => flush(key), DEBOUNCE_MS)
    };
    pending.set(key, entry);
  });
}

function flush(key) {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);

  const joined = entry.texts.join('\n');
  // Resolve the first waiter with the full text; the rest get null (skip)
  entry.waiters[0](joined);
  for (let i = 1; i < entry.waiters.length; i++) {
    entry.waiters[i](null);
  }
}
