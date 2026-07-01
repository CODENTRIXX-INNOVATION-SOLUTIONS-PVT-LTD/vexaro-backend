'use strict';

const { findShipmentWithAccess } = require('../shared/shipment.helpers');
const { UserRole, ShipmentStatus, TransactionType } = require('../../../constants');
const { runInTransaction } = require('../../../utils/transaction');
const { applyTransaction } = require('../../finance/finance.service');
const { COD, CODStatus } = require('../../finance/finance.model');
const { createNotification } = require('../../notifications/notification.service');
const { del, KEYS } = require('../../../utils/cache');
const { performCancellation } = require('./shipment-delete.service');
const { RTO_CHARGE_DEFAULT } = require('../../pricing/pricing.constants');

const { logAuditEvent } = require('../../audit/audit.service');

const updateStatusService = async (shipmentId, dto, caller) => {
  const shipment = await findShipmentWithAccess(shipmentId, caller);

  const { status: nextStatus, note } = dto;

  // Role checks
  if (caller.role === UserRole.MERCHANT) {
    if (nextStatus !== ShipmentStatus.CANCELLED) {
      throw Object.assign(new Error('Merchants can only cancel their own shipments.'), { statusCode: 403 });
    }
  }

  if (caller.role === UserRole.WAREHOUSE) {
    const warehouseAllowed = [
      ShipmentStatus.PICKED_UP,
      ShipmentStatus.ARRIVED_AT_HUB,
      ShipmentStatus.OUT_FOR_DELIVERY,
      ShipmentStatus.DELIVERY_FAILED,
      ShipmentStatus.RTO,
      ShipmentStatus.DELIVERED,
    ];
    if (!warehouseAllowed.includes(nextStatus)) {
      throw Object.assign(new Error(`Warehouse users cannot set status to ${nextStatus}.`), { statusCode: 403 });
    }
  }

  // Idempotency: if already in nextStatus, skip
  if (shipment.status === nextStatus) {
    return shipment;
  }

  // Enforce state machine transition rules
  if (!shipment.canTransitionTo(nextStatus)) {
    throw Object.assign(
      new Error(`Invalid status transition: ${shipment.status} → ${nextStatus}`),
      { statusCode: 400 }
    );
  }

  if (nextStatus === ShipmentStatus.CANCELLED) {
    return runInTransaction(async (session) => {
      await performCancellation(shipment, caller, session);
      logAuditEvent(caller.userId, 'SHIPMENT_STATUS_CHANGED', { awb: shipment.awb, from: shipment.status, to: nextStatus }, shipment._id);
      return shipment;
    });
  }

  // Handle RTO transition (requires RTO charge of ₹40)
  if (nextStatus === ShipmentStatus.RTO) {
    return runInTransaction(async (session) => {
      const ref = `RTO-${shipment.awb}`;

      // Deduct from merchant
      await applyTransaction(session, shipment.merchantId.toString(), TransactionType.RTO_CHARGE, RTO_CHARGE_DEFAULT, {
        reference: `${ref}-MERCH`,
        shipmentId: shipment._id,
        performedBy: caller.userId,
        note: `RTO charge for shipment ${shipment.awb}`,
      });

      // Deduct from distributor
      if (shipment.distributorId) {
        await applyTransaction(session, shipment.distributorId.toString(), TransactionType.RTO_CHARGE, RTO_CHARGE_DEFAULT, {
          reference: `${ref}-DIST`,
          shipmentId: shipment._id,
          performedBy: caller.userId,
          note: `RTO charge for shipment ${shipment.awb}`,
        });
      }

      shipment.status = ShipmentStatus.RTO;
      shipment.statusHistory.push({
        status:    ShipmentStatus.RTO,
        updatedBy: caller.userId,
        note:      note || 'Returned to Origin',
      });
      await shipment.save({ session });

      try {
        await createNotification(shipment.merchantId, {
          title: 'Shipment RTO',
          message: `Your shipment ${shipment.awb} has entered RTO. A fee of ₹${RTO_CHARGE_DEFAULT} has been debited.`,
          type: 'SHIPMENT',
        });
      } catch (err) {
        console.error(err);
      }

      logAuditEvent(caller.userId, 'SHIPMENT_STATUS_CHANGED', { awb: shipment.awb, to: ShipmentStatus.RTO }, shipment._id);

      return shipment;
    });
  }

  // Handle Delivered transition (requires COD setup if isCOD is true)
  if (nextStatus === ShipmentStatus.DELIVERED) {
    return runInTransaction(async (session) => {
      shipment.status = ShipmentStatus.DELIVERED;
      shipment.deliveredAt = new Date();
      shipment.statusHistory.push({
        status:    ShipmentStatus.DELIVERED,
        updatedBy: caller.userId,
        note:      note || 'Delivered successfully',
      });

      if (shipment.isCOD) {
        shipment.codCollected = shipment.codAmount;
        shipment.codStatus = 'COLLECTED';
        shipment.payoutStatus = 'PENDING';

        await COD.create([{
          shipmentId: shipment._id,
          merchantId: shipment.merchantId,
          distributorId: shipment.distributorId,
          codAmount: shipment.codAmount,
          status: CODStatus.PENDING,
          collectedAt: new Date(),
        }], { session });

        const { Wallet } = require('../../finance/finance.model');
        await Wallet.findOneAndUpdate(
          { userId: shipment.merchantId, isActive: true },
          { $inc: { codEscrowBalance: shipment.codAmount } },
          { session }
        );
      } else {
        shipment.codStatus = 'REMITTED';
        shipment.payoutStatus = 'PAID';
      }

      await shipment.save({ session });

      try {
        await createNotification(shipment.merchantId, {
          title: 'Shipment Delivered',
          message: `Your shipment ${shipment.awb} has been successfully delivered.`,
          type: 'SHIPMENT',
        });
      } catch (err) {
        console.error(err);
      }

      logAuditEvent(caller.userId, 'SHIPMENT_STATUS_CHANGED', { awb: shipment.awb, to: ShipmentStatus.DELIVERED }, shipment._id);

      return shipment;
    });
  }

  // Regular operational transition
  shipment.transitionTo(nextStatus, caller.userId, note ?? null);
  await shipment.save();

  logAuditEvent(caller.userId, 'SHIPMENT_STATUS_CHANGED', { awb: shipment.awb, to: nextStatus }, shipment._id);

  // Send appropriate workflow notifications
  try {
    let title = 'Shipment Update';
    let message = `Shipment ${shipment.awb} status updated to ${nextStatus}`;
    if (nextStatus === ShipmentStatus.PICKED_UP) {
      title = 'Shipment Picked Up';
      message = `Your shipment ${shipment.awb} has been picked up.`;
    } else if (nextStatus === ShipmentStatus.ARRIVED_AT_HUB) {
      title = 'Arrived at Hub';
      message = `Your shipment ${shipment.awb} has arrived at the courier hub.`;
    } else if (nextStatus === ShipmentStatus.OUT_FOR_DELIVERY) {
      title = 'Out for Delivery';
      message = `Your shipment ${shipment.awb} is out for delivery today.`;
    } else if (nextStatus === ShipmentStatus.DELIVERY_FAILED) {
      title = 'Delivery Failed';
      message = `Delivery attempt failed for shipment ${shipment.awb}. Reason: ${note || 'not specified'}.`;
    }

    await createNotification(shipment.merchantId, { title, message, type: 'SHIPMENT' });
  } catch (notifErr) {
    console.error('Failed operational updates notifications:', notifErr);
  }

  // Invalidate stats cache for all parties involved
  const statsIds = [shipment.merchantId?.toString()].filter(Boolean);
  if (shipment.distributorId) statsIds.push(shipment.distributorId.toString());
  await Promise.all(statsIds.map(id => del(KEYS.shipmentStats(id))));

  return shipment;
};

module.exports = {
  updateStatusService,
};
