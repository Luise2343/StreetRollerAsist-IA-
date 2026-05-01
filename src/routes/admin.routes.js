import { Router } from 'express';
import * as ctrl from '../controllers/tenant.controller.js';
import * as conv from '../controllers/conversations.controller.js';


const router = Router();

router.post('/tenants', ctrl.createTenant);
router.get('/tenants/:id', ctrl.getTenant);
router.patch('/tenants/:id', ctrl.updateTenant);
router.get('/tenants/:id/categories', ctrl.listCategories);
router.post('/tenants/:id/categories', ctrl.createCategory);
router.patch('/tenants/:id/categories/:slug', ctrl.updateCategory);

router.get('/metrics', conv.getMetrics);
router.get('/conversations', conv.listConversations);
router.get('/conversations/:waId/messages', conv.getMessages);
router.get('/conversations/:waId/profile', conv.getProfile);
router.get('/conversations/:waId/summary', conv.getSummary);
router.post('/conversations/:waId/takeover', conv.setTakeover);
router.post('/conversations/:waId/release', conv.releaseTakeover);
router.post('/conversations/:waId/send', conv.sendMessage);

export default router;
