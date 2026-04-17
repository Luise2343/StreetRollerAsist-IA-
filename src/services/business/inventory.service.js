// src/services/business/inventory.service.js
import { inventoryRepository } from '../../repositories/inventory.repository.js';

export const inventoryService = {
  async listInventory(tenantId) {
    return inventoryRepository.findAll(tenantId);
  },

  async adjustStock(tenantId, productId, delta) {
    if (!productId || typeof delta !== 'number') {
      const err = new Error('productId and numeric delta are required');
      err.status = 400;
      throw err;
    }
    const row = await inventoryRepository.adjust(tenantId, productId, delta);
    if (!row) {
      const err = new Error('Inventory not found for this product');
      err.status = 404;
      throw err;
    }
    return row;
  }
};
