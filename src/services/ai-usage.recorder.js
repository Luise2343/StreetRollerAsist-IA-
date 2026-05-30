// src/services/ai-usage.recorder.js
// Helper único para registrar el consumo de una respuesta de OpenAI:
// calcula el costo, lo suma al cache de presupuesto y lo persiste (fire-and-forget).
import { computeCost } from './ai-pricing.js';
import { aiUsageRepository } from '../repositories/ai-usage.repository.js';
import { addToCache } from './ai-budget.js';

/**
 * @param {{ model?: string, usage?: object } | null} completion  respuesta de chat.completions.create
 * @param {{ tenantId: number, waId?: string|null, purpose?: string }} meta
 */
export function recordCompletionUsage(completion, { tenantId, waId = null, purpose = 'agent' } = {}) {
  try {
    if (!tenantId || !completion?.usage) return;
    const model = completion.model || 'unknown';
    const c = computeCost(model, completion.usage);
    addToCache(tenantId, c.costUsd);
    aiUsageRepository.record({
      tenantId,
      waId,
      model,
      purpose,
      promptTokens: c.promptTokens,
      cachedTokens: c.cachedTokens,
      completionTokens: c.completionTokens,
      totalTokens: c.totalTokens,
      costUsd: c.costUsd
    });
  } catch {
    /* nunca debe romper el flujo de respuesta */
  }
}
