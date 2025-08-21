import { Router } from 'express';
import * as ctrl from '../controllers/inventory.controller.js';
const router = Router();

router.get('/', ctrl.list);
router.patch('/:productId/adjust', ctrl.adjust); // body: { delta }

export default router;
