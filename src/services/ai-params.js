// src/services/ai-params.js
// Compatibilidad de parámetros entre familias de modelos OpenAI.
// La familia GPT-5 y los modelos de razonamiento (o1/o3/o4) usan
// `max_completion_tokens` y RECHAZAN `max_tokens`.

// Los modelos de razonamiento (gpt-5, o1/o3/o4) consumen tokens de "reasoning"
// ANTES de emitir texto visible. Si max_completion_tokens es muy bajo, el
// razonamiento se come todo el presupuesto y el modelo devuelve content vacío
// (finish_reason=length). Observado: gpt-5-mini usa ~256 reasoning tokens incluso
// en respuestas cortas. Reservamos headroom para que SIEMPRE quede espacio de salida.
const REASONING_HEADROOM = Number(process.env.AI_REASONING_HEADROOM || 512);
// 'minimal' = casi sin razonamiento → respuestas cortas, rápidas (~2.5s) y baratas,
// ideal para un bot de ventas por WhatsApp. El default de gpt-5 ('medium') quema
// 500+ tokens de razonamiento, lo que produce respuestas VACÍAS con topes bajos y
// latencias de 12-22s. Configurable por si se quiere subir a 'low'/'medium'.
const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || 'minimal';

function isReasoningModel(id) {
  return (
    id.startsWith('gpt-5') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')
  );
}

/**
 * Devuelve los parámetros de modelo correctos según la familia.
 * - Modelos de razonamiento (gpt-5, o1/o3/o4): `max_completion_tokens` con headroom
 *   para los tokens de reasoning + `reasoning_effort` bajo para no devolver vacío.
 * - Resto: `max_tokens`.
 * Se usa con spread: `...maxTokensParam(model, n)`.
 * @param {string} model
 * @param {number} n  máximo de tokens de salida visible deseado
 */
export function maxTokensParam(model, n) {
  const id = String(model || '').toLowerCase();
  const want = Number(n) || 0;
  if (isReasoningModel(id)) {
    return {
      max_completion_tokens: want + REASONING_HEADROOM,
      reasoning_effort: REASONING_EFFORT
    };
  }
  return { max_tokens: want };
}
