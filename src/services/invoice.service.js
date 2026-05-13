import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import pdfParse from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Store constants
const STORE_ADDRESS = 'Calle El Progreso, San Salvador';
const STORE_PHONE = '+503 7313 0634';
const STORE_NAME = 'VoltiPod';

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
 * Load SVG path data from the logo file.
 * @returns {string} SVG path d attribute
 */
function loadLogoPath() {
  try {
    const svgPath = path.resolve(__dirname, '../../AAF8xuvOsFs_1773811652945.svg');
    const svg = fs.readFileSync(svgPath, 'utf8');
    const match = svg.match(/d="([^"]+)"/);
    return match ? match[1] : '';
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
export async function generateInvoicePdf(order, { labelUrl, trackingUrl, courierName = 'XPRESS' }) {
  // 1. Validate labelUrl is from Boxful (SSRF prevention)
  const allowedHosts = ['boxful.sfo3.digitaloceanspaces.com', 'api.goboxful.com'];
  const parsedUrl = new URL(labelUrl);
  if (!parsedUrl.protocol.startsWith('https') || !allowedHosts.includes(parsedUrl.hostname)) {
    throw new Error(`labelUrl must be an https URL from an allowed Boxful host`);
  }

  // 2. Download Boxful label PDF (with timeout)
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  let labelBytes;
  try {
    const labelRes = await fetch(labelUrl, { signal: ac.signal });
    if (!labelRes.ok) throw new Error(`Failed to download label: ${labelRes.status}`);
    labelBytes = Buffer.from(await labelRes.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }

  // 2. Extract delivery instructions from Boxful PDF comments
  const deliveryInstructions = await extractBoxfulComments(labelBytes);

  // 3. Load the Boxful PDF to embed
  const boxfulDoc = await PDFDocument.load(labelBytes);

  // 4. Create invoice document
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // 5. Draw watermark logo
  const logoDPath = loadLogoPath();
  if (logoDPath) {
    try {
      page.drawSvgPath(logoDPath, {
        x: width / 2 - (466 * 1.5) / 2,
        y: height / 2 + (232 * 1.5) / 2,
        scale: 1.5,
        color: rgb(0.88, 0.88, 0.88),
        opacity: 0.2,
      });
    } catch {
      /* ignore if path fails */
    }
  }

  // 6. Header: logo text "VoltiPod" top-left
  page.drawText(STORE_NAME, {
    x: 40,
    y: height - 55,
    size: 26,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Small logo icon SVG watermark (top left, small)
  if (logoDPath) {
    try {
      page.drawSvgPath(logoDPath, {
        x: 35,
        y: height - 30,
        scale: 0.12,
        color: rgb(0.15, 0.15, 0.85),
        opacity: 1,
      });
    } catch {
      /* ignore */
    }
  }

  // 7. Date/Pedido box (top-right)
  const boxX = width - 185;
  const boxY = height - 80;
  page.drawRectangle({ x: boxX, y: boxY, width: 160, height: 55, color: rgb(0.94, 0.94, 0.94) });
  page.drawText('Fecha', { x: boxX + 10, y: boxY + 35, size: 9, font: helveticaBold, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(formatDate(order.created_at), { x: boxX + 70, y: boxY + 35, size: 9, font: helvetica, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Pedido n°', { x: boxX + 10, y: boxY + 18, size: 9, font: helveticaBold, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(String(order.id), { x: boxX + 70, y: boxY + 18, size: 9, font: helvetica, color: rgb(0.1, 0.1, 0.1) });

  // 8. Store address line
  const addrY = height - 100;
  page.drawLine({ start: { x: 30, y: addrY }, end: { x: width - 30, y: addrY }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  page.drawText(`${STORE_ADDRESS}    ${STORE_PHONE}`, {
    x: 30,
    y: addrY - 16,
    size: 9,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });

  // 9. Customer info box
  const custBoxY = addrY - 95;
  const custBoxH = 80;
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

  // 10. Products table (left half: x 30–295)
  const tableTop = custBoxY - 15;
  const colX = [30, 70, 180, 240, 295];
  const tableHeaders = ['Cant', 'Descripción del Producto', 'Precio Unitario', 'Total'];

  // Table header bg
  page.drawRectangle({ x: 30, y: tableTop - 14, width: 265, height: 16, color: rgb(0.15, 0.15, 0.15) });
  tableHeaders.forEach((h, i) => {
    page.drawText(h, { x: colX[i] + 2, y: tableTop - 10, size: 7, font: helveticaBold, color: rgb(1, 1, 1) });
  });

  // Table rows
  const items = order.items || [];
  const maxRows = 5;
  let rowY = tableTop - 28;
  const rowH = 22;

  for (let i = 0; i < maxRows; i++) {
    const item = items[i];
    if (i > 0 || item) {
      page.drawLine({ start: { x: 30, y: rowY + rowH }, end: { x: 295, y: rowY + rowH }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
    }
    if (item) {
      page.drawText(String(item.qty), { x: colX[0] + 10, y: rowY + 8, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
      const name = (item.product_name || '').substring(0, 22);
      page.drawText(name, { x: colX[1] + 2, y: rowY + 8, size: 8, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(`$${Number(item.unit_price).toFixed(2)}`, { x: colX[2] + 2, y: rowY + 8, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(`$${Number(item.subtotal).toFixed(2)}`, { x: colX[3] + 2, y: rowY + 8, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
    }
    rowY -= rowH;
  }

  // Totals row
  page.drawRectangle({ x: 30, y: rowY, width: 265, height: rowH, color: rgb(0.95, 0.95, 0.95) });
  page.drawText('TOTALES', { x: colX[2] + 2, y: rowY + 8, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`$${Number(order.total).toFixed(2)}`, { x: colX[3] + 2, y: rowY + 8, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
  rowY -= rowH;

  // 11. Shipping details section (below table, left half)
  const detailsY = rowY - 10;
  page.drawRectangle({ x: 30, y: detailsY - 100, width: 265, height: 110, color: rgb(0.96, 0.96, 0.96) });
  page.drawText('DETALLES DEL ENVIO', { x: 38, y: detailsY - 8, size: 9, font: helveticaBold, color: rgb(0.15, 0.15, 0.15) });

  let detY = detailsY - 24;
  if (deliveryInstructions) {
    const instrLines = deliveryInstructions.match(/.{1,45}/g) || [deliveryInstructions];
    instrLines.slice(0, 2).forEach(line => {
      page.drawText(line, { x: 38, y: detY, size: 9, font: helvetica, color: rgb(0.25, 0.25, 0.25) });
      detY -= 14;
    });
  }
  if (formatPayment(order.payment_method)) {
    page.drawText(formatPayment(order.payment_method), { x: 38, y: detY, size: 9, font: helvetica, color: rgb(0.25, 0.25, 0.25) });
    detY -= 14;
  }
  page.drawText(`Encargado de entrega ${courierName}`, { x: 38, y: detY, size: 9, font: helvetica, color: rgb(0.25, 0.25, 0.25) });
  detY -= 18;
  page.drawText('LINK DE RASTREO', { x: 38, y: detY, size: 9, font: helveticaBold, color: rgb(0.15, 0.15, 0.15) });
  detY -= 14;
  page.drawText(trackingUrl, { x: 38, y: detY, size: 8, font: helvetica, color: rgb(0.1, 0.3, 0.8), maxWidth: 250 });

  // 12. Embed Boxful label on right half (x: 305–570), preserving aspect ratio
  try {
    const [embeddedPage] = await doc.embedPdf(boxfulDoc, [0]);
    const availW = 265;
    const availH = tableTop - (detailsY - 100) + 10;
    const { width: srcW, height: srcH } = embeddedPage.scale(1);
    const scale = Math.min(availW / srcW, availH / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    // Center horizontally in the right column
    const drawX = 305 + (availW - drawW) / 2;
    page.drawPage(embeddedPage, {
      x: drawX,
      y: detailsY - 100,
      width: drawW,
      height: drawH,
    });
  } catch {
    page.drawRectangle({ x: 305, y: detailsY - 100, width: 265, height: tableTop - (detailsY - 100) + 10, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
    page.drawText('Guía de envío adjunta', { x: 320, y: tableTop - 40, size: 10, font: helvetica, color: rgb(0.5, 0.5, 0.5) });
  }

  // 13. Footer
  page.drawText('¡Muchas Gracias!', {
    x: width / 2 - 55,
    y: 35,
    size: 14,
    font: helveticaBold,
    color: rgb(0.15, 0.15, 0.15),
  });

  // 14. Return as Buffer
  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
