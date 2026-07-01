'use strict';

const { UserRole, TransactionType } = require('../../../constants');
const { paginate } = require('../../../utils/pagination');
const { runInTransaction } = require('../../../utils/transaction');
const disputeRepository = require('../dispute.repository');
const shipmentRepository = require('../../shipments/shipment.repository');
const financeRepository = require('../../finance/finance.repository');
const { createNotification } = require('../../notifications/notification.service');
const { buildWeightDisputeFilter } = require('../shared/dispute.helpers');
const { WEIGHT_DISPUTE_EXPIRY_DAYS } = require('../shared/dispute.constants');

const raiseWeightDisputeService = async (dto, caller) => {
  if (caller.role !== UserRole.SUPER_ADMIN) {
    throw Object.assign(new Error('Access denied. Only Super Admin can raise weight disputes.'), { statusCode: 403 });
  }

  const { shipmentId, actualWeight, extraCharge, proofImages } = dto;
  const shipment = await shipmentRepository.findOne({ _id: shipmentId, deletedAt: null });
  if (!shipment) {
    throw Object.assign(new Error('Shipment not found'), { statusCode: 404 });
  }

  return runInTransaction(async (session) => {
    const ref = `DISP-${shipment.awb}`;

    const { applyTransaction } = require('../../finance/finance.service');
    const { logAuditEvent } = require('../../audit/audit.service');

    const merchantId = (shipment.merchantId._id || shipment.merchantId).toString();
    const distributorId = shipment.distributorId ? (shipment.distributorId._id || shipment.distributorId).toString() : null;

    // Deduct extraCharge from merchant using applyTransaction
    await applyTransaction(session, merchantId, TransactionType.DISPUTE_CHARGE, extraCharge, {
      reference: `${ref}-MERCH`,
      shipmentId: shipment._id,
      performedBy: caller.userId,
      note: `Weight dispute charge for shipment ${shipment.awb}`,
    });

    // Deduct extraCharge from distributor using applyTransaction
    if (distributorId) {
      await applyTransaction(session, distributorId, TransactionType.DISPUTE_CHARGE, extraCharge, {
        reference: `${ref}-DIST`,
        shipmentId: shipment._id,
        performedBy: caller.userId,
        note: `Weight dispute charge for shipment ${shipment.awb}`,
      });
    }

    logAuditEvent(caller.userId, 'WEIGHT_DISPUTE_RAISED', { awb: shipment.awb, actualWeight, extraCharge }, shipment._id);

    // Create Weight Dispute record
    const declaredWeight = shipment.declaredWeight || shipment.weight || 0;
    const disputeExpiresAt = new Date(Date.now() + WEIGHT_DISPUTE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const weightDispute = await disputeRepository.createWeightInSession({
      shipmentId,
      declaredWeight,
      actualWeight,
      extraCharge,
      proofImages: proofImages || [],
      status: 'OPEN',
      disputeRaisedAt: new Date(),
      disputeExpiresAt,
    }, session);

    try {
      await createNotification(shipment.merchantId._id || shipment.merchantId, {
        title: 'Weight Dispute Raised',
        message: `Weight dispute raised on AWB ${shipment.awb}. Declared: ${declaredWeight}kg | Actual: ${actualWeight}kg. ₹${extraCharge.toFixed(2)} debited. Dispute this within 3 days.`,
        type: 'DISPUTE',
      });
    } catch (notifErr) {
      console.error(notifErr);
    }

    return weightDispute[0];
  });
};

const listWeightDisputesService = async (query, caller) => {
  await disputeRepository.closeExpiredWeightDisputes();
  const filter = await buildWeightDisputeFilter(caller, query);
  const { limit, skip } = paginate(query);

  const [disputes, total] = await disputeRepository.findWeightPaginated(filter, { skip, limit });
  return { items: disputes, total };
};

const submitDisputeProofService = async (id, dto, caller) => {
  const dispute = await disputeRepository.findWeightById(id);
  if (!dispute) {
    throw Object.assign(new Error('Weight dispute not found'), { statusCode: 404 });
  }
  if (dispute.status !== 'OPEN') {
    throw Object.assign(new Error('Dispute is no longer open for editing'), { statusCode: 400 });
  }

  const shipment = await shipmentRepository.findById(dispute.shipmentId);
  if (!shipment || (shipment.merchantId._id || shipment.merchantId).toString() !== caller.userId) {
    throw Object.assign(new Error('Access denied. You can only submit proof for your own shipments.'), { statusCode: 403 });
  }

  dispute.proofImages = dto.proofImages || [];
  dispute.status = 'UNDER_REVIEW';
  await disputeRepository.saveWeight(dispute);

  return dispute;
};

module.exports = {
  raiseWeightDisputeService,
  listWeightDisputesService,
  submitDisputeProofService,
};
