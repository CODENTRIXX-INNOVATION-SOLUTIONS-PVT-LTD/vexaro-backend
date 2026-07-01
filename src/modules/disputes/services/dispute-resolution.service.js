'use strict';

const { UserRole, DisputeStatus, TransactionType } = require('../../../constants');
const { runInTransaction } = require('../../../utils/transaction');
const disputeRepository = require('../dispute.repository');
const shipmentRepository = require('../../shipments/shipment.repository');
const { applyTransaction } = require('../../finance/finance.service');
const { createNotification } = require('../../notifications/notification.service');

const updateDisputeService = async (id, dto, caller) => {
  const dispute = await disputeRepository.findByIdRaw(id);
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { statusCode: 404 });

  if ([DisputeStatus.RESOLVED, DisputeStatus.CLOSED].includes(dispute.status)) {
    throw Object.assign(new Error(`Dispute is already ${dispute.status} and cannot be modified`), { statusCode: 400 });
  }

  if (caller.role === UserRole.SUPER_ADMIN || caller.role === UserRole.DISTRIBUTOR) {
    if (dto.status)     dispute.status     = dto.status;
    if (dto.assignedTo) dispute.assignedTo = dto.assignedTo;
    if (dto.resolution) {
      dispute.resolution = dto.resolution;
      dispute.resolvedAt = new Date();
      dispute.resolvedBy = caller.userId;
      dispute.status     = DisputeStatus.RESOLVED;
    }
  }

  if (dto.comment) {
    dispute.comments.push({ author: caller.userId, text: dto.comment });
  }

  await disputeRepository.save(dispute);
  return dispute;
};

const resolveWeightDisputeService = async (id, dto, caller) => {
  if (caller.role !== UserRole.SUPER_ADMIN) {
    throw Object.assign(new Error('Access denied. Only Super Admin has final authority to resolve disputes.'), { statusCode: 403 });
  }

  const dispute = await disputeRepository.findWeightById(id);
  if (!dispute) {
    throw Object.assign(new Error('Weight dispute not found'), { statusCode: 404 });
  }
  if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') {
    throw Object.assign(new Error(`Weight dispute is already resolved or closed: status is ${dispute.status}`), { statusCode: 400 });
  }

  const shipment = await shipmentRepository.findById(dispute.shipmentId);
  if (!shipment) {
    throw Object.assign(new Error('Shipment associated with dispute not found'), { statusCode: 404 });
  }

  return runInTransaction(async (session) => {
    const isApproved = dto.status === 'APPROVED';

    if (isApproved) {
      const ref = `REVS-${shipment.awb}`;

      // Refund merchant
      await applyTransaction(session, shipment.merchantId.toString(), TransactionType.REFUND, dispute.extraCharge, {
        reference: `${ref}-MERCH`,
        shipmentId: shipment._id,
        performedBy: caller.userId,
        note: `Weight dispute reversal refund for shipment ${shipment.awb}`,
      });

      // Refund distributor
      if (shipment.distributorId) {
        await applyTransaction(session, shipment.distributorId.toString(), TransactionType.REFUND, dispute.extraCharge, {
          reference: `${ref}-DIST`,
          shipmentId: shipment._id,
          performedBy: caller.userId,
          note: `Weight dispute reversal refund for shipment ${shipment.awb}`,
        });
      }

      dispute.status = 'APPROVED';
    } else {
      dispute.status = 'REJECTED';
    }

    await disputeRepository.saveWeight(dispute, { session });

    try {
      const resultLabel = isApproved ? 'APPROVED (charges reversed)' : 'REJECTED (charges upheld)';
      await createNotification(shipment.merchantId, {
        title: `Weight Dispute ${isApproved ? 'Approved' : 'Rejected'}`,
        message: `Your weight dispute for AWB ${shipment.awb} has been ${resultLabel}.`,
        type: 'DISPUTE',
      });
    } catch (err) {
      console.error(err);
    }

    return dispute;
  });
};

module.exports = {
  updateDisputeService,
  resolveWeightDisputeService,
};
