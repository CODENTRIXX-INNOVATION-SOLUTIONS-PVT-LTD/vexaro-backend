'use strict';

const { UserRole, TransactionType } = require('../../../constants');
const { paginate } = require('../../../utils/pagination');
const { runInTransaction } = require('../../../utils/transaction');
const financeRepository = require('../finance.repository');
const userRepository = require('../../users/user.repository');
const { applyTransaction } = require('./payment.service');
const { createNotification } = require('../../notifications/notification.service');

const createWalletService = async (userId, session = null) => {
  const existing = await financeRepository.findWalletByUserId(userId, session);
  if (existing) return existing;
  return financeRepository.createWallet({ userId, balance: 0 }, session);
};

const getMyWalletService = async (caller) => {
  const wallet = await financeRepository.findWalletByUserId(caller.userId);
  if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404 });
  return wallet;
};

const listWalletsService = async (query, caller) => {
  let userIds;
  if (caller.role === UserRole.SUPER_ADMIN) {
    const users = await userRepository.findAll({ deletedAt: null, role: { $in: [UserRole.DISTRIBUTOR, UserRole.MERCHANT] } }, '_id');
    userIds = users.map(u => u._id);
  } else if (caller.role === UserRole.DISTRIBUTOR) {
    const users = await userRepository.findAll({ invitedBy: caller.userId, deletedAt: null }, '_id');
    userIds = users.map(u => u._id);
  } else {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  }

  const { limit, skip } = paginate(query);
  const filter = { userId: { $in: userIds } };

  const [wallets, total] = await financeRepository.findWalletsPaginated(filter, { skip, limit });
  return { items: wallets, total };
};

const topupWalletService = async (dto, caller) => {
  const { userId: targetUserId, amount, note } = dto;

  const targetUser = await userRepository.findOne({ _id: targetUserId, deletedAt: null });
  if (!targetUser) throw Object.assign(new Error('User not found'), { statusCode: 404 });

  if (caller.role === UserRole.DISTRIBUTOR) {
    if (targetUser.role !== UserRole.MERCHANT || targetUser.invitedBy?.toString() !== caller.userId) {
      throw Object.assign(new Error('You can only top up wallets of your own merchants'), { statusCode: 403 });
    }
  } else if (caller.role !== UserRole.SUPER_ADMIN) {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  }

  return runInTransaction(async (session) => {
    const { wallet, transaction } = await applyTransaction(session, targetUserId, TransactionType.TOPUP, amount, {
      performedBy: caller.userId,
      note: note || `Wallet top-up by ${caller.role}`,
      reference: `TOPUP-${Date.now()}`,
    });
    return { wallet, transaction };
  });
};

const transferToMerchantService = async (dto, caller) => {
  const { merchantId, amount, note } = dto;

  if (caller.role !== UserRole.DISTRIBUTOR) {
    throw Object.assign(new Error('Access denied. Only distributors can transfer funds to merchants.'), { statusCode: 403 });
  }

  const merchant = await userRepository.findOne({ _id: merchantId, deletedAt: null });
  if (!merchant) {
    throw Object.assign(new Error('Merchant not found'), { statusCode: 404 });
  }
  if (merchant.role !== UserRole.MERCHANT) {
    throw Object.assign(new Error('Target user is not a merchant'), { statusCode: 400 });
  }
  if (!merchant.invitedBy || merchant.invitedBy.toString() !== caller.userId.toString()) {
    throw Object.assign(new Error('Access denied. You can only transfer funds to your own merchants.'), { statusCode: 403 });
  }

  return runInTransaction(async (session) => {
    const reference = `TXFR-${Date.now()}`;

    const distributorResult = await applyTransaction(session, caller.userId, TransactionType.TRANSFER_DEBIT, amount, {
      performedBy: caller.userId,
      reference,
      note: note || `Transfer to merchant ${merchant.email}`,
    });

    const merchantResult = await applyTransaction(session, merchantId, TransactionType.TRANSFER_CREDIT, amount, {
      performedBy: caller.userId,
      reference,
      note: note || `Transfer from distributor ${caller.email}`,
    });

    try {
      await createNotification(caller.userId, {
        title: 'Wallet Transfer Sent',
        message: `You transferred ₹${amount.toFixed(2)} to merchant ${merchant.fullName || merchant.email}.`,
        type: 'PAYMENT',
      });
      await createNotification(merchantId, {
        title: 'Wallet Funds Received',
        message: `You received ₹${amount.toFixed(2)} from distributor ${caller.email}.`,
        type: 'PAYMENT',
      });
    } catch (notifErr) {
      console.error('Failed to create transfer notifications:', notifErr);
    }

    return {
      distributorWallet: distributorResult.wallet,
      merchantWallet: merchantResult.wallet,
      reference,
    };
  });
};

module.exports = {
  createWalletService,
  getMyWalletService,
  listWalletsService,
  topupWalletService,
  transferToMerchantService,
};
