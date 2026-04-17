import { customerRepository } from '../repositories/customer.repository.js';
import { sendError } from '../middleware/error-handler.js';

export async function list(req, res) {
  try {
    const rows = await customerRepository.findAll(req.tenant.id);
    res.json(rows);
  } catch (e) {
    sendError(res, 500, e, 'Failed to list customers');
  }
}

export async function create(req, res) {
  try {
    const { name, phone, email } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
    const row = await customerRepository.create(req.tenant.id, { name, phone, email });
    res.status(201).json(row);
  } catch (e) {
    sendError(res, 500, e, 'Failed to create customer');
  }
}
