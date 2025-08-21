import { Router } from 'express';
import { pool } from '../config/db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const t0 = Date.now();
  let db = 'ok';
  try {
    await pool.query('SELECT 1');  // ping DB
  } catch {
    db = 'down';
  }

  const inactMin = Number(process.env.SUM_INACTIVITY_MIN || process.env.CTX_TTL_MIN || 180);
  // mensajes candidatos a resumen (más viejos que el umbral de inactividad)
  let pending = 0;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS pending
         FROM public.wa_message
        WHERE created_at < now() - ($1 || ' minutes')::interval`,
      [inactMin]
    );
    pending = rows?.[0]?.pending ?? 0;
  } catch { /* noop */ }

  res.json({
    ok: db === 'ok',
    db,
    pending_to_summarize: pending,
    uptime_sec: Math.round(process.uptime()),
    ts: new Date().toISOString(),
    dur_ms: Date.now() - t0
  });
});

export default router;
