// src/config/logger.js
// Structured JSON logger using pino.
// In development uses pino-pretty for human-readable output.
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: { service: 'streetroller-agent' },
    timestamp: pino.stdTimeFunctions.isoTime
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' }
      })
    : undefined
);
