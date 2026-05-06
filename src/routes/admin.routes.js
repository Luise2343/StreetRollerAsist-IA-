import { Router } from 'express';
import * as ctrl from '../controllers/tenant.controller.js';
import * as conv from '../controllers/conversations.controller.js';
import * as ads from '../controllers/ads.controller.js';

const router = Router();

router.post('/tenants', ctrl.createTenant);
router.get('/tenants/:id', ctrl.getTenant);
router.patch('/tenants/:id', ctrl.updateTenant);
router.get('/tenants/:id/categories', ctrl.listCategories);
router.post('/tenants/:id/categories', ctrl.createCategory);
router.patch('/tenants/:id/categories/:slug', ctrl.updateCategory);

router.get('/tenants/:tenantId/products', ads.listProducts);
router.get('/tenants/:tenantId/ads', ads.listAds);
router.post('/tenants/:tenantId/ads', ads.createAd);
router.patch('/tenants/:tenantId/ads/:adId', ads.updateAd);
router.delete('/tenants/:tenantId/ads/:adId', ads.deleteAd);

router.get('/metrics', conv.getMetrics);
router.get('/events', conv.sseGlobalStream);
router.get('/conversations', conv.listConversations);
router.get('/conversations/:waId/events', conv.sseConvStream);
router.get('/conversations/:waId/messages', conv.getMessages);
router.get('/conversations/:waId/profile', conv.getProfile);
router.get('/conversations/:waId/summary', conv.getSummary);
router.post('/conversations/:waId/takeover', conv.setTakeover);
router.post('/conversations/:waId/release', conv.releaseTakeover);
router.post('/conversations/:waId/send', conv.sendMessage);

export default router;
