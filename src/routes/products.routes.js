import { Router } from 'express';
import * as ctrl from '../controllers/products.controller.js';

const router = Router();
router.get('/', ctrl.list);
router.post('/', ctrl.create);

export default router;
