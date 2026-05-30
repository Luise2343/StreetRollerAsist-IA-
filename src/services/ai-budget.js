// src/services/ai-budget.js
// Control del tope mensual de gasto en IA por tenant.
// Estrategia (elegida): al llegar al tope, DEGRADA al modelo económico y avisa
// al dueño por push. El bot nunca deja de responder.
import { aiUsageRepository } from '../repositories/ai-usage.repository.js';
import { sendPushToTenant } from './push.service.js';
import { logger } from '../config/logger.js';

export const AI_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD || 5);
export const AI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || 'gpt-4o-mini';
const CACHE_TTL_MS = Number(process.env.AI_BUDGET_CACHE_SEC || 60) * 1000;

// Costo mensual cacheado por tenant para no consultar la DB en cada mensaje.
const costCache = new Map(); // tenantId -> { cost, monthKey, fetchedAt }
// Umbrales ya notificados este mes por tenant.
const alertState = new Map(); // tenantId -> { monthKey, levels:Set<number> }

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

async function getMonthlyCost(tenantId) {
  const now = new Date();
  const mk = monthKey(now);
  const cached = costCache.get(tenantId);
  if (cached && cached.monthKey === mk && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.cost;
  }
  let cost;
  try {
    cost = await aiUsageRepository.monthlyCostUSD(tenantId, now);
  } catch {
    cost = cached?.cost ?? 0;
  }
  costCache.set(tenantId, { cost, monthKey: mk, fetchedAt: Date.now() });
  return cost;
}

/**
 * Suma un costo recién registrado al valor cacheado, para que mensajes
 * consecutivos dentro del TTL no subestimen el gasto acumulado.
 */
export function addToCache(tenantId, deltaUsd) {
  const mk = monthKey();
  const cached = costCache.get(tenantId);
  if (cached && cached.monthKey === mk) cached.cost += Number(deltaUsd || 0);
}

async function maybeAlert(tenantId, cost) {
  const mk = monthKey();
  let st = alertState.get(tenantId);
  if (!st || st.monthKey !== mk) {
    st = { monthKey: mk, levels: new Set() };
    alertState.set(tenantId, st);
  }
  const pct = AI_BUDGET_USD > 0 ? cost / AI_BUDGET_USD : 0;
  const level = pct >= 1 ? 100 : pct >= 0.8 ? 80 : 0;
  if (!level || st.levels.has(level)) return;
  st.levels.add(level);

  const body =
    level >= 100
      ? `Gasto de IA alcanzó $${cost.toFixed(2)} (tope $${AI_BUDGET_USD.toFixed(2)}). ` +
        `El agente cambió al modelo económico (${AI_FALLBACK_MODEL}).`
      : `Gasto de IA al ${level}%: $${cost.toFixed(2)} de $${AI_BUDGET_USD.toFixed(2)} este mes.`;

  sendPushToTenant(tenantId, {
    title: 'Presupuesto IA',
    body,
    data: { type: 'ai_budget', pct: level }
  }).catch(e => logger.warn({ err: e.message }, 'ai budget push failed'));

  logger.warn({ tenantId, cost, budget: AI_BUDGET_USD, level }, 'ai budget threshold crossed');
}

/**
 * Decide qué modelo usar según el gasto del mes.
 * @param {number} tenantId
 * @param {string} preferredModel  modelo deseado (p.ej. gpt-5-mini)
 * @returns {Promise<{ model: string, degraded: boolean, monthlyCost: number,
 *                     budget: number, pct: number }>}
 */
export async function resolveModel(tenantId, preferredModel) {
  let cost;
  try {
    cost = await getMonthlyCost(tenantId);
  } catch {
    cost = 0;
  }
  maybeAlert(tenantId, cost).catch(() => {});

  const overBudget = AI_BUDGET_USD > 0 && cost >= AI_BUDGET_USD;
  const model =
    overBudget && preferredModel !== AI_FALLBACK_MODEL ? AI_FALLBACK_MODEL : preferredModel;

  return {
    model,
    degraded: overBudget,
    monthlyCost: cost,
    budget: AI_BUDGET_USD,
    pct: AI_BUDGET_USD > 0 ? cost / AI_BUDGET_USD : 0
  };
}
