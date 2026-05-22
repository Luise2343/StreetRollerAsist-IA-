import { tenantService } from '../services/business/tenant.service.js';
import { sendError } from '../middleware/error-handler.js';
import { pool } from '../config/db.js';

export async function createTenant(req, res) {
  try {
    const row = await tenantService.createTenant(req.body);
    res.status(201).json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to create tenant');
  }
}

export async function getTenant(req, res) {
  try {
    const id = Number(req.params.id);
    const row = await tenantService.getTenant(id);
    if (!row) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    res.json(row);
  } catch (e) {
    sendError(res, 500, e, 'Failed to get tenant');
  }
}

export async function updateTenant(req, res) {
  try {
    const id = Number(req.params.id);
    const row = await tenantService.updateTenant(id, req.body);
    if (!row) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    res.json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update tenant');
  }
}

export async function listCategories(req, res) {
  try {
    const tenantId = Number(req.params.id);
    const rows = await tenantService.listCategories(tenantId);
    res.json(rows);
  } catch (e) {
    sendError(res, 500, e, 'Failed to list categories');
  }
}

export async function createCategory(req, res) {
  try {
    const tenantId = Number(req.params.id);
    const row = await tenantService.createCategory(tenantId, req.body);
    res.status(201).json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to create category');
  }
}

export async function updateCategory(req, res) {
  try {
    const tenantId = Number(req.params.id);
    const { slug } = req.params;
    const row = await tenantService.updateCategory(tenantId, slug, req.body);
    if (!row) return res.status(404).json({ ok: false, error: 'Category not found' });
    res.json(row);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update category');
  }
}

export async function getInvoiceSettings(req, res) {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT invoice_settings FROM tenant WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    res.json({ ok: true, data: rows[0].invoice_settings || {} });
  } catch (e) {
    sendError(res, 500, e, 'Failed to get invoice settings');
  }
}

export async function updateInvoiceSettings(req, res) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ ok: false, error: 'Body must be an object' });
    }
    const { rows } = await pool.query(
      `UPDATE tenant SET invoice_settings = $1::jsonb, updated_at = now()
       WHERE id = $2 RETURNING invoice_settings`,
      [JSON.stringify(body), id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    res.json({ ok: true, data: rows[0].invoice_settings });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update invoice settings');
  }
}
