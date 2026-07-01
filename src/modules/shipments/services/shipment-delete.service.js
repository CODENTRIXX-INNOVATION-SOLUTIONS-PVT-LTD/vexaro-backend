'use strict';

const { findShipmentWithAccess } = require('../shared/shipment.helpers');
const { ShipmentStatus, TransactionType } = require('../../../constants');
const { runInTransaction } = require('../../../utils/transaction');
const { velocityClient } = require('../../../utils/velocity');
const { applyTransaction } = require('../../finance/finance.service');
const { createNotification } = require('../../notifications/notification.service');
const { del, KEYS } = require('../../../utils/cache');

const { logAuditEvent } = require('../../audit/audit.service');

const performCancellation = async (shipment, caller, session) => {
  if (shipment.status !== ShipmentStatus.ORDER_CREATED) {
    throw Object.assign(new Error('Cancellation is only allowed when status is ORDER_CREATED.'), { statusCode: 400 });
  }

  const ref = `REFUND-${shipment.awb}`;

  // Refund merchant
  if (shipment.merchantCost > 0) {
    await applyTransaction(session, shipment.merchantId.toString(), TransactionType.REFUND, shipment.merchantCost, {
      reference: `${ref}-MERCH`,
      shipmentId: shipment._id,
      performedBy: caller.userId,
      note: `Shipping refund for cancelled shipment ${shipment.awb}`,
    });
  }

  // Refund distributor
  if (shipment.distributorId && shipment.distributorCost > 0) {
    await applyTransaction(session, shipment.distributorId.toString(), TransactionType.REFUND, shipment.distributorCost, {
      reference: `${ref}-DIST`,
      shipmentId: shipment._id,
      performedBy: caller.userId,
      note: `Shipping refund for cancelled shipment ${shipment.awb}`,
    });
  }

  shipment.status = ShipmentStatus.CANCELLED;
  shipment.statusHistory.push({
    status: ShipmentStatus.CANCELLED,
    updatedBy: caller.userId,
    note: 'Shipment cancelled by user',
  });
  shipment.deletedAt = new Date();
  await shipment.save({ session });
};

const deleteShipmentService = async (shipmentId, caller) => {
  const shipment = await findShipmentWithAccess(shipmentId, caller);

  if (shipment.status !== ShipmentStatus.ORDER_CREATED) {
    throw Object.assign(new Error('Cancellation is only allowed when status is ORDER_CREATED.'), { statusCode: 400 });
  }

  // 1. Velocity API call first
  if (shipment.velocityBooked && shipment.carrierAWB) {
    try {
      await velocityClient.cancelOrders([shipment.carrierAWB]);
    } catch (velErr) {
      console.error(`[Velocity] Cancel failed for AWB ${shipment.carrierAWB}:`, velErr.message);
      throw Object.assign(new Error(`Failed to cancel booking with shipping partner: ${velErr.message}`), { statusCode: 502 });
    }
  }

  // 2. Database mutations and refunds in a committed transaction
  const result = await runInTransaction(async (session) => {
    await performCancellation(shipment, caller, session);
    return { message: 'Shipment cancelled successfully.' };
  });

  // 3. Notifications & Audits
  try {
    await createNotification(shipment.merchantId, {
      title: 'Shipment Cancelled',
      message: `Your shipment ${shipment.awb} has been cancelled and ₹${shipment.merchantCost.toFixed(2)} refunded.`,
      type: 'SHIPMENT',
    });
  } catch (err) {
    console.error('Failed to notify cancellation:', err);
  }

  logAuditEvent(caller.userId, 'SHIPMENT_CANCELLED', { awb: shipment.awb, refundAmount: shipment.merchantCost }, shipment._id);

  const toInvalidate = [shipment.merchantId?.toString()].filter(Boolean);
  if (shipment.distributorId) toInvalidate.push(shipment.distributorId.toString());
  await Promise.all(toInvalidate.map(id => del(KEYS.shipmentStats(id))));

  return result;
};

module.exports = {
  performCancellation,
  deleteShipmentService,
};
