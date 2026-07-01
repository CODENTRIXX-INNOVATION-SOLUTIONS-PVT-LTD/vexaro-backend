'use strict';

const cron = require('node-cron');
const { velocityClient } = require('./velocity');
const { Shipment } = require('../modules/shipments/shipment.model');
const { WeightDispute } = require('../modules/disputes/weightDispute.model');
const { DisputeStatus, ShipmentStatus } = require('../constants');
const logger = require('./logger');
const cache = require('./cache');



/**
 * Polls tracking details from Velocity for all active (non-terminal) shipments.
 */
const pollActiveShipmentsTracking = async () => {
  logger.info('cron_tracking_poll_started');
  try {
    const activeShipments = await Shipment.find({
      status: {
        $nin: [
          ShipmentStatus.DELIVERED,
          ShipmentStatus.RTO_DELIVERED,
          ShipmentStatus.CANCELLED,
          'RTO', // legacy RTO status
        ]
      },
      carrierAWB: { $ne: null },
      velocityBooked: true,
    });

    if (activeShipments.length === 0) {
      logger.info('cron_tracking_poll_no_active_shipments');
      return;
    }

    for (const shipment of activeShipments) {
      try {
        const tracking = await velocityClient.getTrackingDetails([shipment.carrierAWB]);
        if (tracking && tracking.status) {
          // Map Velocity tracking status to Vexaro status if available
          // (Mock implementation updates status according to Velocity payload)
          const newStatus = tracking.status.toUpperCase();
          if (Object.values(ShipmentStatus).includes(newStatus) && shipment.status !== newStatus) {
            shipment.status = newStatus;
            shipment.statusHistory.push({
              status: newStatus,
              note: tracking.activity || 'Status updated via tracking cron job',
            });
            await shipment.save();
            logger.info('cron_tracking_poll_shipment_updated', { awb: shipment.awb, status: newStatus });
          }
        }
      } catch (shipmentErr) {
        logger.error('cron_tracking_poll_single_shipment_failed', { awb: shipment.awb, message: shipmentErr.message });
      }
    }
  } catch (err) {
    logger.error('cron_tracking_poll_failed', { message: err.message });
  }
};

/**
 * Daily dispute expiry worker.
 * Scans for OPEN disputes where disputeExpiresAt is in the past and sets status to EXPIRED.
 */
const expireDisputesWorker = async () => {
  logger.info('cron_dispute_expiry_started');
  try {
    const result = await WeightDispute.updateMany(
      {
        status: DisputeStatus.OPEN,
        disputeExpiresAt: { $lt: new Date() },
      },
      {
        $set: { status: DisputeStatus.EXPIRED }
      }
    );
    logger.info('cron_dispute_expiry_completed', { modifiedCount: result.modifiedCount });
  } catch (err) {
    logger.error('cron_dispute_expiry_failed', { message: err.message });
  }
};

/**
 * Initializes and schedules all cron jobs.
 */
const initScheduler = () => {
  logger.info('scheduler_initializing');

  // 1. Every 30 minutes: poll tracking details (Rule T3)
  cron.schedule('*/30 * * * *', async () => {
    await pollActiveShipmentsTracking();
  });

  // 2. Daily at midnight: find and close expired disputes (Rule D8)
  cron.schedule('0 0 * * *', async () => {
    await expireDisputesWorker();
  });

  logger.info('scheduler_initialized_successfully');
};

module.exports = {
  initScheduler,
  pollActiveShipmentsTracking,
  expireDisputesWorker,
};
