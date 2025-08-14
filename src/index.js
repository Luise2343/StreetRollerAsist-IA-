import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ping } from './config/db.js';
import whatsappWebhook from './routes/whatsaap.webhook.js';
import products from './routes/products.routes.js';
import customers from './routes/customers.routes.js';
import orders from './routes/orders.routes.js';
import payments from './routes/payments.routes.js';
import inventory from './routes/inventory.routes.js';

const app = express();
app.use(cors());
app.use(express.json());

// health
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/health/db', async (_req, res) => {
  try { res.json({ ok: true, db: await ping() }); }
  catch { res.status(500).json({ ok:false, error:'DB down' }); }
});

// rutas
app.use('/api/products', products);
app.use('/api/customers', customers);
app.use('/api/orders', orders);
app.use('/api/payments', payments);
app.use('/api/inventory', inventory);
app.use('/webhooks/whatsapp', whatsappWebhook);
console.log('Mounted: GET/POST /webhooks/whatsapp');

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`API ready on http://localhost:${port}`));
