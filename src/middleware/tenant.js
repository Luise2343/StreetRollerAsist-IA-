// src/middleware/tenant.js — resolve tenant with short TTL in-memory cache
import { tenantRepository } from '../repositories/tenant.repository.js';

const TTL_MS = 5 * 60 * 1000;

const cacheByPhone = new Map();
const cacheByApiKey = new Map();

function getCached(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    map.delete(key);
    return null;
  }
  return e.value;
}

function setCached(map, key, value) {
  map.set(key, { value, expires: Date.now() + TTL_MS });
}

export function invalidateTenantCaches(tenant = null) {
  if (!tenant) {
    cacheByPhone.clear();
    cacheByApiKey.clear();
    return;
  }
  for (const [k, v] of cacheByPhone.entries()) {
    if (v.value?.id === tenant.id) cacheByPhone.delete(k);
  }
  for (const [k, v] of cacheByApiKey.entries()) {
    if (v.value?.id === tenant.id) cacheByApiKey.delete(k);
  }
}

export async function resolveTenantByWaPhoneNumberId(phoneNumberId) {
  const id = String(phoneNumberId || '');
  if (!id) return null;
  const hit = getCached(cacheByPhone, id);
  if (hit) return hit;
  const t = await tenantRepository.findByWaPhoneNumberId(id);
  if (t) setCached(cacheByPhone, id, t);
  return t;
}

export async function resolveTenantByApiKey(apiKey) {
  const k = String(apiKey || '');
  if (!k) return null;
  const hit = getCached(cacheByApiKey, k);
  if (hit) return hit;
  const t = await tenantRepository.findByApiKey(k);
  if (t) setCached(cacheByApiKey, k, t);
  return t;
}
