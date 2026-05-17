import { orderRepository } from '../repositories/order.repository.js';
import { pool } from '../config/db.js';
import { sendError } from '../middleware/error-handler.js';
import { generateInvoicePdf } from '../services/invoice.service.js';
import { uploadWaMedia, sendWaDocument, sendWaText } from '../services/whatsapp.client.js';
import { logger } from '../config/logger.js';

async function onOrderConfirmed(tenantId, orderId, { labelUrl, trackingUrl, courierName }) {
  try {
    const order = await orderRepository.findByIdAdmin(tenantId, orderId);
    if (!order?.wa_id) {
      logger.info({ orderId }, 'Order confirmed but no wa_id — skipping WhatsApp notification');
      return;
    }
    const tenant = { wa_token: order.wa_token, wa_phone_number_id: order.wa_phone_number_id };
    const pdfBuffer = await generateInvoicePdf(order, { labelUrl, trackingUrl, courierName });
    const mediaId = await uploadWaMedia(tenant, pdfBuffer, 'application/pdf', `pedido-${orderId}.pdf`);
    if (mediaId) {
      await sendWaDocument(tenant, order.wa_id, mediaId, `pedido-${orderId}.pdf`);
      const trackingLine = trackingUrl
        ? `\nLink de rastreo: ${trackingUrl}`
        : '';
      await sendWaText(
        tenant,
        order.wa_id,
        `Su orden ha sido confirmada. Le adjuntamos la factura de consumidor final.${trackingLine}`
      );
    } else {
      const msg = trackingUrl
        ? `Su orden ha sido confirmada. Puede rastrear su envío aquí:\n${trackingUrl}`
        : `Su orden ha sido confirmada.`;
      await sendWaText(tenant, order.wa_id, msg);
    }
    logger.info({ orderId, wa_id: order.wa_id }, 'Order confirmation sent via WhatsApp');
  } catch (err) {
    logger.error({ err, orderId }, 'Failed to send order confirmation via WhatsApp');
  }
}

export async function createManualOrder(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const { delivery_name, delivery_phone, delivery_address, payment_method, items, wa_id } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'items array with at least one line is required' });
    }
    const row = await orderRepository.createManual(tenantId, {
      deliveryName: delivery_name ?? null,
      deliveryPhone: delivery_phone ?? null,
      deliveryAddress: delivery_address ?? null,
      paymentMethod: payment_method ?? null,
      waId: wa_id ?? null,
      items,
    });
    res.status(201).json({ ok: true, data: row });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to create manual order');
  }
}

export async function getInvoice(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const orderId = Number(req.params.orderId);
    const order = await orderRepository.findByIdAdmin(tenantId, orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    const pdfBuffer = await generateInvoicePdf(order, {
      labelUrl: order.label_url ?? null,
      trackingUrl: order.tracking_url ?? null,
      courierName: order.courier_name || 'XPRESS',
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="pedido-${orderId}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to generate invoice');
  }
}

export async function listOrders(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await orderRepository.findAllAdmin(tenantId, { limit });
    res.json({ ok: true, data: rows });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to list orders');
  }
}

export async function updateStatus(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const orderId = Number(req.params.orderId);
    const { status, label_url, tracking_url, courier_name, send_invoice = false } = req.body;
    const VALID = ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!VALID.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${VALID.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE orders SET status = $1, updated_at = now(),
        label_url = COALESCE($4, label_url),
        tracking_url = COALESCE($5, tracking_url),
        courier_name = COALESCE($6, courier_name)
       WHERE id = $2 AND tenant_id = $3 AND status <> $1
       RETURNING id, status, updated_at`,
      [status, orderId, tenantId, label_url ?? null, tracking_url ?? null, courier_name ?? null]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Order not found or status already set' });
    res.json({ ok: true, data: rows[0] });

    if (status === 'confirmed' && send_invoice) {
      onOrderConfirmed(tenantId, orderId, {
        labelUrl: label_url ?? null,
        trackingUrl: tracking_url ?? null,
        courierName: courier_name || 'XPRESS',
      });
    }
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update order status');
  }
}
