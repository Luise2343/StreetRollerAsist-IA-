import { orderRepository } from '../repositories/order.repository.js';
import { pool } from '../config/db.js';
import { sendError } from '../middleware/error-handler.js';
import { generateInvoicePdf } from '../services/invoice.service.js';
import { uploadWaMedia, sendWaDocument, sendWaText } from '../services/whatsapp.client.js';
import { logOutgoing } from '../services/message.store.js';
import { inventoryService } from '../services/business/inventory.service.js';
import { logger } from '../config/logger.js';

async function syncInventoryForStatusChange(tenantId, orderId, prevStatus, newStatus) {
  const wasConfirmed = prevStatus === 'confirmed';
  const isConfirmed = newStatus === 'confirmed';
  if (wasConfirmed === isConfirmed) return; // no transition either way

  // Pull line items
  const { rows: items } = await pool.query(
    `SELECT product_id, qty FROM order_item WHERE order_id = $1`,
    [orderId]
  );
  if (!items.length) return;

  for (const it of items) {
    const delta = isConfirmed ? -Number(it.qty) : Number(it.qty);
    const reason = isConfirmed ? 'order_confirmed' : 'order_cancelled';
    try {
      await inventoryService.adjustStock(tenantId, it.product_id, delta, {
        reason,
        referenceType: 'order',
        referenceId: orderId
      });
    } catch (e) {
      logger.error({
        action: 'inventory_sync_failed',
        orderId,
        productId: it.product_id,
        delta,
        reason,
        error: e.message
      });
    }
  }
}

async function loadInvoiceSettings(tenantId) {
  const { rows } = await pool.query(`SELECT invoice_settings FROM tenant WHERE id = $1`, [tenantId]);
  return rows[0]?.invoice_settings || {};
}

async function onOrderConfirmed(tenantId, orderId, { labelUrl, trackingUrl, courierName }) {
  try {
    const order = await orderRepository.findByIdAdmin(tenantId, orderId);
    // Bug fix: use delivery_phone as fallback when wa_id is absent (manual orders)
    const targetWaId = order?.wa_id || order?.delivery_phone;
    if (!targetWaId) {
      logger.info({ orderId }, 'Order confirmed but no wa_id or delivery_phone — skipping WhatsApp notification');
      return;
    }
    const tenant = { wa_token: order.wa_token, wa_phone_number_id: order.wa_phone_number_id };
    const settings = await loadInvoiceSettings(tenantId);
    const pdfBuffer = await generateInvoicePdf(order, { labelUrl, trackingUrl, courierName, settings });
    const mediaId = await uploadWaMedia(tenant, pdfBuffer, 'application/pdf', `pedido-${orderId}.pdf`);
    if (mediaId) {
      const docMsgId = await sendWaDocument(tenant, targetWaId, mediaId, `pedido-${orderId}.pdf`);
      // Bug fix: log outgoing messages so they appear in the chat
      await logOutgoing({
        tenantId,
        waId: targetWaId,
        providerMsgId: docMsgId,
        body: `📄 Factura pedido-${orderId}.pdf`,
        msgType: 'document',
        meta: { source: 'order_confirmed', orderId }
      });
      const trackingLine = trackingUrl
        ? `\nLink de rastreo: ${trackingUrl}`
        : '';
      const confirmMsg = `Su orden ha sido confirmada. Le adjuntamos la factura de consumidor final.${trackingLine}`;
      const textMsgId = await sendWaText(tenant, targetWaId, confirmMsg);
      await logOutgoing({
        tenantId,
        waId: targetWaId,
        providerMsgId: textMsgId,
        body: confirmMsg,
        msgType: 'text',
        meta: { source: 'order_confirmed', orderId }
      });
    } else {
      const msg = trackingUrl
        ? `Su orden ha sido confirmada. Puede rastrear su envío aquí:\n${trackingUrl}`
        : `Su orden ha sido confirmada.`;
      const textMsgId = await sendWaText(tenant, targetWaId, msg);
      await logOutgoing({
        tenantId,
        waId: targetWaId,
        providerMsgId: textMsgId,
        body: msg,
        msgType: 'text',
        meta: { source: 'order_confirmed', orderId }
      });
    }
    logger.info({ orderId, targetWaId }, 'Order confirmation sent via WhatsApp');
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
    const settings = await loadInvoiceSettings(tenantId);
    const pdfBuffer = await generateInvoicePdf(order, {
      labelUrl: order.label_url ?? null,
      trackingUrl: order.tracking_url ?? null,
      courierName: order.courier_name || undefined,
      settings,
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
    const { rows: prev } = await pool.query(
      `SELECT status FROM orders WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [orderId, tenantId]
    );
    const prevStatus = prev[0]?.status ?? null;

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

    // Sync inventory in background (don't block response)
    syncInventoryForStatusChange(tenantId, orderId, prevStatus, status).catch(e =>
      logger.error({ action: 'inventory_sync_async_failed', orderId, error: e.message })
    );

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

export async function updateOrderItems(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const orderId  = Number(req.params.orderId);
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'items array with at least one line is required' });
    }
    const result = await orderRepository.updateItems(tenantId, orderId, items);
    res.json({ ok: true, data: result });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update order items');
  }
}

export async function updateOrder(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const orderId  = Number(req.params.orderId);
    const { delivery_name, delivery_phone, delivery_address, payment_method, items } = req.body;

    const { rows } = await pool.query(
      `UPDATE orders
         SET delivery_name    = COALESCE($3, delivery_name),
             delivery_phone   = COALESCE($4, delivery_phone),
             delivery_address = COALESCE($5, delivery_address),
             payment_method   = COALESCE($6, payment_method),
             updated_at       = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, delivery_name, delivery_phone, delivery_address, payment_method, total, updated_at`,
      [orderId, tenantId,
       delivery_name  ?? null,
       delivery_phone ?? null,
       delivery_address ?? null,
       payment_method ?? null]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Order not found' });

    let itemsResult = null;
    if (Array.isArray(items) && items.length) {
      itemsResult = await orderRepository.updateItems(tenantId, orderId, items);
    }

    res.json({ ok: true, data: { ...rows[0], total: itemsResult?.total ?? rows[0].total } });
  } catch (e) {
    sendError(res, e.status || 500, e, 'Failed to update order');
  }
}

export async function deleteOrder(req, res) {
  try {
    const tenantId = Number(req.params.tenantId);
    const orderId = Number(req.params.orderId);
    const { rows } = await pool.query(
      `SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (rows[0].status !== 'cancelled') {
      return res.status(400).json({ ok: false, error: 'Only cancelled orders can be deleted' });
    }
    await pool.query(`DELETE FROM payment WHERE order_id = $1`, [orderId]);
    await pool.query(`DELETE FROM order_item WHERE order_id = $1`, [orderId]);
    await pool.query(`DELETE FROM orders WHERE id = $1 AND tenant_id = $2`, [orderId, tenantId]);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, 500, e, 'Failed to delete order');
  }
}
