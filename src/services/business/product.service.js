// src/services/business/product.service.js
import { productRepository } from '../../repositories/product.repository.js';

export const productService = {
  async listProducts(tenantId) {
    return productRepository.findAll(tenantId);
  },

  async createProduct(tenantId, data) {
    const { name, basePrice, currency, description, active, category, brand, specs, images, sku } = data;
    if (!name || basePrice === null || basePrice === undefined || !currency) {
      const err = new Error('name, basePrice and currency are required');
      err.status = 400;
      throw err;
    }
    return productRepository.create(tenantId, {
      name,
      basePrice,
      currency,
      description,
      active,
      category,
      brand,
      specs: specs ?? {},
      images: images ?? [],
      sku
    });
  }
};
