'use strict';

const { Dispute }       = require('./dispute.model');
const { WeightDispute } = require('./weightDispute.model');
const { Shipment }      = require('../shipments/shipment.model');

/**
 * Dispute Repository
 * Pure data-access layer — no business logic, no try/catch, no service calls.
 */

// ─── Shipment Disputes ────────────────────────────────────────────────────────

/** Find one dispute by _id with full population. */
const findById = (id) =>
  Dispute.findById(id)
    .populate('shipmentId', 'awb status origin destination')
    .populate('raisedBy',   'firstName lastName email role')
    .populate('assignedTo', 'firstName lastName email')
    .populate('resolvedBy', 'firstName lastName email')
    .populate('comments.author', 'firstName lastName role');

/** Find one dispute by _id without population (for mutation). */
const findByIdRaw = (id) => Dispute.findById(id);

/** Find one dispute matching a filter. */
const findOne = (filter) => Dispute.findOne(filter);

/**
 * Paginated list of disputes with population.
 * Returns [disputes[], total].
 */
const findPaginated = async (filter, { skip, limit, sort = { createdAt: -1 } } = {}) => {
  return Promise.all([
    Dispute.find(filter)
      .select('shipmentId status createdAt')
      .populate('shipmentId', 'awb')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Dispute.countDocuments(filter),
  ]);
};

/** Create a new dispute. */
const create = (data) => Dispute.create(data);

/** Save a dispute document. */
const save = (dispute, options = {}) => dispute.save(options);

// ─── Weight Disputes ──────────────────────────────────────────────────────────

/** Find one weight dispute by _id. */
const findWeightById = (id) => WeightDispute.findById(id);

/**
 * Paginated list of weight disputes with shipment population.
 * Returns [disputes[], total].
 */
const findWeightPaginated = async (filter, { skip, limit, sort = { createdAt: -1 } } = {}) => {
  return Promise.all([
    WeightDispute.find(filter)
      .select('shipmentId status extraCharge disputeExpiresAt createdAt')
      .populate({
        path:   'shipmentId',
        select: 'awb',
      })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    WeightDispute.countDocuments(filter),
  ]);
};

/** Create one or more weight dispute documents, optionally within a session. */
const createWeightInSession = (data, session) =>
  WeightDispute.create([data], { session });

/** Save a weight dispute document. */
const saveWeight = (dispute, options = {}) => dispute.save(options);

/**
 * Close all open weight disputes that have expired.
 * Used to auto-expire disputes past their window.
 */
const closeExpiredWeightDisputes = () =>
  WeightDispute.updateMany(
    { status: 'OPEN', disputeExpiresAt: { $lt: new Date() } },
    { status: 'CLOSED' },
  );

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Find shipments for a given userId field (e.g. distributorId). Lightweight. */
const findShipmentsByField = (fieldName, userId) =>
  Shipment.find({ [fieldName]: userId }, '_id');

module.exports = {
  // Disputes
  findById,
  findByIdRaw,
  findOne,
  findPaginated,
  create,
  save,
  // Weight Disputes
  findWeightById,
  findWeightPaginated,
  createWeightInSession,
  saveWeight,
  closeExpiredWeightDisputes,
  // Helpers
  findShipmentsByField,
};
