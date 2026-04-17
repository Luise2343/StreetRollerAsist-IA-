import 'dotenv/config';
import './config/env.js'; // validate env vars at startup — fail fast
import { logger } from './config/logger.js';
import { startSecondSweepScheduler } from './services/second-sweep.js';
import app from './app.js';

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  logger.info(`API ready on http://localhost:${port}`);
  startSecondSweepScheduler();
});
