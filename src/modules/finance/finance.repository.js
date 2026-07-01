'use strict';

const { Wallet, Transaction, COD, Settlement } = require('./finance.model');

/**
 * Finance Repository
 * Pure data-access layer — no business logic, no try/catch, no service calls.
 * All session-aware functions accept an optional Mongoose ClientSession.
 */

// ─── Wallet ───────────────────────────────────────────────────────────────────

/** Find a wallet by userId, optionally within a session. */
const findWalletByUserId = (userId, session) => {
  const q = Wallet.findOne({ userId });
  return session ? q.session(session) : q;
};

/** Find a wallet by its _id. */
const findWalletById = (id) => Wallet.findById(id);

/** Create a new wallet document, optionally within a session. */
const createWallet = (data, session) =>
  session ? Wallet.create([data], { session }) : Wallet.create(data);

/** Save a wallet document. */
const saveWallet = (wallet, options = {}) => wallet.save(options);

/** Paginated list of wallets with user population. Returns [wallets[], total]. */
const findWalletsPaginated = async (filter, { skip, limit, sort = { balance: -1 } } = {}) => {
  return Promise.all([
    Wallet.find(filter)
      .populate('userId', 'firstName lastName email role companyName')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Wallet.countDocuments(filter),
  ]);
};

/** Run an aggregation on Wallet. */
const aggregateWallets = (pipeline) => Wallet.aggregate(pipeline);

// ─── Transaction ──────────────────────────────────────────────────────────────

/** Create a new transaction ledger entry, optionally within a session. */
const createTransaction = (data, session) =>
  session ? Transaction.create([data], { session }) : Transaction.create(data);

/** Find one transaction matching a filter, optionally within a session. */
const findTransaction = (filter, session) => {
  const q = Transaction.findOne(filter);
  return session ? q.session(session) : q;
};

/** Find a transaction by its _id. */
const findTransactionById = (id) => Transaction.findById(id);

/** Paginated list of transactions. Returns [transactions[], total]. */
const findTransactionsPaginated = async (filter, { skip, limit, sort = { createdAt: -1 } } = {}) => {
  return Promise.all([
    Transaction.find(filter)
      .select('type amount balanceAfter note createdAt')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);
};

/** Run an aggregation on Transaction. */
const aggregateTransactions = (pipeline) => Transaction.aggregate(pipeline);

/** Get a streaming cursor on Transaction (for CSV export). */
const transactionCursor = (filter, sort = { createdAt: -1 }) =>
  Transaction.find(filter).sort(sort).cursor();

// ─── COD ─────────────────────────────────────────────────────────────────────

/** Find one COD record by _id. */
const findCodById = (id) => COD.findById(id);

/** Paginated list of COD records. Returns [cods[], total]. */
const findCodsPaginated = async (filter, { skip, limit, sort = { createdAt: -1 } } = {}) => {
  return Promise.all([
    COD.find(filter)
      .populate('shipmentId',    'awb status serviceType')
      .populate('merchantId',    'firstName lastName email companyName')
      .populate('distributorId', 'firstName lastName email companyName')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    COD.countDocuments(filter),
  ]);
};

/** Create one or more COD records, optionally within a session. */
const createCod = (data, session) =>
  session ? COD.create([data], { session }) : COD.create(data);

/** Save a COD document. */
const saveCod = (cod, options = {}) => cod.save(options);

/** Update a COD record by _id. */
const updateCodById = (id, update, options = {}) =>
  COD.findByIdAndUpdate(id, update, { new: true, ...options });

/** Run an aggregation on COD. */
const aggregateCod = (pipeline) => COD.aggregate(pipeline);

// ─── Settlement ───────────────────────────────────────────────────────────────

/** Find one Settlement by _id. */
const findSettlementById = (id) => Settlement.findById(id);

/** Paginated list of settlements. Returns [settlements[], total]. */
const findSettlementsPaginated = async (filter, { skip, limit, sort = { createdAt: -1 } } = {}) => {
  return Promise.all([
    Settlement.find(filter)
      .populate('fromUserId',  'firstName lastName email role companyName')
      .populate('toUserId',    'firstName lastName email role companyName')
      .populate('processedBy', 'firstName lastName email role')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Settlement.countDocuments(filter),
  ]);
};

/** Create a new settlement record. */
const createSettlement = (data) => Settlement.create(data);

/** Save a settlement document. */
const saveSettlement = (settlement, options = {}) => settlement.save(options);

module.exports = {
  // Wallet
  findWalletByUserId,
  findWalletById,
  createWallet,
  saveWallet,
  findWalletsPaginated,
  aggregateWallets,
  // Transaction
  createTransaction,
  findTransaction,
  findTransactionById,
  findTransactionsPaginated,
  aggregateTransactions,
  transactionCursor,
  // COD
  findCodById,
  findCodsPaginated,
  createCod,
  saveCod,
  updateCodById,
  aggregateCod,
  // Settlement
  findSettlementById,
  findSettlementsPaginated,
  createSettlement,
  saveSettlement,
  findOneSettlement: (filter) => Settlement.findOne(filter),
};
