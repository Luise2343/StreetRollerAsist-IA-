// src/services/business/tenant.service.js
import { tenantRepository } from '../../repositories/tenant.repository.js';
import { invalidateTenantCaches } from '../../middleware/tenant.js';

export const tenantService = {
  async createTenant(data) {
    const row = await tenantRepository.create(data);
    invalidateTenantCaches();
    return row;
  },

  async updateTenant(id, patch) {
    const row = await tenantRepository.update(id, patch);
    invalidateTenantCaches();
    return row;
  },

  async getTenant(id) {
    return tenantRepository.findById(id);
  },

  async listTenants() {
    return tenantRepository.listAll();
  },

  async listCategories(tenantId) {
    return tenantRepository.listCategories(tenantId);
  },

  async createCategory(tenantId, data) {
    if (!data?.slug || !data?.label) {
      const err = new Error('slug and label are required');
      err.status = 400;
      throw err;
    }
    return tenantRepository.createCategory(tenantId, data);
  },

  async updateCategory(tenantId, slug, patch) {
    return tenantRepository.updateCategory(tenantId, slug, patch);
  }
};
