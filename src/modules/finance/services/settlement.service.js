'use strict';

const { UserRole, TransactionType } = require('../../../constants');
const { paginate } = require('../../../utils/pagination');
const { runInTransaction } = require('../../../utils/transaction');
const financeRepository = require('../finance.repository');
const userRepository = require('../../users/user.repository');
const { applyTransaction } = require('./payment.service');

const { createNotification } = require('../../notifications/notification.service');
const { logAuditEvent } = require('../../audit/audit.service');

const listSettlementsService = async (query, caller) => {
  const filter = {};

  if (caller.role === UserRole.MERCHANT || caller.role === UserRole.WAREHOUSE) {
    filter.$or = [{ fromUserId: caller.userId }, { toUserId: caller.userId }];
  } else if (caller.role === UserRole.DISTRIBUTOR) {
    filter.$or = [{ fromUserId: caller.userId }, { toUserId: caller.userId }];
  }

  if (query.status) filter.status = query.status;

  const { limit, skip } = paginate(query);

  const [settlements, total] = await financeRepository.findSettlementsPaginated(filter, { skip, limit });
  return { items: settlements, total };
};

const createSettlementService = async (dto, caller) => {
  if (![UserRole.SUPER_ADMIN, UserRole.DISTRIBUTOR].includes(caller.role)) {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  }

  if (caller.userId.toString() === dto.toUserId.toString()) {
    throw Object.assign(new Error('Self-settlement is not allowed'), { statusCode: 400 });
  }

  const toUser = await userRepository.findOne({ _id: dto.toUserId, deletedAt: null });
  if (!toUser) throw Object.assign(new Error('Target user not found'), { statusCode: 404 });

  // Prevent duplicate pending settlements
  const duplicate = await financeRepository.findOneSettlement({
    fromUserId: caller.userId,
    toUserId: dto.toUserId,
    amount: dto.amount,
    status: 'PENDING',
  });
  if (duplicate) {
    throw Object.assign(new Error('A duplicate pending settlement request already exists'), { statusCode: 400 });
  }

  // Prevent circular pending settlements
  const circular = await financeRepository.findOneSettlement({
    fromUserId: dto.toUserId,
    toUserId: caller.userId,
    status: 'PENDING',
  });
  if (circular) {
    throw Object.assign(new Error('A circular pending settlement request exists from the target user. Please resolve it first.'), { statusCode: 400 });
  }

  const settlement = await financeRepository.createSettlement({
    fromUserId:  caller.userId,
    toUserId:    dto.toUserId,
    amount:      dto.amount,
    reference:   dto.reference || null,
    note:        dto.note || null,
    status:      'PENDING',
  });

  logAuditEvent(caller.userId, 'SETTLEMENT_CREATED', { toUserId: dto.toUserId, amount: dto.amount }, settlement._id);

  return settlement;
};

const processSettlementService = async (settlementId, dto, caller) => {
  if (caller.role !== UserRole.SUPER_ADMIN) {
    throw Object.assign(new Error('Only Super Admin can process settlements'), { statusCode: 403 });
  }

  const settlement = await financeRepository.findSettlementById(settlementId);
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { statusCode: 404 });
  if (settlement.status !== 'PENDING') {
    throw Object.assign(new Error(`Settlement is already ${settlement.status}`), { statusCode: 400 });
  }

  return runInTransaction(async (session) => {
    if (dto.success) {
      await applyTransaction(session, settlement.toUserId.toString(), TransactionType.SETTLEMENT, settlement.amount, {
        performedBy: caller.userId,
        reference:   settlement.reference || `SETTLE-${settlement._id}`,
        note:        dto.note || 'Settlement processed',
      });
    }

    settlement.status      = dto.success ? 'COMPLETED' : 'FAILED';
    settlement.processedAt = new Date();
    settlement.processedBy = caller.userId;
    settlement.note        = dto.note || settlement.note;
    await financeRepository.saveSettlement(settlement, { session });

    try {
      await createNotification(settlement.toUserId.toString(), {
        title: 'Settlement Processed',
        message: `Your settlement of ₹${settlement.amount.toFixed(2)} has been ${settlement.status.toLowerCase()}.`,
        type: 'PAYMENT',
      });
    } catch (notifErr) {
      console.error('[Settlement] Failed to dispatch process notification:', notifErr.message);
    }

    logAuditEvent(caller.userId, 'SETTLEMENT_PROCESSED', { success: dto.success, amount: settlement.amount, status: settlement.status }, settlement._id);

    return settlement;
  });
};

module.exports = {
  listSettlementsService,
  createSettlementService,
  processSettlementService,
};
