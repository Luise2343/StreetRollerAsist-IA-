import { productService } from '../services/business/product.service.js';
import { sendError } from '../middleware/error-handler.js';

export async function list(req, res) {
  try {
    const rows = await productService.listProducts(req.tenant.id);
    res.json(rows);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list products');
  }
}

export async function create(req, res) {
  try {
    const row = await productService.createProduct(req.tenant.id, req.body);
    res.status(201).json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to create product');
  }
}
