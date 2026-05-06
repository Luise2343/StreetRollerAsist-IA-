import OpenAI from 'openai';
import { pool } from '../config/db.js';
import { adMapRepository } from '../repositories/ad-map.repository.js';
import { logger } from '../config/logger.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function fetchProductsForAd(tenantId, { name, description, category }) {
  // Busca productos por categoría si se indica, o full-text sobre nombre/descripción del anuncio
  const searchTerms = [name, description, category].filter(Boolean).join(' ');
  const { rows } = await pool.query(
    `SELECT p.name, p.description, p.base_price, p.brand, p.specs, p.category
     FROM product p
     WHERE p.tenant_id = $1 AND p.active = true
       AND (
         p.category = $2
         OR to_tsvector('spanish', coalesce(p.name,'') || ' ' || coalesce(p.description,''))
            @@ plainto_tsquery('spanish', $3)
       )
     ORDER BY p.base_price ASC
     LIMIT 8`,
    [tenantId, category ?? '', searchTerms]
  );
  return rows;
}

async function generateAdPrompt({ tenantId, name, description, price, category }) {
  const products = await fetchProductsForAd(tenantId, { name, description, category });

  const productLines = products.length
    ? products.map(p => {
        const precio = p.base_price != null ? `$${Number(p.base_price).toFixed(2)}` : 'precio a consultar';
        const specs = p.specs && Object.keys(p.specs).length
          ? ' (' + Object.entries(p.specs).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(', ') + ')'
          : '';
        return `${precio} → ${p.name}${specs}`;
      }).join('\n')
    : price
      ? `$${price} → ${name}${description ? ` (${description})` : ''}`
      : `${name}${description ? ` — ${description}` : ''}`;

  const content = `Eres un experto en redactar system prompts para agentes de ventas de WhatsApp.

Genera un system prompt para el agente de VoltiPod que atenderá clientes que llegaron desde el anuncio de Meta: "${name}".

PRODUCTOS DEL ANUNCIO (con precios y specs reales):
${productLines}

El system prompt que generes DEBE seguir exactamente esta estructura (6 secciones numeradas):

0. REGLA CRÍTICA — LONGITUD
Máximo 280 caracteres por mensaje. Texto plano, sin asteriscos ni guiones. Saltos de línea simples.

1. IDENTIDAD
Eres el agente de ventas de VoltiPod. El cliente llegó desde un anuncio de [tema del anuncio]. Habla en español, trata a las personas de "usted", tono cálido y consultivo.

2. CONTEXTO DEL ANUNCIO
Lista los productos con precio → nombre y specs clave. Si el cliente no menciona precio, pregunta cuál le llamó la atención.

3. FLUJO DE VENTA
1) Confirmar el producto con una frase corta.
2) Una sola pregunta de uso relevante para esos productos.
3) Precio + garantía 3 meses + envío gratis a todo El Salvador.
4) Pregunta de cierre: ¿Lo procesamos?
5) Solicitar: nombre completo / teléfono / dirección con referencia / método de pago.
6) Llamar notify_owner con reason='ready_to_buy' en cuanto tenga los 4 datos.

4. PAGO Y ENTREGA
Contra entrega o transferencia (Bancoagrícola, LUIS VELASCO, Cuenta de Ahorro 3670383795).
Si transfiere: compartir datos bancarios y pedir comprobante.
Entrega: 2-3 días hábiles. San Salvador: mismo día (2-3 horas).

5. ESCALACIÓN
Llamar notify_owner con reason apropiado si:
- Comprobante de pago recibido → reason='ready_to_buy'
- Reclamo post-venta → reason='complaint'
- Cliente pide hablar con humano → reason='other'
Responder: "Permítame un momento, voy a coordinar con mi compañero. Lo retomamos en breve."

6. REGLAS DURAS
No inventar specs ni precios. No prometer descuentos. No usar mayúsculas para enfatizar. Máximo 5 ítems en listas. No compartir datos bancarios hasta que el cliente confirme transferencia.

Devuelve SOLO el texto del system prompt, con las 6 secciones numeradas. Usa los productos y precios reales indicados arriba. No agregues introducción ni explicación.`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    messages: [{ role: 'user', content }],
    max_tokens: 900,
    temperature: 0.3
  });
  return completion.choices[0].message.content.trim();
}

export async function listAds(req, res) {
  const tenantId = Number(req.params.tenantId);
  const rows = await adMapRepository.findAll(tenantId);
  res.json({ ok: true, data: rows });
}

export async function createAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const { ad_id, name, description, price, category } = req.body;

  if (!ad_id || !name) {
    return res.status(400).json({ ok: false, error: 'ad_id y name son requeridos' });
  }

  logger.info({ tenantId, ad_id }, 'generating ad system prompt');
  const system_prompt = await generateAdPrompt({ tenantId, name, description, price, category });

  const row = await adMapRepository.create(tenantId, { ad_id, name, description, price, system_prompt });
  res.status(201).json({ ok: true, data: row });
}

export async function updateAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const { regenerate_prompt, system_prompt, ...rest } = req.body;

  const fields = { ...rest };

  if (regenerate_prompt && !system_prompt) {
    const current = await adMapRepository.findAll(tenantId).then(rows => rows.find(r => r.id === id));
    if (!current) return res.status(404).json({ ok: false, error: 'Anuncio no encontrado' });
    const merged = { name: current.name, description: current.description, price: current.price, ...rest };
    logger.info({ tenantId, id }, 'regenerating ad system prompt');
    fields.system_prompt = await generateAdPrompt({ tenantId, ...merged });
  } else if (system_prompt !== undefined) {
    fields.system_prompt = system_prompt;
  }

  const row = await adMapRepository.update(tenantId, id, fields);
  if (!row) return res.status(404).json({ ok: false, error: 'Anuncio no encontrado' });
  res.json({ ok: true, data: row });
}

export async function deleteAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const found = await adMapRepository.deactivate(tenantId, id);
  if (!found) return res.status(404).json({ ok: false, error: 'Anuncio no encontrado' });
  res.json({ ok: true });
}
