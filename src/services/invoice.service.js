import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { createRequire } from 'module';
import crypto from 'crypto';
import QRCode from 'qrcode';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deterministic 4-char uppercase hex from a seed (stable across renders)
function shortHash(seed) {
  return crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 4).toUpperCase();
}

// Build pro-looking codes when the order_item doesn't have them stored yet.
function deriveCodes({ order, item, index }) {
  const created = new Date(order.created_at || Date.now());
  const yy = String(created.getFullYear()).slice(2);
  const mm = String(created.getMonth() + 1).padStart(2, '0');
  const orderPad = String(order.id).padStart(6, '0');
  const itemPad = String(index + 1).padStart(2, '0');
  const productPad = String(item.product_id || 0).padStart(4, '0');
  const seed = `${order.id}:${item.product_id}:${index}`;
  const hex = shortHash(seed);
  const brandCode = (item.brand || 'VP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'VP';
  const catCode = (item.category || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'GEN';
  return {
    sku: item.sku || `${brandCode}-${catCode}-${productPad}`,
    model: item.model_code || `${brandCode}/${catCode}-${productPad}-${yy}`,
    serial: item.serial_number || `SN-${brandCode}-${yy}${mm}-${orderPad}-${itemPad}-${hex}`,
  };
}

// Pick up to 3 short spec lines from product.specs JSONB.
function formatSpecs(specs) {
  if (!specs || typeof specs !== 'object') return '';
  const labels = {
    battery: 'Batería', capacity: 'Capacidad', power: 'Potencia',
    voltage: 'Voltaje', autonomy: 'Autonomía', weight: 'Peso',
    color: 'Color', material: 'Material', size: 'Tamaño',
    warranty: 'Garantía', range: 'Alcance', speed: 'Velocidad',
  };
  const entries = Object.entries(specs).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return '';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${labels[k] || k}: ${v}`)
    .join('  ·  ');
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function generateQRPng(text, sizePx = 200) {
  return QRCode.toBuffer(text, {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: sizePx,
    margin: 1,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  });
}

// Default invoice settings — used when tenant has no overrides.
const DEFAULT_SETTINGS = {
  store: {
    name: 'VoltiPod',
    address: 'Calle El Progreso, San Salvador',
    phone: '+503 7313 0634',
  },
  warranty: {
    months: 12,
    claim_text: 'WhatsApp +503 7313 0634 (presentar esta factura con N° de serie).',
    exclusions: 'daño por mal uso, líquidos, modificaciones o impactos.',
  },
  return_policy: [
    'Cambios y devoluciones dentro de 30 días naturales desde la entrega.',
    'Producto en empaque original, sin uso y presentando esta factura.',
    'No aplica para artículos personalizados, consumibles o con S/N alterado.',
  ],
  footer_message: '¡Gracias por tu compra!',
  shipping: {
    default_cost: 5.00,
    courtesy_label: 'Cortesía VoltiPod',
    show_courtesy: true,
  },
  tax: {
    rate: 0.13,
    label: 'IVA (13%)',
  },
  default_courier: 'XPRESS',
};

// Merge user settings on top of defaults, preserving nested keys.
function mergeSettings(user = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...user,
    store:    { ...DEFAULT_SETTINGS.store,    ...(user.store    || {}) },
    warranty: { ...DEFAULT_SETTINGS.warranty, ...(user.warranty || {}) },
    shipping: { ...DEFAULT_SETTINGS.shipping, ...(user.shipping || {}) },
    tax:      { ...DEFAULT_SETTINGS.tax,      ...(user.tax      || {}) },
    return_policy: Array.isArray(user.return_policy) ? user.return_policy : DEFAULT_SETTINGS.return_policy,
  };
}

/**
 * Extract "Comentarios" text from Boxful PDF bytes.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>}
 */
async function extractBoxfulComments(pdfBuffer) {
  try {
    const parsed = await pdfParse(pdfBuffer);
    const match = parsed.text.match(/Comentarios[:\s]*(.+?)(?:\n|Direcci)/is);
    return match ? match[1].trim().replace(/\s+/g, ' ') : '';
  } catch {
    return '';
  }
}

/**
 * Format date as DD/MM/YYYY
 * @param {string|Date} date
 */
function formatDate(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Format payment method to Spanish label.
 */
function formatPayment(method) {
  if (method === 'contra_entrega') return 'Contra entrega';
  if (method === 'transferencia') return 'Transferencia';
  return method ?? '';
}

/**
 * Generate combined invoice + Boxful label PDF.
 *
 * @param {object} order - Full order from DB (delivery_name, delivery_phone, delivery_address, payment_method, total, items, created_at, id)
 * @param {object} opts
 * @param {string} opts.labelUrl - Boxful PDF label URL
 * @param {string} opts.trackingUrl - Tracking URL
 * @param {string} [opts.courierName] - Courier name (default 'XPRESS')
 * @returns {Promise<Buffer>}
 */
export async function generateInvoicePdf(order, { labelUrl, trackingUrl, courierName, shippingCost, settings } = {}) {
  const cfg = mergeSettings(settings);
  const resolvedCourier = courierName || cfg.default_courier;
  const resolvedShipping = shippingCost != null ? shippingCost : cfg.shipping.default_cost;
  const STORE_NAME = cfg.store.name;
  const STORE_ADDRESS = cfg.store.address;
  const STORE_PHONE = cfg.store.phone;

  let labelBytes = null;
  let deliveryInstructions = '';
  let boxfulDoc = null;

  if (labelUrl) {
    // 1. Validate labelUrl is from Boxful (SSRF prevention)
    const allowedHosts = ['boxful.sfo3.digitaloceanspaces.com', 'api.goboxful.com'];
    const parsedUrl = new URL(labelUrl);
    if (!parsedUrl.protocol.startsWith('https') || !allowedHosts.includes(parsedUrl.hostname)) {
      throw new Error(`labelUrl must be an https URL from an allowed Boxful host`);
    }

    // 2. Download Boxful label PDF (with timeout)
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    try {
      const labelRes = await fetch(labelUrl, { signal: ac.signal });
      if (!labelRes.ok) throw new Error(`Failed to download label: ${labelRes.status}`);
      labelBytes = Buffer.from(await labelRes.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }

    deliveryInstructions = await extractBoxfulComments(labelBytes);
    boxfulDoc = await PDFDocument.load(labelBytes);
  }

  // 4. Create invoice document
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // 5. Watermark "VoltiPod" — rotated diagonal text, centered on page
  const watermarkText = STORE_NAME.toUpperCase();
  const watermarkSize = 90;
  const angleDeg = 30;
  const angleRad = (angleDeg * Math.PI) / 180;
  const wmTextW = helveticaBold.widthOfTextAtSize(watermarkText, watermarkSize);
  const wmTextH = watermarkSize * 0.72; // approx cap height
  // To center the rotated text's bbox on the page center:
  //   center = (x0 + L/2*cos - h/2*sin, y0 + L/2*sin + h/2*cos)
  // Solve for (x0, y0) given desired center = (W/2, H/2).
  page.drawText(watermarkText, {
    x: width / 2 - (wmTextW / 2) * Math.cos(angleRad) + (wmTextH / 2) * Math.sin(angleRad),
    y: height / 2 - (wmTextW / 2) * Math.sin(angleRad) - (wmTextH / 2) * Math.cos(angleRad),
    size: watermarkSize,
    font: helveticaBold,
    color: rgb(0.85, 0.85, 0.85),
    opacity: 0.15,
    rotate: degrees(angleDeg),
  });

  // 6. Header: brand name top-left (tightened against top edge)
  page.drawText(STORE_NAME, {
    x: 40,
    y: height - 48,
    size: 24,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  // 6b. FACTURA label under brand
  page.drawText('FACTURA', {
    x: 40,
    y: height - 62,
    size: 9,
    font: helveticaBold,
    color: rgb(0.4, 0.4, 0.4),
  });

  // 7. Date/Pedido box (top-right) — slightly smaller
  const boxX = width - 175;
  const boxY = height - 65;
  page.drawRectangle({ x: boxX, y: boxY, width: 150, height: 42, color: rgb(0.94, 0.94, 0.94) });
  page.drawText('Fecha', { x: boxX + 10, y: boxY + 26, size: 9, font: helveticaBold, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(formatDate(order.created_at), { x: boxX + 65, y: boxY + 26, size: 9, font: helvetica, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Pedido n°', { x: boxX + 10, y: boxY + 11, size: 9, font: helveticaBold, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(String(order.id), { x: boxX + 65, y: boxY + 11, size: 9, font: helvetica, color: rgb(0.1, 0.1, 0.1) });

  // 8. Store address line (compacted)
  const addrY = height - 82;
  page.drawLine({ start: { x: 30, y: addrY }, end: { x: width - 30, y: addrY }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  page.drawText(`${STORE_ADDRESS}    ${STORE_PHONE}`, {
    x: 30,
    y: addrY - 13,
    size: 9,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  // 9. Customer info box — pushed further from address text to avoid border overlap
  const custBoxY = addrY - 105;
  const custBoxH = 76;
  page.drawRectangle({ x: 30, y: custBoxY, width: width - 60, height: custBoxH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });

  const fields = [
    { label: 'Nombre', value: order.customer_name || '' },
    { label: 'Teléfono', value: order.delivery_phone || '' },
    { label: 'Dirección', value: order.delivery_address || '' },
  ];

  fields.forEach((f, i) => {
    const fy = custBoxY + custBoxH - 18 - i * 22;
    page.drawText(f.label, { x: 42, y: fy, size: 10, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(f.value, { x: 110, y: fy, size: 10, font: helvetica, color: rgb(0.2, 0.2, 0.2), maxWidth: 420 });
  });

  // 10. Products table — left column when label present, full width otherwise.
  const hasLabel = !!boxfulDoc;
  const tableLeft = 30;
  const tableRight = hasLabel ? 295 : width - 30;
  const tableW = tableRight - tableLeft;
  const tableTop = custBoxY - 18;

  // Columns: Cant | Descripción | P. Unitario | Subtotal
  // Tighter price columns when the label crowds the right side
  const colQtyW = hasLabel ? 28 : 36;
  const colSubW = hasLabel ? 52 : 65;
  const colPriceW = hasLabel ? 48 : 65;
  const colDescW = tableW - colQtyW - colPriceW - colSubW;
  const colX = [
    tableLeft,                                         // Cant
    tableLeft + colQtyW,                               // Desc
    tableLeft + colQtyW + colDescW,                    // Price (right edge)
    tableLeft + colQtyW + colDescW + colPriceW,        // Subtotal (right edge)
    tableRight,                                        // table right
  ];

  // Header bar
  page.drawRectangle({ x: tableLeft, y: tableTop - 18, width: tableW, height: 20, color: rgb(0.12, 0.12, 0.12) });
  const headers = ['Cant', 'Descripción del Producto', 'P. Unit.', 'Subtotal'];
  page.drawText(headers[0], { x: colX[0] + 6, y: tableTop - 13, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
  page.drawText(headers[1], { x: colX[1] + 6, y: tableTop - 13, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
  // Right-align numeric headers
  const ph = helveticaBold.widthOfTextAtSize(headers[2], 9);
  page.drawText(headers[2], { x: colX[3] - ph - 6, y: tableTop - 13, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
  const sh = helveticaBold.widthOfTextAtSize(headers[3], 9);
  page.drawText(headers[3], { x: colX[4] - sh - 6, y: tableTop - 13, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });

  // Rows: each item gets up to 3 lines (name / sku·model·sn / specs)
  const items = order.items || [];
  const maxRows = 5;
  const rowGap = 4;
  const nameMaxChars = hasLabel ? 28 : 60;
  const codeMaxChars = hasLabel ? 38 : 80;
  const specMaxChars = hasLabel ? 36 : 80;
  let rowY = tableTop - 22;

  const itemsToRender = items.slice(0, maxRows);
  itemsToRender.forEach((item, idx) => {
    const { sku, model, serial } = deriveCodes({ order, item, index: idx });
    const specsLine = formatSpecs(item.specs);

    // Truncate strings safely
    const name = String(item.product_name || '').slice(0, nameMaxChars);
    // In half-width mode, split codes into two lines so the S/N is visible.
    const codeLines = hasLabel
      ? [`SKU ${sku}  ·  Modelo ${model}`, `S/N ${serial}`]
      : [`SKU ${sku}  ·  Modelo ${model}  ·  S/N ${serial}`];
    codeLines.forEach((c, i) => { codeLines[i] = c.slice(0, codeMaxChars); });
    // Skip specs in half-width mode to save vertical space (label crowds the page)
    const specStr = !hasLabel && specsLine ? specsLine.slice(0, specMaxChars) : '';

    const extraLines = codeLines.length + (specStr ? 1 : 0);
    const rowH = 12 + (1 + extraLines) * 10; // name + extras at unified line height

    // Separator line
    page.drawLine({
      start: { x: tableLeft, y: rowY },
      end: { x: tableRight, y: rowY },
      thickness: 0.3,
      color: rgb(0.88, 0.88, 0.88),
    });

    // Cant (vertically centered to name line)
    const qtyY = rowY - 14;
    page.drawText(String(item.qty), { x: colX[0] + 10, y: qtyY, size: 10, font: helvetica, color: rgb(0.15, 0.15, 0.15) });

    // Line 1: name
    page.drawText(name, { x: colX[1] + 6, y: qtyY, size: 10, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
    // P. Unit. right-aligned
    const priceStr = `$${Number(item.unit_price).toFixed(2)}`;
    const pw = helvetica.widthOfTextAtSize(priceStr, 10);
    page.drawText(priceStr, { x: colX[3] - pw - 6, y: qtyY, size: 10, font: helvetica, color: rgb(0.15, 0.15, 0.15) });
    // Subtotal right-aligned
    const subStr = `$${Number(item.subtotal).toFixed(2)}`;
    const sw = helvetica.widthOfTextAtSize(subStr, 10);
    page.drawText(subStr, { x: colX[4] - sw - 6, y: qtyY, size: 10, font: helvetica, color: rgb(0.15, 0.15, 0.15) });

    // Subsequent lines: codes and specs — unified size, tight line height
    let lineY = qtyY - 10;
    codeLines.forEach((c) => {
      page.drawText(c, { x: colX[1] + 6, y: lineY, size: 8, font: helvetica, color: rgb(0.45, 0.45, 0.45) });
      lineY -= 10;
    });
    if (specStr) {
      page.drawText(specStr, { x: colX[1] + 6, y: lineY, size: 8, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    }

    rowY -= rowH + rowGap;
  });

  // Bottom border of the rows section
  page.drawLine({
    start: { x: tableLeft, y: rowY + rowGap },
    end: { x: tableRight, y: rowY + rowGap },
    thickness: 0.6,
    color: rgb(0.7, 0.7, 0.7),
  });

  // 11. Financial breakdown — right-aligned strip
  // Shipping is shown at its real cost and then discounted in full ("Cortesía VoltiPod")
  // so the customer sees what we absorb on their behalf.
  const subtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
  const discount = Number(order.discount_total || 0);
  const tax = Number(order.tax_total || 0);
  const shipping = Number(resolvedShipping || 0);
  const total = Number(order.total ?? (subtotal - discount + tax));

  const breakdownLines = [];
  breakdownLines.push({ label: 'Subtotal', value: subtotal });
  if (discount > 0) breakdownLines.push({ label: 'Descuento', value: -discount });
  if (shipping > 0) {
    breakdownLines.push({ label: 'Envío', value: shipping });
    if (cfg.shipping.show_courtesy) {
      breakdownLines.push({
        label: cfg.shipping.courtesy_label,
        value: -shipping,
        highlight: true,
      });
    }
  } else {
    breakdownLines.push({ label: 'Envío', value: 0, plainText: 'GRATIS', highlight: true });
  }
  if (tax > 0) breakdownLines.push({ label: cfg.tax.label, value: tax });

  const breakX = tableRight;
  const breakLabelX = tableRight - 180;
  let breakY = rowY - 8;
  breakdownLines.forEach((line) => {
    const color = line.highlight ? rgb(0.12, 0.50, 0.20) : rgb(0.35, 0.35, 0.35);
    const valueColor = line.highlight ? rgb(0.12, 0.50, 0.20) : rgb(0.2, 0.2, 0.2);
    const font = line.highlight ? helveticaBold : helvetica;
    page.drawText(line.label, { x: breakLabelX, y: breakY, size: 9, font, color });
    const valueStr = line.plainText || `${line.value < 0 ? '-' : ''}$${Math.abs(line.value).toFixed(2)}`;
    const vw = font.widthOfTextAtSize(valueStr, 9);
    page.drawText(valueStr, { x: breakX - vw - 6, y: breakY, size: 9, font, color: valueColor });
    breakY -= 13;
  });
  // Total bar — leave enough gap below last breakdown line
  breakY -= 10;
  const totalBarH = 24;
  page.drawRectangle({
    x: breakLabelX - 8,
    y: breakY - totalBarH + 6,
    width: tableRight - (breakLabelX - 8),
    height: totalBarH,
    color: rgb(0.12, 0.12, 0.12),
  });
  page.drawText('TOTAL', { x: breakLabelX, y: breakY - 9, size: 12, font: helveticaBold, color: rgb(1, 1, 1) });
  const tStr = `$${total.toFixed(2)}`;
  const tw = helveticaBold.widthOfTextAtSize(tStr, 12);
  page.drawText(tStr, { x: breakX - tw - 6, y: breakY - 9, size: 12, font: helveticaBold, color: rgb(1, 1, 1) });
  breakY -= totalBarH;

  // 11b. QR code — only when there is no Boxful label (label occupies right column)
  if (!hasLabel) {
    try {
      const qrText = trackingUrl
        ? trackingUrl
        : `https://wa.me/50373130634?text=Pedido%20%23${order.id}`;
      const qrBuffer = await generateQRPng(qrText, 200);
      const qrImage = await doc.embedPng(qrBuffer);
      const qrSize = 90;
      // Align vertically with the financial breakdown: rowY is where breakdown starts,
      // place the QR centred in the left dead-space (tableLeft to breakLabelX-8).
      const qrX = tableLeft + 20;
      // Clamp so labels (qrY - 30) stay at least 40pt from the page bottom
      const qrY = Math.max(rowY - 95, 70);
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
      // Label lines below the QR
      const qrLabel1 = 'Escanea para ' + (trackingUrl ? 'rastreo' : 'soporte');
      const qrLabel2 = trackingUrl ? 'del pedido' : 'WhatsApp';
      page.drawText(qrLabel1, {
        x: qrX, y: qrY - 12, size: 8, font: helvetica, color: rgb(0.4, 0.4, 0.4),
      });
      page.drawText(qrLabel2, {
        x: qrX, y: qrY - 22, size: 7, font: helvetica, color: rgb(0.5, 0.5, 0.5),
      });
    } catch {
      // QR generation failed — continue without it, do not break the invoice
    }
  }

  // 12. Warranty box
  const warrantyTop = breakY - 4;
  const warrantyH = 92;
  const warrantyExpires = formatDate(addMonths(order.created_at || new Date(), cfg.warranty.months));
  page.drawRectangle({
    x: tableLeft,
    y: warrantyTop - warrantyH,
    width: tableW,
    height: warrantyH,
    color: rgb(0.97, 0.97, 0.93),
    borderColor: rgb(0.85, 0.80, 0.55),
    borderWidth: 0.6,
  });
  page.drawText('GARANTÍA', { x: tableLeft + 10, y: warrantyTop - 14, size: 9, font: helveticaBold, color: rgb(0.45, 0.35, 0.10) });
  const wLines = [
    `Vigencia: ${cfg.warranty.months} meses desde la compra. Vence: ${warrantyExpires}`,
    `Reclamos: ${cfg.warranty.claim_text}`,
    `No cubre: ${cfg.warranty.exclusions}`,
  ];
  wLines.forEach((ln, i) => {
    page.drawText(ln, { x: tableLeft + 10, y: warrantyTop - 30 - i * 13, size: 8.5, font: helvetica, color: rgb(0.25, 0.22, 0.10) });
  });

  // 13. Shipping details — sized to its content
  const shipTop = warrantyTop - warrantyH - 12;
  const wrapChars = hasLabel ? 45 : 95;
  const instrLines = deliveryInstructions
    ? (deliveryInstructions.match(new RegExp(`.{1,${wrapChars}}`, 'g')) || [deliveryInstructions]).slice(0, 2)
    : [];
  const shipBodyLines = [
    ...instrLines,
    ...(formatPayment(order.payment_method) ? [`Pago: ${formatPayment(order.payment_method)}`] : []),
    `Encargado: ${resolvedCourier}`,
    ...(trackingUrl ? [`Tracking: ${trackingUrl}`] : []),
  ];
  const shipH = 20 + shipBodyLines.length * 12 + 6;
  page.drawRectangle({
    x: tableLeft,
    y: shipTop - shipH,
    width: tableW,
    height: shipH,
    color: rgb(0.96, 0.96, 0.96),
  });
  page.drawText('DETALLES DEL ENVÍO', { x: tableLeft + 10, y: shipTop - 14, size: 9, font: helveticaBold, color: rgb(0.15, 0.15, 0.15) });
  const detX = tableLeft + 10;
  shipBodyLines.forEach((ln, i) => {
    const isTracking = trackingUrl && ln.startsWith('Tracking:');
    page.drawText(ln, {
      x: detX,
      y: shipTop - 30 - i * 12,
      size: isTracking ? 7.5 : 8.5,
      font: helvetica,
      color: isTracking ? rgb(0.1, 0.3, 0.8) : rgb(0.25, 0.25, 0.25),
      maxWidth: tableW - 20,
    });
  });

  // 14. Embed Boxful label on the right column when present
  if (boxfulDoc) {
    const labelLeft = 305;
    const labelRight = width - 30;
    const labelW = labelRight - labelLeft;
    const labelBottom = shipTop - shipH;
    const labelTop = tableTop;
    const labelH = labelTop - labelBottom;
    // Frame around the label area
    page.drawRectangle({
      x: labelLeft, y: labelBottom,
      width: labelW, height: labelH,
      borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5,
    });
    // Header strip
    page.drawRectangle({
      x: labelLeft, y: labelTop - 18,
      width: labelW, height: 18,
      color: rgb(0.12, 0.12, 0.12),
    });
    page.drawText('GUÍA DE ENVÍO', {
      x: labelLeft + 8, y: labelTop - 13,
      size: 9, font: helveticaBold, color: rgb(1, 1, 1),
    });
    page.drawText(resolvedCourier, {
      x: labelRight - helveticaBold.widthOfTextAtSize(resolvedCourier, 9) - 8,
      y: labelTop - 13,
      size: 9, font: helveticaBold, color: rgb(1, 1, 1),
    });
    try {
      const [embeddedPage] = await doc.embedPdf(boxfulDoc, [0]);
      const { width: srcW, height: srcH } = embeddedPage.scale(1);
      // Reserve inner padding inside the frame
      const pad = 8;
      const innerLeft = labelLeft + pad;
      const innerBottom = labelBottom + pad;
      const innerW = labelW - pad * 2;
      const innerH = labelH - 18 - pad * 2; // minus header strip
      const scale = Math.min(innerW / srcW, innerH / srcH);
      const drawW = srcW * scale;
      const drawH = srcH * scale;
      const drawX = innerLeft + (innerW - drawW) / 2;
      const drawY = innerBottom + (innerH - drawH) / 2;
      page.drawPage(embeddedPage, { x: drawX, y: drawY, width: drawW, height: drawH });
    } catch {
      page.drawText('Guía de envío no disponible', {
        x: labelLeft + 15, y: labelTop - 50,
        size: 10, font: helvetica, color: rgb(0.5, 0.5, 0.5),
      });
    }
  }

  // 15. Return policy — flows below shipping box
  const policyTop = shipTop - shipH - 14;
  page.drawText('POLÍTICA DE CAMBIO Y DEVOLUCIÓN', {
    x: 30, y: policyTop, size: 8, font: helveticaBold, color: rgb(0.3, 0.3, 0.3),
  });
  const policy = cfg.return_policy.map((p) => p.startsWith('•') ? p : `• ${p}`);
  policy.forEach((p, i) => {
    page.drawText(p, { x: 30, y: policyTop - 12 - i * 10, size: 7.5, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
  });
  const policyBottom = policyTop - 12 - (policy.length - 1) * 10;

  // 16. Footer — tagline + contact line, flows below policy (min 30pt from page bottom)
  const footerBaselineY = Math.max(55, policyBottom - 38);
  page.drawText(cfg.footer_message, {
    x: 30, y: footerBaselineY + 14, size: 12, font: helveticaBold, color: rgb(0.15, 0.15, 0.15),
  });
  page.drawText(`${STORE_NAME} · ${STORE_PHONE} · ${STORE_ADDRESS}`, {
    x: 30, y: footerBaselineY, size: 8, font: helvetica, color: rgb(0.45, 0.45, 0.45),
  });
  // Right footer: pedido number for reference
  const refStr = `Pedido #${order.id}`;
  const refW = helveticaBold.widthOfTextAtSize(refStr, 10);
  page.drawText(refStr, {
    x: width - 30 - refW, y: footerBaselineY + 7, size: 10, font: helveticaBold, color: rgb(0.3, 0.3, 0.3),
  });

  // 14. Return as Buffer
  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
