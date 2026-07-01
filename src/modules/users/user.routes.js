const { Router } = require('express');
const { authMiddleware, requireRole } = require('../../middleware/auth.middleware');
const { success } = require('../../utils');
const { wrapController } = require('../../utils/errors');
const { UserRole } = require('../../constants');
const { addressBookWriteLimiter } = require('../../middleware/rate-limit.middleware');
const {
  inviteUser,
  listUsers,
  getUserById,
  updateUser,
  deactivateUser,
  resendInvite,
  reactivateUser,
  getWarehouse,
  updateWarehouse,
} = require('./user.controller');
const {
  createAddress,
  listAddresses,
  getAddressById,
  updateAddress,
  deleteAddress,
} = require('./address-book.controller');
const {
  getWarehouses,
  getWarehouseById,
  updateContact,
  createAddressChangeRequest,
  listMerchantRequests,
  listDistributorRequests,
  approveRequest,
  rejectRequest,
  cancelRequest,
} = require('./warehouse.controller');
const { syncWarehouseToVelocityService } = require('./user.service');
const { validateRequest } = require('../../validation');
const schemas = require('../../validation/schemas/users');
const { emptyObjectSchema } = require('../../validation/schemas/common/base.schemas');

const router = Router();

// All user management routes require a valid JWT.
router.use(authMiddleware);

// Rate limiter specific to address book write operations (create/update/delete) is now imported directly.


// ─── Address Book Routes ──────────────────────────────────────────────────────
// IMPORTANT: These static sub-routes MUST be registered BEFORE /:id to avoid
// Express treating "address-book" as an :id parameter value.

/**
 * @swagger
 * tags:
 *   name: Address Book
 *   description: Merchant address book management — save and reuse pickup/delivery addresses
 */

/**
 * @swagger
 * /users/address-book:
 *   post:
 *     summary: Create a new address book entry
 *     description: Creates a new saved address for the authenticated merchant. Only MERCHANT role can access this endpoint.
 *     tags: [Address Book]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone, addressLine, city, state, pincode]
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 100
 *                 example: "John Doe"
 *               phone:
 *                 type: string
 *                 pattern: "^[6-9]\\d{9}$"
 *                 example: "9876543210"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john@example.com"
 *               addressLine:
 *                 type: string
 *                 maxLength: 200
 *                 example: "123 Main Street, Near City Mall"
 *               city:
 *                 type: string
 *                 maxLength: 50
 *                 example: "Mumbai"
 *               state:
 *                 type: string
 *                 maxLength: 50
 *                 example: "Maharashtra"
 *               pincode:
 *                 type: string
 *                 pattern: "^\\d{6}$"
 *                 example: "400001"
 *               country:
 *                 type: string
 *                 default: "India"
 *                 example: "India"
 *               label:
 *                 type: string
 *                 enum: [Home, Office, Store, Warehouse, Customer, Other]
 *                 default: Other
 *                 example: "Store"
 *     responses:
 *       201:
 *         description: Address created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Address created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/AddressBook'
 *       400:
 *         description: Validation error — missing or invalid fields
 *       401:
 *         description: Unauthorized — missing or invalid JWT
 *       403:
 *         description: Forbidden — only MERCHANT role allowed, or merchant account inactive
 *       429:
 *         description: Rate limit exceeded
 */
router.post(
  '/address-book',
  requireRole(UserRole.MERCHANT),
  addressBookWriteLimiter,
  validateRequest({ body: schemas.createAddressSchema }),
  createAddress,
);

/**
 * @swagger
 * /users/address-book:
 *   get:
 *     summary: List all address book entries for the authenticated merchant
 *     description: Returns a paginated, filterable list of saved addresses. Sorted by recently used first (lastUsedAt DESC NULLS LAST, then createdAt DESC).
 *     tags: [Address Book]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number (1-indexed)
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: label
 *         schema:
 *           type: string
 *           enum: [Home, Office, Store, Warehouse, Customer, Other]
 *         description: Filter by address label
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *           maxLength: 100
 *         description: Search across name, phone, email, and city fields
 *     responses:
 *       200:
 *         description: Addresses retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Addresses retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     addresses:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/AddressBook'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — only MERCHANT role allowed
 */
router.get(
  '/address-book',
  requireRole(UserRole.MERCHANT),
  validateRequest({ query: schemas.listAddressQuerySchema }),
  listAddresses,
);

/**
 * @swagger
 * /users/address-book/{id}:
 *   get:
 *     summary: Get a single address book entry by ID
 *     description: Retrieves a specific saved address belonging to the authenticated merchant. Returns 404 if not found or already deleted.
 *     tags: [Address Book]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the address book entry
 *         example: "507f1f77bcf86cd799439012"
 *     responses:
 *       200:
 *         description: Address retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AddressBook'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Address not found or already deleted
 */
router.get(
  '/address-book/:id',
  requireRole(UserRole.MERCHANT),
  validateRequest({ params: schemas.addressIdParamsSchema }),
  getAddressById,
);

/**
 * @swagger
 * /users/address-book/{id}:
 *   put:
 *     summary: Update an address book entry
 *     description: Updates one or more fields of a saved address. All fields are optional (partial update). Returns the fully updated address document.
 *     tags: [Address Book]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the address book entry
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any subset of the create address fields
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 100
 *               phone:
 *                 type: string
 *                 pattern: "^[6-9]\\d{9}$"
 *               email:
 *                 type: string
 *                 format: email
 *               addressLine:
 *                 type: string
 *                 maxLength: 200
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               pincode:
 *                 type: string
 *                 pattern: "^\\d{6}$"
 *               country:
 *                 type: string
 *               label:
 *                 type: string
 *                 enum: [Home, Office, Store, Warehouse, Customer, Other]
 *     responses:
 *       200:
 *         description: Address updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AddressBook'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Address not found
 *       500:
 *         description: Internal server error — update failed
 */
router.put(
  '/address-book/:id',
  requireRole(UserRole.MERCHANT),
  addressBookWriteLimiter,
  validateRequest({ params: schemas.addressIdParamsSchema, body: schemas.updateAddressSchema }),
  updateAddress,
);

/**
 * @swagger
 * /users/address-book/{id}:
 *   delete:
 *     summary: Soft-delete an address book entry
 *     description: Marks the address as deleted by setting the deletedAt timestamp. The record is never permanently removed. Deleted addresses will not appear in list or get-by-id responses.
 *     tags: [Address Book]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the address book entry
 *     responses:
 *       200:
 *         description: Address deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Address deleted successfully"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Address not found or already deleted
 */
router.delete(
  '/address-book/:id',
  requireRole(UserRole.MERCHANT),
  addressBookWriteLimiter,
  validateRequest({ params: schemas.addressIdParamsSchema }),
  deleteAddress,
);

// ─── Warehouse Profile Management Routes ──────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Warehouse Profile Management
 *   description: Merchant warehouse profile viewing, contact update, and address change approval workflow
 */

/**
 * @swagger
 * /users/warehouses:
 *   get:
 *     summary: View all active warehouses for the authenticated merchant
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Warehouses retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  '/warehouses',
  requireRole(UserRole.MERCHANT),
  validateRequest({ query: emptyObjectSchema }),
  getWarehouses,
);

/**
 * @swagger
 * /users/warehouses/address-change-requests:
 *   get:
 *     summary: List warehouse address change requests for merchant
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED]
 *     responses:
 *       200:
 *         description: Requests retrieved successfully
 */
router.get(
  '/warehouses/address-change-requests',
  requireRole(UserRole.MERCHANT),
  validateRequest({ query: schemas.listRequestsQuerySchema }),
  listMerchantRequests,
);

/**
 * @swagger
 * /users/warehouses/address-change-requests/{requestId}/cancel:
 *   post:
 *     summary: Cancel a pending warehouse address change request
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Address change request cancelled
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Request not found
 *       409:
 *         description: Conflict — request already processed
 */
router.post(
  '/warehouses/address-change-requests/:requestId/cancel',
  requireRole(UserRole.MERCHANT),
  validateRequest({ params: schemas.requestIdParamsSchema }),
  cancelRequest,
);

/**
 * @swagger
 * /users/warehouses/{id}:
 *   get:
 *     summary: Get single warehouse details by ID
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Warehouse retrieved successfully
 *       403:
 *         description: Forbidden — warehouse does not belong to merchant
 *       404:
 *         description: Warehouse not found
 */
router.get(
  '/warehouses/:id',
  requireRole(UserRole.MERCHANT),
  validateRequest({ params: schemas.warehouseIdParamsSchema }),
  getWarehouseById,
);

/**
 * @swagger
 * /users/warehouses/{id}/contact:
 *   patch:
 *     summary: Immediately update warehouse contact information
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contactPerson:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contact information updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Warehouse not found
 */
router.patch(
  '/warehouses/:id/contact',
  requireRole(UserRole.MERCHANT),
  validateRequest({ params: schemas.warehouseIdParamsSchema, body: schemas.updateContactSchema }),
  updateContact,
);

/**
 * @swagger
 * /users/warehouses/{id}/address-change-request:
 *   post:
 *     summary: Submit a warehouse address change request for distributor approval
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressLine, city, state, pincode]
 *             properties:
 *               addressLine:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               pincode:
 *                 type: string
 *               country:
 *                 type: string
 *     responses:
 *       201:
 *         description: Address change request submitted successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Warehouse not found
 *       409:
 *         description: Conflict — pending request already exists
 */
router.post(
  '/warehouses/:id/address-change-request',
  requireRole(UserRole.MERCHANT),
  validateRequest({ params: schemas.warehouseIdParamsSchema, body: schemas.addressChangeRequestSchema }),
  createAddressChangeRequest,
);

/**
 * @swagger
 * /users/distributor/warehouse-change-requests:
 *   get:
 *     summary: List warehouse address change requests for distributor
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED]
 *     responses:
 *       200:
 *         description: Requests retrieved successfully
 */
router.get(
  '/distributor/warehouse-change-requests',
  requireRole(UserRole.DISTRIBUTOR),
  validateRequest({ query: schemas.listRequestsQuerySchema }),
  listDistributorRequests,
);

/**
 * @swagger
 * /users/distributor/warehouse-change-requests/{requestId}/approve:
 *   post:
 *     summary: Approve a warehouse address change request
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Address change request approved successfully
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Request not found
 *       409:
 *         description: Conflict — request already processed
 */
router.post(
  '/distributor/warehouse-change-requests/:requestId/approve',
  requireRole(UserRole.DISTRIBUTOR),
  validateRequest({ params: schemas.requestIdParamsSchema }),
  approveRequest,
);

/**
 * @swagger
 * /users/distributor/warehouse-change-requests/{requestId}/reject:
 *   post:
 *     summary: Reject a warehouse address change request with reason
 *     tags: [Warehouse Profile Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Address change request rejected
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Request not found
 *       409:
 *         description: Conflict — request already processed
 */
router.post(
  '/distributor/warehouse-change-requests/:requestId/reject',
  requireRole(UserRole.DISTRIBUTOR),
  validateRequest({ params: schemas.requestIdParamsSchema, body: schemas.rejectRequestSchema }),
  rejectRequest,
);

// ─── User Management Routes ───────────────────────────────────────────────────

// POST   /api/users/invite  — create an inactive user & send invite email
router.post('/invite', validateRequest({ body: schemas.inviteUserSchema }), inviteUser);

// GET    /api/users          — paginated, role-filtered user list
router.get('/', validateRequest({ query: schemas.listUsersQuerySchema }), listUsers);

// GET    /api/users/:id      — single user profile
router.get('/:id', validateRequest({ params: schemas.userIdParamsSchema }), getUserById);

// PATCH  /api/users/:id      — update allowed profile fields
router.patch('/:id', validateRequest({ params: schemas.userIdParamsSchema, body: schemas.updateUserSchema }), updateUser);

// DELETE /api/users/:id      — soft-deactivate a user
router.delete('/:id', validateRequest({ params: schemas.userIdParamsSchema }), deactivateUser);

// POST   /api/users/:id/resend-invite — regenerate + resend invite email
router.post('/:id/resend-invite', validateRequest({ params: schemas.userIdParamsSchema, body: emptyObjectSchema }), resendInvite);

// PATCH  /api/users/:id/reactivate — reactivate a user account
router.patch('/:id/reactivate', validateRequest({ params: schemas.userIdParamsSchema, body: emptyObjectSchema }), reactivateUser);

// POST /api/users/:id/sync-warehouse — Super Admin re-syncs a merchant warehouse to Velocity
router.post(
  '/:id/sync-warehouse',
  requireRole(UserRole.SUPER_ADMIN),
  validateRequest({ params: schemas.userIdParamsSchema, body: emptyObjectSchema }),
  wrapController(async (req, res) => {
    const result = await syncWarehouseToVelocityService(req.params.id, req.user);
    success(res, `Warehouse synced to Velocity: ${result.velocityWarehouseId}`, result);
  }),
);

// GET    /api/users/:id/warehouse — view merchant warehouse details
router.get('/:id/warehouse', validateRequest({ params: schemas.userIdParamsSchema }), getWarehouse);

// PATCH  /api/users/:id/warehouse — update merchant warehouse details
router.patch('/:id/warehouse', validateRequest({ params: schemas.userIdParamsSchema, body: schemas.updateWarehouseSchema }), updateWarehouse);

module.exports = router;
