// src/app.js
// Express app factory — separated from server startup so it can be used in tests.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ping } from './config/db.js';
import { logger } from './config/logger.js';
import whatsappWebhook from './routes/whatsapp.webhook.js';
import products from './routes/products.routes.js';
import customers from './routes/customers.routes.js';
import orders from './routes/orders.routes.js';
import payments from './routes/payments.routes.js';
import inventory from './routes/inventory.routes.js';
import morgan from 'morgan';
import healthRouter from './routes/health.routes.js';
import instagramWebhook from './routes/instagram.webhook.js';
import { requireApiKey } from './middleware/auth.js';
import { requireAdmin } from './middleware/admin-auth.js';
import adminRoutes from './routes/admin.routes.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

if (process.env.LOG_HTTP !== '0' && process.env.LOG_HTTP !== 'false') {
  app.use(morgan('tiny'));
}

const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later.' }
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests.' }
});

app.use(healthRouter);

app.get('/privacy', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Política de Privacidad — VoltiPod</title><style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333}h1{color:#1a1a1a}</style></head><body>
<h1>Política de Privacidad</h1>
<p><strong>VoltiPod</strong> utiliza un agente de WhatsApp para atender consultas de clientes sobre productos y servicios.</p>
<h2>Datos que recopilamos</h2>
<ul><li>Número de teléfono de WhatsApp</li><li>Mensajes enviados al agente</li><li>Nombre de perfil de WhatsApp (si está disponible)</li></ul>
<h2>Uso de los datos</h2>
<p>Los datos se usan exclusivamente para responder consultas y mejorar el servicio. No se comparten con terceros.</p>
<h2>Retención</h2>
<p>Los mensajes se conservan por un máximo de 90 días para contexto de conversación.</p>
<h2>Contacto</h2>
<p>Para consultas sobre privacidad: <a href="mailto:velaskkia@gmail.com">velaskkia@gmail.com</a></p>
</body></html>`);
});

app.get('/delete-data', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Eliminación de datos — VoltiPod</title><style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333}h1{color:#1a1a1a}</style></head><body>
<h1>Solicitud de eliminación de datos</h1>
<p>Para solicitar la eliminación de tus datos del sistema de VoltiPod, envía un correo a <a href="mailto:velaskkia@gmail.com">velaskkia@gmail.com</a> con el asunto <strong>"Eliminar mis datos"</strong> e indica tu número de WhatsApp.</p>
<p>Procesaremos tu solicitud en un plazo máximo de 30 días.</p>
</body></html>`);
});

app.get('/terms', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Condiciones del Servicio — VoltiPod</title><style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333}h1{color:#1a1a1a}</style></head><body>
<h1>Condiciones del Servicio</h1>
<p>Al interactuar con el agente de WhatsApp de <strong>VoltiPod</strong>, aceptas las siguientes condiciones:</p>
<h2>Uso del servicio</h2>
<ul><li>El agente está disponible para consultas sobre productos, precios y disponibilidad.</li><li>Las respuestas son orientativas; los precios y stock pueden variar.</li><li>VoltiPod se reserva el derecho de modificar o discontinuar el servicio en cualquier momento.</li></ul>
<h2>Responsabilidad</h2>
<p>VoltiPod no se responsabiliza por decisiones tomadas con base exclusiva en las respuestas del agente. Para compras formales, comunícate directamente con nuestro equipo.</p>
<h2>Contacto</h2>
<p><a href="mailto:velaskkia@gmail.com">velaskkia@gmail.com</a></p>
</body></html>`);
});

app.get('/health/db', async (_req, res) => {
  try {
    res.json({ ok: true, db: await ping() });
  } catch {
    res.status(500).json({ ok: false, error: 'DB down' });
  }
});

app.use('/webhooks/instagram', webhookLimiter, instagramWebhook);
app.use('/webhooks/whatsapp', webhookLimiter, whatsappWebhook);

app.use('/admin', apiLimiter, requireAdmin, adminRoutes);

app.use('/api', apiLimiter, requireApiKey);
app.use('/api/products', products);
app.use('/api/customers', customers);
app.use('/api/orders', orders);
app.use('/api/payments', payments);
app.use('/api/inventory', inventory);

// Global error handler
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error';
  logger.error({ err }, 'Unhandled error');
  res.status(status).json({ ok: false, error: message });
});

export default app;
