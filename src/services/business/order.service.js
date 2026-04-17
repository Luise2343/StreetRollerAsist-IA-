// src/services/business/order.service.js
import { orderRepository } from '../../repositories/order.repository.js';

export const orderService = {
  async listOrders(tenantId) {
    return orderRepository.findAll(tenantId);
  },

  async createOrder(tenantId, data) {
    const { customer_id, items, discount_total, tax_total, status } = data;
    if (!customer_id || !items) {
      const err = new Error('customer_id and items are required');
      err.status = 400;
      throw err;
    }
    return orderRepository.create(tenantId, {
      customer_id,
      items,
      discount_total,
      tax_total,
      status
    });
  }
};
