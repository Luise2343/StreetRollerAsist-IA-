-- migrations/010_tenant_invoice_settings.sql
-- Adds per-tenant invoice formatting settings (store name/phone/address,
-- warranty text, return policy, footer message, shipping defaults, tax)
-- so each tenant can customize how their invoice PDF looks without code changes.

BEGIN;

ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS invoice_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Seed defaults for any tenant that doesn't have settings yet.
-- These mirror the values that were hardcoded in src/services/invoice.service.js.
UPDATE tenant
SET invoice_settings = jsonb_build_object(
  'store', jsonb_build_object(
    'name',    name,
    'address', 'Calle El Progreso, San Salvador',
    'phone',   '+503 7313 0634'
  ),
  'warranty', jsonb_build_object(
    'months',     12,
    'claim_text', 'WhatsApp +503 7313 0634 (presentar esta factura con N° de serie).',
    'exclusions', 'daño por mal uso, líquidos, modificaciones o impactos.'
  ),
  'return_policy', jsonb_build_array(
    'Cambios y devoluciones dentro de 30 días naturales desde la entrega.',
    'Producto en empaque original, sin uso y presentando esta factura.',
    'No aplica para artículos personalizados, consumibles o con S/N alterado.'
  ),
  'footer_message', '¡Gracias por tu compra!',
  'shipping', jsonb_build_object(
    'default_cost',    5.00,
    'courtesy_label',  'Cortesía ' || name,
    'show_courtesy',   true
  ),
  'tax', jsonb_build_object(
    'rate',  0.13,
    'label', 'IVA (13%)'
  ),
  'default_courier', 'XPRESS'
)
WHERE invoice_settings = '{}'::jsonb;

COMMIT;
