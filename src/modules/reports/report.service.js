'use strict';

const { UserRole, ShipmentStatus } = require('../../constants');
const { remember, TTL, KEYS } = require('../../utils/cache');
const crypto = require('crypto');

const reportRepository = require('./report.repository');

// ── Stable hash of query params for cache key (MD5 first 8 chars is plenty) ──
const hashQuery = (query) =>
  crypto.createHash('md5').update(JSON.stringify(query)).digest('hex').slice(0, 8);

// ─── Scope filter builder (reused across all report types) ────────────────────
const buildScope = (caller, query = {}) => {
  const f = { deletedAt: null };
  if (caller.role === UserRole.MERCHANT)     f.merchantId    = caller.userId;
  else if (caller.role === UserRole.DISTRIBUTOR) f.distributorId = caller.userId;
  else if (caller.role === UserRole.WAREHOUSE)   f.warehouseId   = caller.userId;

  if (caller.role === UserRole.SUPER_ADMIN) {
    if (query.merchantId)    f.merchantId    = query.merchantId;
    if (query.distributorId) f.distributorId = query.distributorId;
  }

  if (query.dateFrom || query.dateTo) {
    f.createdAt = {};
    if (query.dateFrom) f.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo)   f.createdAt.$lte = new Date(query.dateTo);
  }
  return f;
};

// ─── Shipment Report ──────────────────────────────────────────────────────────
// GET /api/reports/shipments
const shipmentReportService = async (query, caller) => {
  const cacheKey = KEYS.report('shipments', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    const filter = buildScope(caller, query);

    const [totals, byStatus, byService, dailyVolume, dailyStatusTrends] = await Promise.all([
      // Overall totals
      reportRepository.aggregateShipments([
        { $match: filter },
        { $group: {
          _id:          null,
          totalCount:   { $sum: 1 },
          totalWeight:  { $sum: '$weight' },
          totalCOD:     { $sum: { $cond: ['$isCOD', '$codAmount', 0] } },
          totalDeclared:{ $sum: '$declaredValue' },
          totalRevenue: { $sum: '$merchantCost' },
          vexaroProfit: { $sum: '$vexaroProfit' },
          distributorProfit: { $sum: '$distributorProfit' },
          codCollected: { $sum: '$codCollected' },
          codPayouts: { $sum: { $cond: [{ $eq: ['$codStatus', 'REMITTED'] }, '$codAmount', 0] } },
        }},
      ]),

      // By status
      reportRepository.aggregateShipments([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),

      // By service type
      reportRepository.aggregateShipments([
        { $match: filter },
        { $group: { _id: '$serviceType', count: { $sum: 1 } } },
      ]),

      // Daily volume (last 30 days)
      reportRepository.aggregateShipments([
        { $match: { ...filter, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),

      // Daily status trends (last 7 days) - for line chart
      reportRepository.aggregateShipments([
        { $match: { ...filter, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            status: '$status'
          },
          count: { $sum: 1 }
        }},
        { $sort: { '_id.date': 1 } },
      ]),
    ]);

    const statusMap = byStatus.reduce((a, s) => { a[s._id] = s.count; return a; }, {});
    const deliveryRate = totals[0]?.totalCount
      ? (((statusMap[ShipmentStatus.DELIVERED] || 0) / totals[0].totalCount) * 100).toFixed(2)
      : '0.00';

    return {
      summary: {
        ...(totals[0] || { totalCount: 0, totalWeight: 0, totalCOD: 0, totalDeclared: 0, totalRevenue: 0, vexaroProfit: 0, distributorProfit: 0, codCollected: 0, codPayouts: 0 }),
        deliveryRate: `${deliveryRate}%`,
      },
      byStatus: statusMap,
      byService: byService.reduce((a, s) => { a[s._id] = s.count; return a; }, {}),
      dailyVolume,
      dailyStatusTrends,
    };
  }); // end remember
};

// ─── Revenue Report ───────────────────────────────────────────────────────────
// GET /api/reports/revenue
const revenueReportService = async (query, caller) => {
  const cacheKey = KEYS.report('revenue', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    const userFilter = { userId: caller.userId };
    if (caller.role === UserRole.SUPER_ADMIN && query.userId) userFilter.userId = query.userId;

    const dateFilter = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.createdAt = {};
      if (query.dateFrom) dateFilter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo)   dateFilter.createdAt.$lte = new Date(query.dateTo);
    }

    const [summary, byType, monthly] = await Promise.all([
      reportRepository.aggregateTransactions([
        { $match: { ...userFilter, ...dateFilter } },
        { $group: {
          _id:          null,
          totalCredits: { $sum: { $cond: [{ $in: ['$type', ['CREDIT', 'TOPUP', 'COD_CREDIT', 'REFUND', 'SETTLEMENT', 'TRANSFER_CREDIT']] }, '$amount', 0] } },
          totalDebits:  { $sum: { $cond: [{ $in: ['$type', ['DEBIT', 'CHARGE', 'TRANSFER_DEBIT', 'DISPUTE_CHARGE', 'RTO_CHARGE']] }, '$amount', 0] } },
          totalDisputes: { $sum: { $cond: [{ $eq: ['$type', 'DISPUTE_CHARGE'] }, '$amount', 0] } },
          totalRTOCharges: { $sum: { $cond: [{ $eq: ['$type', 'RTO_CHARGE'] }, '$amount', 0] } },
          txCount:      { $sum: 1 },
        }},
      ]),
      reportRepository.aggregateTransactions([
        { $match: { ...userFilter, ...dateFilter } },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort:  { total: -1 } },
      ]),
      reportRepository.aggregateTransactions([
        { $match: { ...userFilter, ...dateFilter } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          credits: { $sum: { $cond: [{ $in: ['$type', ['CREDIT', 'TOPUP', 'COD_CREDIT', 'REFUND', 'SETTLEMENT', 'TRANSFER_CREDIT']] }, '$amount', 0] } },
          debits:  { $sum: { $cond: [{ $in: ['$type', ['DEBIT', 'CHARGE', 'TRANSFER_DEBIT', 'DISPUTE_CHARGE', 'RTO_CHARGE']] }, '$amount', 0] } },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      summary: summary[0] || { totalCredits: 0, totalDebits: 0, totalDisputes: 0, totalRTOCharges: 0, txCount: 0 },
      byType:  byType.reduce((a, t) => { a[t._id] = { total: t.total, count: t.count }; return a; }, {}),
      monthly,
    };
  }); // end remember
};

// ─── Merchant Revenue Report (SA / Distributor only) ─────────────────────────
// GET /api/reports/merchant-revenue
const merchantRevenueReportService = async (query, caller) => {
  const cacheKey = KEYS.report('merchant-revenue', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    if (![UserRole.SUPER_ADMIN, UserRole.DISTRIBUTOR].includes(caller.role)) {
      throw Object.assign(new Error('Access denied'), { statusCode: 403 });
    }

    const userMatch = caller.role === UserRole.DISTRIBUTOR
      ? { invitedBy: caller.userId, role: UserRole.MERCHANT, deletedAt: null }
      : { role: UserRole.MERCHANT, deletedAt: null };

    const merchants = await reportRepository.findUsers(userMatch, '_id firstName lastName email companyName');
    const merchantIds = merchants.map(m => m._id.toString());

    const dateFilter = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.createdAt = {};
      if (query.dateFrom) dateFilter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo)   dateFilter.createdAt.$lte = new Date(query.dateTo);
    }

    const shipmentStats = await reportRepository.aggregateShipments([
      { $match: { merchantId: { $in: merchants.map(m => m._id) }, deletedAt: null, ...dateFilter } },
      { $group: {
        _id:       '$merchantId',
        total:     { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', ShipmentStatus.DELIVERED] }, 1, 0] } },
        failed:    { $sum: { $cond: [{ $in:  ['$status', [ShipmentStatus.DELIVERY_FAILED, ShipmentStatus.RTO]] }, 1, 0] } },
        codTotal:  { $sum: { $cond: ['$isCOD', '$codAmount', 0] } },
      }},
    ]);

    const statsMap = shipmentStats.reduce((a, s) => { a[s._id.toString()] = s; return a; }, {});

    return merchants.map(m => ({
      merchant: { id: m._id, firstName: m.firstName, lastName: m.lastName, email: m.email, companyName: m.companyName },
      shipments: statsMap[m._id.toString()] || { total: 0, delivered: 0, failed: 0, codTotal: 0 },
    }));
  }); // end remember
};

// ─── Performance Analytics (SA / Distributor) ─────────────────────────────────
// GET /api/reports/performance
const performanceReportService = async (query, caller) => {
  const cacheKey = KEYS.report('performance', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    const filter = buildScope(caller, query);

    const [deliveryTimes, statusTrend] = await Promise.all([
      // Average delivery time (hours from CREATED → DELIVERED)
      reportRepository.aggregateShipments([
        { $match: { ...filter, status: ShipmentStatus.DELIVERED, deliveredAt: { $ne: null } } },
        { $project: {
          deliveryHours: { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 3600000] },
        }},
        { $group: {
          _id:   null,
          avgHours: { $avg: '$deliveryHours' },
          minHours: { $min: '$deliveryHours' },
          maxHours: { $max: '$deliveryHours' },
        }},
      ]),

      // Weekly status trend (last 8 weeks)
      reportRepository.aggregateShipments([
        { $match: { ...filter, createdAt: { $gte: new Date(Date.now() - 56 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: {
            week:   { $isoWeek: '$createdAt' },
            year:   { $isoWeekYear: '$createdAt' },
            status: '$status',
          },
          count: { $sum: 1 },
        }},
        { $sort: { '_id.year': 1, '_id.week': 1 } },
      ]),
    ]);

    return {
      deliveryTime: deliveryTimes[0] || { avgHours: 0, minHours: 0, maxHours: 0 },
      weeklyTrend:  statusTrend,
    };
  }); // end remember
};

// ─── Wallet Report (SA sees breakdown, others see their own wallet stats) ────
const walletReportService = async (query, caller) => {
  const cacheKey = KEYS.report('wallet', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    const dateFilter = {};
    if (query.dateFrom || query.dateTo) {
      dateFilter.createdAt = {};
      if (query.dateFrom) dateFilter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo)   dateFilter.createdAt.$lte = new Date(query.dateTo);
    }

    if (caller.role !== UserRole.SUPER_ADMIN) {
      // Merchant or Distributor sees their own wallet stats
      const wallet = await reportRepository.findWalletByUserId(caller.userId);
      if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404 });

      // Aggregate user's credits and debits breakdown
      const txSummary = await reportRepository.aggregateTransactions([
        { $match: { userId: caller.userId, ...dateFilter } },
        { $group: {
          _id: null,
          totalCredited: { $sum: { $cond: [{ $in: ['$type', ['CREDIT', 'TOPUP', 'COD_CREDIT', 'REFUND', 'TRANSFER_CREDIT']] }, '$amount', 0] } },
          totalDebited:  { $sum: { $cond: [{ $in: ['$type', ['DEBIT', 'CHARGE', 'TRANSFER_DEBIT', 'DISPUTE_CHARGE', 'RTO_CHARGE']] }, '$amount', 0] } },
          txCount:       { $sum: 1 },
        }},
      ]);

      return {
        balance:       wallet.balance,
        currency:      wallet.currency,
        isActive:      wallet.isActive,
        totalCredited: txSummary[0]?.totalCredited || 0,
        totalDebited:  txSummary[0]?.totalDebited || 0,
        txCount:       txSummary[0]?.txCount || 0,
      };
    }

    // Super Admin: aggregate overall wallet statistics
    const [overall, roleDistribution] = await Promise.all([
      reportRepository.aggregateWallets([
        { $group: {
          _id:           null,
          totalBalance:  { $sum: '$balance' },
          avgBalance:    { $avg: '$balance' },
          maxBalance:    { $max: '$balance' },
          activeCount:   { $sum: { $cond: ['$isActive', 1, 0] } },
          inactiveCount: { $sum: { $cond: ['$isActive', 0, 1] } },
          totalCount:    { $sum: 1 },
        }},
      ]),
      reportRepository.aggregateWallets([
        // Lookup user role
        { $lookup: {
          from:         'users',
          localField:   'userId',
          foreignField: '_id',
          as:           'user',
        }},
        { $unwind: '$user' },
        { $group: {
          _id:          '$user.role',
          totalBalance: { $sum: '$balance' },
          avgBalance:   { $avg: '$balance' },
          count:        { $sum: 1 },
        }},
      ]),
    ]);

    return {
      summary: overall[0] || { totalBalance: 0, avgBalance: 0, maxBalance: 0, activeCount: 0, inactiveCount: 0, totalCount: 0 },
      byRole:  roleDistribution.reduce((a, r) => { a[r._id] = { totalBalance: r.totalBalance, avgBalance: r.avgBalance, count: r.count }; return a; }, {}),
    };
  }); // end remember
};

// ─── COD Report (merchant/distributor scoped or SA global metrics) ───────────
const codReportService = async (query, caller) => {
  const cacheKey = KEYS.report('cod', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    const filter = {};
    if (caller.role === UserRole.MERCHANT)     filter.merchantId    = caller.userId;
    else if (caller.role === UserRole.DISTRIBUTOR) filter.distributorId = caller.userId;
    else if (caller.role === UserRole.SUPER_ADMIN) {
      if (query.merchantId)    filter.merchantId    = query.merchantId;
      if (query.distributorId) filter.distributorId = query.distributorId;
    }

    if (query.dateFrom || query.dateTo) {
      filter.createdAt = {};
      if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo)   filter.createdAt.$lte = new Date(query.dateTo);
    }

    const [totals, statusBreakdown] = await Promise.all([
      reportRepository.aggregateCod([
        { $match: filter },
        { $group: {
          _id:            null,
          totalCODAmount: { $sum: '$codAmount' },
          avgCODAmount:   { $avg: '$codAmount' },
          count:          { $sum: 1 },
        }},
      ]),
      reportRepository.aggregateCod([
        { $match: filter },
        { $group: {
          _id:    '$status',
          amount: { $sum: '$codAmount' },
          count:  { $sum: 1 },
        }},
      ]),
    ]);

    return {
      summary: totals[0] || { totalCODAmount: 0, avgCODAmount: 0, count: 0 },
      byStatus: statusBreakdown.reduce((a, s) => { a[s._id] = { amount: s.amount, count: s.count }; return a; }, {}),
    };
  }); // end remember
};

// ─── Payment Report (Razorpay top-ups success/failure rate & methods) ────────
const paymentReportService = async (query, caller) => {
  const cacheKey = KEYS.report('payment', caller.userId, hashQuery(query));
  return remember(cacheKey, TTL.REPORT, async () => {
    const filter = {};
    if (caller.role === UserRole.MERCHANT || caller.role === UserRole.DISTRIBUTOR) {
      filter.userId = caller.userId;
    } else if (caller.role === UserRole.SUPER_ADMIN) {
      if (query.userId) filter.userId = query.userId;
    } else {
      throw Object.assign(new Error('Access denied'), { statusCode: 403 });
    }

    if (query.dateFrom || query.dateTo) {
      filter.createdAt = {};
      if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo)   filter.createdAt.$lte = new Date(query.dateTo);
    }

    const [totals, statusBreakdown, methodBreakdown] = await Promise.all([
      reportRepository.aggregatePayments([
        { $match: filter },
        { $group: {
          _id:          null,
          totalAmount:  { $sum: '$amount' },
          avgAmount:    { $avg: '$amount' },
          count:        { $sum: 1 },
        }},
      ]),
      reportRepository.aggregatePayments([
        { $match: filter },
        { $group: {
          _id:    '$status',
          amount: { $sum: '$amount' },
          count:  { $sum: 1 },
        }},
      ]),
      reportRepository.aggregatePayments([
        { $match: { ...filter, status: 'SUCCESS' } },
        { $group: {
          _id:    { $ifNull: ['$paymentMethod', 'unknown'] },
          amount: { $sum: '$amount' },
          count:  { $sum: 1 },
        }},
      ]),
    ]);

    return {
      summary: totals[0] || { totalAmount: 0, avgAmount: 0, count: 0 },
      byStatus: statusBreakdown.reduce((a, s) => { a[s._id] = { amount: s.amount, count: s.count }; return a; }, {}),
      byMethod: methodBreakdown.reduce((a, m) => { a[m._id] = { amount: m.amount, count: m.count }; return a; }, {}),
    };
  }); // end remember
};

module.exports = {
  shipmentReportService,
  revenueReportService,
  merchantRevenueReportService,
  performanceReportService,
  walletReportService,
  codReportService,
  paymentReportService,
};
