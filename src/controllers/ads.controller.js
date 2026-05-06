import OpenAI from 'openai';
import { adMapRepository } from '../repositories/ad-map.repository.js';
import { logger } from '../config/logger.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateAdPrompt({ name, description, price }) {
  const content =
    `Genera un system prompt conciso para un agente de ventas de WhatsApp que atiende clientes ` +
    `que llegaron desde el anuncio de Meta: "${name}".\n` +
    `Producto: ${name}. Descripción: ${description ?? ''}. Precio: $${price ?? ''}.\n\n` +
    `El prompt debe:\n` +
    `- Abrir la conversación recomendando ese producto directamente\n` +
    `- Mantener la conversación centrada en ese producto\n` +
    `- Solo cambiar a otro producto si el cliente lo pide explícitamente\n` +
    `- Ser breve (máx 200 palabras)\n` +
    `- Incluir el precio en la respuesta inicial\n` +
    `- Estar en español`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    messages: [{ role: 'user', content }],
    max_tokens: 400
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
  const { ad_id, name, description, price } = req.body;

  if (!ad_id || !name) {
    return res.status(400).json({ ok: false, error: 'ad_id and name are required' });
  }

  logger.info({ tenantId, ad_id }, 'generating ad system prompt');
  const system_prompt = await generateAdPrompt({ name, description, price });

  const row = await adMapRepository.create(tenantId, { ad_id, name, description, price, system_prompt });
  res.status(201).json({ ok: true, data: row });
}

export async function updateAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const { regenerate_prompt, system_prompt, ...rest } = req.body;

  const fields = { ...rest };

  if (regenerate_prompt && !system_prompt) {
    const current = await adMapRepository.findAll(tenantId).then((rows) => rows.find((r) => r.id === id));
    if (!current) return res.status(404).json({ ok: false, error: 'not found' });
    const merged = { name: current.name, description: current.description, price: current.price, ...rest };
    logger.info({ tenantId, id }, 'regenerating ad system prompt');
    fields.system_prompt = await generateAdPrompt(merged);
  } else if (system_prompt !== undefined) {
    fields.system_prompt = system_prompt;
  }

  const row = await adMapRepository.update(tenantId, id, fields);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, data: row });
}

export async function deleteAd(req, res) {
  const tenantId = Number(req.params.tenantId);
  const id = Number(req.params.adId);
  const found = await adMapRepository.deactivate(tenantId, id);
  if (!found) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true });
}
