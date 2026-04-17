import { Router } from 'express';
import * as ctrl from '../controllers/tenant.controller.js';

const router = Router();

router.post('/tenants', ctrl.createTenant);
router.get('/tenants/:id', ctrl.getTenant);
router.patch('/tenants/:id', ctrl.updateTenant);
router.get('/tenants/:id/categories', ctrl.listCategories);
router.post('/tenants/:id/categories', ctrl.createCategory);
router.patch('/tenants/:id/categories/:slug', ctrl.updateCategory);

export default router;
