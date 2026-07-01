const { Router } = require('express');
const { authMiddleware, requireRole } = require('../../middleware/auth.middleware');
const { UserRole } = require('../../constants');
const c = require('./dispute.controller');
const { validateRequest } = require('../../validation');
const schemas = require('../../validation/schemas/disputes');

const router = Router();
router.use(authMiddleware);

// Weight Disputes (Feature 9)
router.post('/weight-dispute', requireRole(UserRole.SUPER_ADMIN), validateRequest({ body: schemas.raiseWeightDisputeSchema }), c.raiseWeightDispute);
router.get('/weight-dispute', validateRequest({ query: schemas.listWeightDisputesQuerySchema }), c.listWeightDisputes);
router.patch('/weight-dispute/:id/resolve', requireRole(UserRole.SUPER_ADMIN), validateRequest({ params: schemas.disputeIdParamsSchema, body: schemas.resolveWeightDisputeSchema }), c.resolveWeightDispute);
router.patch('/weight-dispute/:id/proof', requireRole(UserRole.MERCHANT), validateRequest({ params: schemas.disputeIdParamsSchema, body: schemas.submitDisputeProofSchema }), c.submitDisputeProof);

// Standard Disputes
router.get('/', validateRequest({ query: schemas.listQuerySchema }), c.listDisputes);
router.post('/', validateRequest({ body: schemas.createDisputeSchema }), c.createDispute);
router.get('/:id', validateRequest({ params: schemas.disputeIdParamsSchema }), c.getDispute);
router.patch('/:id', validateRequest({ params: schemas.disputeIdParamsSchema, body: schemas.updateDisputeSchema }), c.updateDispute);

module.exports = router;
