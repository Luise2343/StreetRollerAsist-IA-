// src/services/ai-pricing.js
// Tabla de precios de modelos OpenAI (USD por 1,000,000 de tokens) y cálculo
// del costo de una respuesta a partir del objeto `usage` que devuelve la API.
//
// Mantener actualizada con https://openai.com/api/pricing/ cuando cambien tarifas.

/** @typedef {{ input: number, cached: number, output: number }} Price */

/** Precios por 1M de tokens. La clave hace match por PREFIJO del id del modelo. */
const PRICING = {
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.0 },
  'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4 },
  'gpt-5': { input: 1.25, cached: 0.125, output: 10.0 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cached: 0.025, output: 0.4 },
  'gpt-4.1': { input: 2.0, cached: 0.5, output: 8.0 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10.0 }
};

// Modelo cuyo precio se usa si no hay match (conservador: el más usado hoy).
const FALLBACK_PRICE_KEY = 'gpt-4o-mini';

/**
 * Resuelve el precio de un modelo por prefijo (cubre ids con fecha,
 * p.ej. "gpt-4o-mini-2024-07-18" o "gpt-5-mini-2025-08-07").
 * @param {string} model
 * @returns {Price}
 */
export function priceForModel(model) {
  const id = String(model || '').toLowerCase();
  // match por prefijo más largo primero para evitar que "gpt-5" capture "gpt-5-mini"
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (id.startsWith(k)) return PRICING[k];
  }
  return PRICING[FALLBACK_PRICE_KEY];
}

/**
 * Calcula el costo en USD de una respuesta de la API a partir de `usage`.
 * Descuenta del input los tokens cacheados (que se cobran más barato).
 * @param {string} model
 * @param {{ prompt_tokens?: number, completion_tokens?: number,
 *           prompt_tokens_details?: { cached_tokens?: number } }} usage
 * @returns {{ costUsd: number, promptTokens: number, cachedTokens: number,
 *             completionTokens: number, totalTokens: number }}
 */
export function computeCost(model, usage = {}) {
  const price = priceForModel(model);
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const cachedTokens = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const freshInput = Math.max(0, promptTokens - cachedTokens);

  const costUsd =
    (freshInput * price.input +
      cachedTokens * price.cached +
      completionTokens * price.output) /
    1_000_000;

  return {
    costUsd,
    promptTokens,
    cachedTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}
