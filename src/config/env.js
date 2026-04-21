// src/config/env.js
// Validates all environment variables at startup using Zod.
// The app will fail fast with a clear error if any required variable is missing.
import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform(v => v !== '0' && v !== 'false' && v !== 'off');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  PGSSLMODE: z.string().optional(),

  // WhatsApp (optional when each tenant has credentials in DB; fallback for send/markAsRead)
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),

  // Admin API (tenant / category CRUD)
  ADMIN_API_KEY: z.string().optional(),

  // Instagram
  IG_VERIFY_TOKEN: z.string().optional(),
  IG_ACCESS_TOKEN: z.string().optional(),
  IG_USER_ID: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_ENABLED: boolish.default('true'),
  AI_LANG: z.string().default('es'),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(120),

  // Context
  CTX_TURNS: z.coerce.number().int().positive().default(6),
  CTX_TTL_MIN: z.coerce.number().int().positive().default(120),

  // Summaries
  SUM_INACTIVITY_MIN: z.coerce.number().int().positive().default(180),
  SUM_MAX_MSGS: z.coerce.number().int().positive().default(120),
  SUM_SECOND_SWEEP_MIN: z.coerce.number().int().nonnegative().default(0),
  SUM_SWEEP_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
  SWEEP_MAX_WA: z.coerce.number().int().positive().default(10),
  SWEEP_MAX_ROUNDS: z.coerce.number().int().positive().default(5),

  // HTTP
  LOG_HTTP: boolish.default('true'),
  CORS_ORIGIN: z.string().default('*'),
  API_KEY: z.string().optional()
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`[env] Invalid environment variables:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
