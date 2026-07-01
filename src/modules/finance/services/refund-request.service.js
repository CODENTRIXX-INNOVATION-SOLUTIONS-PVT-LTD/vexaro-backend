'use strict';

const mongoose = require('mongoose');
const { UserRole } = require('../../../constants');
const { runInTransaction } = require('../../../utils/transaction');
const refundRequestRepository = require('../refund-request.repository');
const { RefundRequestStatus } = require('../refund-request.model');
const { processRefund } = require('./refund.service');
const financeRepository = require('../finance.repository');
const userRepository = require('../../users/user.repository');
const { logAuditEvent } = require('../../audit/audit.service');
const { createNotification } = require('../../notifications/notification.service');
const {
  sendRefundRequestSubmittedEmail,
  sendRefundRequestDecisionEmail,
} = require('../../../utils/email');
const logger = require('../../../utils/logger');

// ─── Helpers ────────────────────────────────────────────────────────────────────

const throwError = (message, code = 400) =>
  Object.assign(new Error(message), { statusCode: code });

/**
 * Ensure the caller is allowed to view/manage a given refund request.
 * Returns the scoped Mongoose filter.
 */
const buildScopeFilter = (caller) => {
  if (caller.role === UserRole.MERCHANT)     return { merchantId: caller.userId,     deletedAt: null };
  if (caller.role === UserRole.DISTRIBUTOR)  return { distributorId: caller.userId,  deletedAt: null };
  if (caller.role === UserRole.SUPER_ADMIN)  return { deletedAt: null };
  throw throwError('Access denied.', 403);
};

// ─── Submit Refund Request (Merchant only) ───────────────────────────────────────

const submitRefundRequestService = async (dto, caller) => {
  if (caller.role !== UserRole.MERCHANT) {
    throw throwError('Only merchants can submit refund requests.', 403);
  }

  const { shipmentId, amount, reason } = dto;

  // Load shipment — must belong to this merchant
  const Shipment = mongoose.model('Shipment');
  const shipment = await Shipment.findOne({
    _id:        shipmentId,
    merchantId: caller.userId,
    deletedAt:  null,
  }).lean();

  if (!shipment) {
    throw throwError('Shipment not found or does not belong to you.', 404);
  }

  // Cannot request refund for delivered shipments
  if (shipment.status === 'DELIVERED') {
    throw throwError('Refund cannot be requested for a delivered shipment.', 422);
  }

  // Cannot request refund for already cancelled-and-refunded shipments that still have no charge
  if (['ORDER_CREATED'].includes(shipment.status)) {
    // Allow — shipment is not yet picked up
  }

  // Enforce one pending request per shipment
  const existingPending = await refundRequestRepository.findPendingByShipmentId(shipmentId);
  if (existingPending) {
    throw throwError('A pending refund request for this shipment already exists.', 409);
  }

  // Validate requested amount against shipment charge
  if (amount <= 0) {
    throw throwError('Refund amount must be greater than zero.', 422);
  }

  // Resolve distributorId from merchant's invitedBy
  const merchant = await userRepository.findOne({ _id: caller.userId, deletedAt: null });
  const distributorId = merchant?.invitedBy ? merchant.invitedBy.toString() : null;

  const refundRequest = await refundRequestRepository.create({
    merchantId:    caller.userId,
    distributorId: distributorId || null,
    shipmentId,
    awb:    shipment.awb,
    amount,
    reason,
    status: RefundRequestStatus.PENDING,
  });

  logAuditEvent(caller.userId, 'REFUND_REQUEST_SUBMITTED', {
    refundRequestId: refundRequest._id,
    shipmentId,
    amount,
  });

  // Fire-and-forget: notification and email — don't fail the request on notification error
  (async () => {
    try {
      await createNotification(caller.userId, {
        title:   'Refund Request Submitted',
        message: `Your refund request for AWB ${shipment.awb} (₹${amount.toFixed(2)}) has been submitted.`,
        type:    'PAYMENT',
      });
    } catch (err) {
      logger.warn('refund_request_notification_failed', { error: err.message });
    }

    try {
      if (merchant?.email) {
        await sendRefundRequestSubmittedEmail({
          to:           merchant.email,
          merchantName: merchant.firstName || merchant.email,
          awb:          shipment.awb,
          amount,
          reason,
          requestId:    String(refundRequest._id),
        });
      }
    } catch (err) {
      logger.warn('refund_request_submission_email_failed', { error: err.message });
    }
  })();

  return refundRequest;
};

// ─── List Refund Requests (role-scoped) ──────────────────────────────────────────

const listRefundRequestsService = async (query, caller) => {
  const scopeFilter = buildScopeFilter(caller);

  // Allow status filter
  if (query.status && Object.values(RefundRequestStatus).includes(query.status)) {
    scopeFilter.status = query.status;
  }

  const { paginate } = require('../../../utils/pagination');
  const { page, limit } = paginate(query);

  return refundRequestRepository.findAll(scopeFilter, { page, limit });
};

// ─── Process Refund Request (Distributor or Super Admin) ─────────────────────────

const processRefundRequestService = async (id, dto, caller) => {
  if (![UserRole.SUPER_ADMIN, UserRole.DISTRIBUTOR].includes(caller.role)) {
    throw throwError('Access denied. Only admins and distributors can process refund requests.', 403);
  }

  const { status: decision, reviewNote } = dto;

  if (![RefundRequestStatus.APPROVED, RefundRequestStatus.REJECTED].includes(decision)) {
    throw throwError('Status must be APPROVED or REJECTED.', 422);
  }

  if (decision === RefundRequestStatus.REJECTED && !reviewNote?.trim()) {
    throw throwError('A review note is required when rejecting a refund request.', 422);
  }

  // Load request — scope to distributor's merchants if caller is DISTRIBUTOR
  const refundRequest = await refundRequestRepository.findById(id);
  if (!refundRequest) {
    throw throwError('Refund request not found.', 404);
  }

  if (caller.role === UserRole.DISTRIBUTOR &&
      String(refundRequest.distributorId) !== String(caller.userId)) {
    throw throwError('Access denied. This request does not belong to your merchants.', 403);
  }

  if (refundRequest.status !== RefundRequestStatus.PENDING) {
    throw throwError(
      `Refund request is already ${refundRequest.status.toLowerCase()} and cannot be processed again.`,
      409,
    );
  }

  let updatedRequest;

  if (decision === RefundRequestStatus.APPROVED) {
    // Run wallet credit inside a transaction
    updatedRequest = await runInTransaction(async (session) => {
      // Check wallet exists for the merchant
      const wallet = await financeRepository.findWalletByUserId(refundRequest.merchantId, session);
      if (!wallet) throw throwError('Merchant wallet not found.', 500);

      // Credit the wallet
      const { transaction } = await processRefund(session, {
        userId:      String(refundRequest.merchantId),
        amount:      refundRequest.amount,
        type:        'REFUND_REQUEST',
        reference:   `REFUND-REQ-${String(refundRequest._id)}`,
        shipmentId:  refundRequest.shipmentId ? String(refundRequest.shipmentId) : null,
        note:        `Refund approved for AWB ${refundRequest.awb}: ${reviewNote || 'Approved by admin'}`,
        performedBy: caller.userId,
      });

      // Update request status
      const updated = await refundRequestRepository.updateStatus(
        id,
        {
          status:        RefundRequestStatus.APPROVED,
          reviewedBy:    caller.userId,
          reviewedAt:    new Date(),
          reviewNote:    reviewNote || null,
          transactionId: transaction._id,
        },
        session,
      );

      return updated;
    });
  } else {
    // REJECTED — no money movement, just update status
    updatedRequest = await refundRequestRepository.updateStatus(id, {
      status:     RefundRequestStatus.REJECTED,
      reviewedBy: caller.userId,
      reviewedAt: new Date(),
      reviewNote: reviewNote.trim(),
    });
  }

  logAuditEvent(caller.userId, `REFUND_REQUEST_${decision}`, {
    refundRequestId: id,
    merchantId:      refundRequest.merchantId,
    amount:          refundRequest.amount,
    reviewNote,
  });

  // Fire-and-forget: notify merchant
  (async () => {
    try {
      await createNotification(String(refundRequest.merchantId), {
        title:   `Refund Request ${decision === RefundRequestStatus.APPROVED ? 'Approved' : 'Rejected'}`,
        message: `Your refund request for AWB ${refundRequest.awb} has been ${decision.toLowerCase()}.${
          decision === RefundRequestStatus.APPROVED
            ? ` ₹${refundRequest.amount.toFixed(2)} has been credited to your wallet.`
            : ''
        }`,
        type: 'PAYMENT',
      });
    } catch (err) {
      logger.warn('refund_request_decision_notification_failed', { error: err.message });
    }

    try {
      const merchant = await userRepository.findOne({
        _id: refundRequest.merchantId, deletedAt: null,
      });
      if (merchant?.email) {
        await sendRefundRequestDecisionEmail({
          to:           merchant.email,
          merchantName: merchant.firstName || merchant.email,
          awb:          refundRequest.awb,
          amount:       refundRequest.amount,
          status:       decision,
          reviewNote:   reviewNote || null,
          requestId:    String(refundRequest._id),
        });
      }
    } catch (err) {
      logger.warn('refund_request_decision_email_failed', { error: err.message });
    }
  })();

  return updatedRequest;
};

module.exports = {
  submitRefundRequestService,
  listRefundRequestsService,
  processRefundRequestService,
};
