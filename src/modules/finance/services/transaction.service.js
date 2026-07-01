'use strict';

const { UserRole } = require('../../../constants');
const { paginate } = require('../../../utils/pagination');
const financeRepository = require('../finance.repository');
const userRepository = require('../../users/user.repository');

const listTransactionsService = async (query, caller) => {
  let userId = caller.userId;

  if (query.userId && caller.role === UserRole.SUPER_ADMIN) {
    userId = query.userId;
  } else if (query.userId && caller.role === UserRole.DISTRIBUTOR) {
    const user = await userRepository.findOne({ _id: query.userId, invitedBy: caller.userId, deletedAt: null });
    if (!user) throw Object.assign(new Error('User not found or not in your scope'), { statusCode: 403 });
    userId = query.userId;
  }

  const { limit, skip } = paginate(query);

  const filter = { userId };
  if (query.type) filter.type = query.type;
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo)   filter.createdAt.$lte = new Date(query.dateTo);
  }

  const [transactions, total] = await financeRepository.findTransactionsPaginated(filter, { skip, limit });
  return { items: transactions, total };
};

module.exports = {
  listTransactionsService,
};
