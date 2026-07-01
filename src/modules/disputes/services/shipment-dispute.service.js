'use strict';

const { UserRole, DisputeStatus } = require('../../../constants');
const { paginate } = require('../../../utils/pagination');
const disputeRepository = require('../dispute.repository');
const shipmentRepository = require('../../shipments/shipment.repository');
const { buildFilter } = require('../shared/dispute.helpers');

const listDisputesService = async (query, caller) => {
  const filter = await buildFilter(caller, query);
  const { limit, skip } = paginate(query);

  const [disputes, total] = await disputeRepository.findPaginated(filter, { skip, limit });
  return { items: disputes, total };
};

const createDisputeService = async (dto, caller) => {
  const shipment = await shipmentRepository.findOne({ _id: dto.shipmentId, deletedAt: null });
  if (!shipment) throw Object.assign(new Error('Shipment not found'), { statusCode: 404 });

  if (caller.role === UserRole.MERCHANT && shipment.merchantId.toString() !== caller.userId) {
    throw Object.assign(new Error('You can only raise disputes for your own shipments'), { statusCode: 403 });
  }

  const existing = await disputeRepository.findOne({
    shipmentId: dto.shipmentId,
    status: { $in: [DisputeStatus.OPEN, DisputeStatus.IN_REVIEW] }
  });
  if (existing) throw Object.assign(new Error('An active dispute already exists for this shipment'), { statusCode: 409 });

  return disputeRepository.create({ ...dto, raisedBy: caller.userId });
};

const getDisputeService = async (id, caller) => {
  const dispute = await disputeRepository.findById(id);
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { statusCode: 404 });

  if (caller.role === UserRole.MERCHANT && dispute.raisedBy._id.toString() !== caller.userId) {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  }

  return dispute;
};

module.exports = {
  listDisputesService,
  createDisputeService,
  getDisputeService,
};
