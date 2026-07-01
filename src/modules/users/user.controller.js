const {
  inviteUserService,
  listUsersService,
  getUserByIdService,
  updateUserService,
  deactivateUserService,
  resendInviteService,
  reactivateUserService,
  getWarehouseService,
  updateWarehouseService,
} = require('./user.service');
const { success, created, paginated } = require('../../utils');
const { wrapController } = require('../../utils/errors');
const { paginate } = require('../../utils/pagination');

const withErrorHandling = wrapController;

// ─── POST /api/users/invite ────────────────────────────────────────────────────
const inviteUser = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const user = await inviteUserService(dto, req.user);
  created(res, 'User invited successfully. An invite email has been sent.', user);
});

// ─── GET /api/users ────────────────────────────────────────────────────────────
const listUsers = withErrorHandling(async (req, res) => {
  const query = req.validated.query;
  const { page, limit } = paginate(query);
  const { items, total } = await listUsersService(query, req.user);
  return res.status(200).json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

// ─── GET /api/users/:id ────────────────────────────────────────────────────────
const getUserById = withErrorHandling(async (req, res) => {
  const user = await getUserByIdService(req.params.id, req.user);
  success(res, 'User retrieved successfully', user);
});

// ─── PATCH /api/users/:id ──────────────────────────────────────────────────────
const updateUser = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const user = await updateUserService(req.params.id, dto, req.user);
  success(res, 'User updated successfully', user);
});

// ─── DELETE /api/users/:id ─────────────────────────────────────────────────────
const deactivateUser = withErrorHandling(async (req, res) => {
  const result = await deactivateUserService(req.params.id, req.user);
  success(res, result.message);
});

// ─── POST /api/users/:id/resend-invite ──────────────────────────────────────────
const resendInvite = withErrorHandling(async (req, res) => {
  const result = await resendInviteService(req.params.id, req.user);
  success(res, result.message);
});

// ─── PATCH /api/users/:id/reactivate ─────────────────────────────────────────────
const reactivateUser = withErrorHandling(async (req, res) => {
  const user = await reactivateUserService(req.params.id, req.user);
  success(res, 'User reactivated successfully', user);
});

// ─── GET /api/users/:id/warehouse ───────────────────────────────────────────────
const getWarehouse = withErrorHandling(async (req, res) => {
  const warehouse = await getWarehouseService(req.params.id, req.user);
  success(res, 'Warehouse details retrieved successfully', warehouse);
});

// ─── PATCH /api/users/:id/warehouse ─────────────────────────────────────────────
const updateWarehouse = withErrorHandling(async (req, res) => {
  const dto = req.validated.body;
  const warehouse = await updateWarehouseService(req.params.id, dto, req.user);
  success(res, 'Warehouse updated successfully', warehouse);
});

module.exports = {
  inviteUser,
  listUsers,
  getUserById,
  updateUser,
  deactivateUser,
  resendInvite,
  reactivateUser,
  getWarehouse,
  updateWarehouse,
};
