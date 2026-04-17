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

app.use(helmet());

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

if (process.env.LOG_HTTP !== '0' && process.env.LOG_HTTP !== 'false') {
  app.use(morgan('tiny'));
}

const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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

app.get('/health/db', async (_req, res) => {
  try { res.json({ ok: true, db: await ping() }); }
  catch { res.status(500).json({ ok: false, error: 'DB down' }); }
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
