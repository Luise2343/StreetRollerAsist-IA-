// src/services/ai-params.js
// Compatibilidad de parámetros entre familias de modelos OpenAI.
// La familia GPT-5 y los modelos de razonamiento (o1/o3/o4) usan
// `max_completion_tokens` y RECHAZAN `max_tokens`.

/**
 * Devuelve el parámetro correcto de tope de salida según el modelo.
 * @param {string} model
 * @param {number} n  máximo de tokens de salida
 * @returns {{ max_tokens: number } | { max_completion_tokens: number }}
 */
export function maxTokensParam(model, n) {
  const id = String(model || '').toLowerCase();
  if (
    id.startsWith('gpt-5') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4')
  ) {
    return { max_completion_tokens: n };
  }
  return { max_tokens: n };
}
