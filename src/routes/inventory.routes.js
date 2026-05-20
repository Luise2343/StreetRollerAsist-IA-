import { Router } from 'express';
import * as ctrl from '../controllers/inventory.controller.js';
const router = Router();

router.get('/', ctrl.list);
router.get('/low-stock', ctrl.lowStock);
router.get('/movements', ctrl.listMovements);
router.post('/bulk-adjust', ctrl.bulkAdjust);
router.get('/:productId/movements', ctrl.listProductMovements);
router.patch('/:productId/threshold', ctrl.setThreshold);
router.patch('/:productId/adjust', ctrl.adjust);

export default router;
