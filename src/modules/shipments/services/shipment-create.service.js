'use strict';

const { Shipment } = require('../shipment.model');
const { UserRole, ShipmentStatus, TransactionType, SystemConfig } = require('../../../constants');
const { runInTransaction } = require('../../../utils/transaction');
const { velocityClient } = require('../../../utils/velocity');
const { del, KEYS } = require('../../../utils/cache');
const { RateCard } = require('../../rates/rate-card.model');
const { MarginConfig } = require('../../rates/margin-config.model');
const { Warehouse } = require('../../users/warehouse.model');
const userRepository = require('../../users/user.repository');
const { applyTransaction } = require('../../finance/finance.service');
const { createNotification } = require('../../notifications/notification.service');
const { calculateShippingCost } = require('../../pricing/pricing.service');
// Address book integration — lazy-required to avoid circular dependency issues
const addressBookRepository = require('../../users/address-book.repository');
const { markAddressUsedService } = require('../../users/address-book.service');

const generateUniqueAWB = async () => {
  for (let attempt = 1; attempt <= SystemConfig.AWB_RETRY_ATTEMPTS; attempt++) {
    const awb = Shipment.generateAWB();
    const exists = await Shipment.findOne({ awb }, '_id').lean();
    if (!exists) return awb;
  }
  throw Object.assign(
    new Error(`Failed to generate a unique AWB after ${SystemConfig.AWB_RETRY_ATTEMPTS} attempts. Please retry.`),
    { statusCode: 500 },
  );
};

const { logAuditEvent } = require('../../audit/audit.service');

/**
 * Resolve an address from the address book by ID.
 * Returns an address-shaped object compatible with the Shipment model's
 * origin/destination sub-document, or null if the entry is not found.
 *
 * @param {string} addressBookId - AddressBook entry ObjectId
 * @param {string} merchantId - Owning merchant's ObjectId
 * @returns {Promise<Object|null>} Resolved address object or null
 */
const resolveAddressFromBook = async (addressBookId, merchantId) => {
  const entry = await addressBookRepository.findById(addressBookId, merchantId);
  if (!entry) return null;

  return {
    name:        entry.name,
    phone:       entry.phone,
    addressLine: entry.addressLine,
    city:        entry.city,
    state:       entry.state,
    pincode:     entry.pincode,
    country:     entry.country || 'India',
  };
};


const createShipmentService = async (dto, caller) => {
  if (velocityClient.tokenBlocked) {
    throw Object.assign(new Error('Booking is temporarily disabled due to authorization issues with our shipping partner.'), { statusCode: 503 });
  }

  let merchantId;
  if (caller.role === UserRole.MERCHANT) {
    merchantId = caller.userId;
  } else {
    if (!dto.merchantId) {
      throw Object.assign(new Error('merchantId is required when booking on behalf of a merchant.'), { statusCode: 400 });
    }
    merchantId = dto.merchantId;
  }

  const merchant = await userRepository.findOne({ _id: merchantId, deletedAt: null });
  if (!merchant) {
    throw Object.assign(new Error('Merchant account not found'), { statusCode: 404 });
  }

  if (caller.role === UserRole.DISTRIBUTOR) {
    if (!merchant.invitedBy || merchant.invitedBy.toString() !== caller.userId) {
      throw Object.assign(new Error('Access denied. Merchant does not belong to your distributor account.'), { statusCode: 403 });
    }
  }

  let distributorId = null;
  if (caller.role === UserRole.DISTRIBUTOR) {
    distributorId = caller.userId;
  } else if (merchant.invitedBy) {
    distributorId = merchant.invitedBy.toString();
  }

  // ─── Address Book Resolution (Task 7) ────────────────────────────────────────
  // If originAddressBookId is provided, resolve it into an address object.
  // This overrides dto.origin if the address book entry is found.
  // Fail-fast with 400 if the ID is provided but the entry cannot be found
  // (avoids silent data loss where an invalid ID silently falls back).
  if (dto.originAddressBookId) {
    const resolvedOrigin = await resolveAddressFromBook(dto.originAddressBookId, merchantId);
    if (!resolvedOrigin) {
      throw Object.assign(
        new Error(`originAddressBookId '${dto.originAddressBookId}' not found or does not belong to this merchant.`),
        { statusCode: 400 },
      );
    }
    dto.origin = resolvedOrigin;
  }

  // If destinationAddressBookId is provided, resolve it into an address object.
  if (dto.destinationAddressBookId) {
    const resolvedDestination = await resolveAddressFromBook(dto.destinationAddressBookId, merchantId);
    if (!resolvedDestination) {
      throw Object.assign(
        new Error(`destinationAddressBookId '${dto.destinationAddressBookId}' not found or does not belong to this merchant.`),
        { statusCode: 400 },
      );
    }
    dto.destination = resolvedDestination;
  }

  // After resolution, destination must be set from either the DTO or an address book lookup.
  // (The Zod schema already enforces this at the HTTP layer, but we double-check here
  //  for programmatic callers that bypass the validation middleware.)
  if (!dto.destination) {
    throw Object.assign(
      new Error('destination address is required. Provide destination or destinationAddressBookId.'),
      { statusCode: 400 },
    );
  }

  const awb = await generateUniqueAWB();

  // Validate warehouse
  let finalWarehouseId = dto.warehouseId || null;
  const warehouse = finalWarehouseId
    ? await Warehouse.findById(finalWarehouseId)
    : await Warehouse.findOne({ merchantId, isActive: true });

  if (!warehouse) {
    throw Object.assign(new Error('Active warehouse not found for this merchant. Cannot auto-fill pickup origin.'), { statusCode: 400 });
  }

  finalWarehouseId = warehouse._id.toString();

  // Use the resolved origin address (from address book or DTO), falling back to warehouse details.
  let originAddress = dto.origin || {
    name: warehouse.contactPerson,
    phone: merchant.phone || '9999999999',
    addressLine: warehouse.address,
    city: warehouse.city,
    state: warehouse.state,
    pincode: warehouse.pincode,
    country: 'India',
  };

  // Validate pricing
  const rateCard = await RateCard.findOne({ serviceType: dto.serviceType || 'STANDARD', isActive: true });
  if (!rateCard) {
    throw Object.assign(new Error(`No active rate card found for service type: ${dto.serviceType || 'STANDARD'}`), { statusCode: 400 });
  }

  let marginConfig = null;
  if (distributorId) {
    marginConfig = await MarginConfig.findOne({ distributorId, rateCardId: rateCard._id, isActive: true });
  }

  const pricing = calculateShippingCost({
    rateCard,
    marginConfig,
    distributorId,
    declaredWeight: dto.weight,
    length: dto.length,
    breadth: dto.breadth,
    height: dto.height,
    isCOD: dto.isCOD,
    codAmount: dto.codAmount,
  });

  // 1. Transaction block for local draft creation and wallet charge
  let shipment;
  try {
    await runInTransaction(async (session) => {
      await applyTransaction(session, merchantId, TransactionType.CHARGE, pricing.merchantCost, {
        reference: `CHARGE-${awb}-MERCH`,
        note: `Shipment charge for AWB ${awb}`,
      });

      if (distributorId) {
        await applyTransaction(session, distributorId, TransactionType.CHARGE, pricing.distributorCost, {
          reference: `CHARGE-${awb}-DIST`,
          note: `Shipment charge for AWB ${awb}`,
        });
      }

      const created = await Shipment.create([{
        awb,
        merchantId,
        distributorId,
        warehouseId:      finalWarehouseId,
        origin:           originAddress,
        destination:      dto.destination,
        weight:           dto.weight,
        declaredWeight:   dto.weight,
        volumetricWeight: pricing.volumetricWeight,
        billingWeight:    pricing.billingWeight,
        carrierCost:      pricing.carrierCost,
        distributorCost:  pricing.distributorCost,
        merchantCost:     pricing.merchantCost,
        vexaroProfit:     pricing.vexaroProfit,
        distributorProfit: pricing.distributorProfit,
        isFragile:        dto.isFragile        ?? false,
        itemType:         dto.itemType         ?? 'Parcel',
        declaredValue:    dto.declaredValue    ?? 0,
        isCOD:            dto.isCOD            ?? false,
        codAmount:        dto.codAmount        ?? 0,
        codStatus:        dto.isCOD ? 'PENDING' : 'REMITTED',
        payoutStatus:     dto.isCOD ? 'PENDING' : 'PAID',
        serviceType:      dto.serviceType      ?? 'STANDARD',
        merchantOrderRef: dto.merchantOrderRef ?? null,
        invoiceNumber:    dto.invoiceNumber    ?? null,
        notes:            dto.notes            ?? null,
        status:           ShipmentStatus.ORDER_CREATED,
        statusHistory: [{ status: ShipmentStatus.ORDER_CREATED, updatedBy: caller.userId, note: 'Shipment booked locally' }],
      }], { session });

      shipment = created[0];
    });
  } catch (txErr) {
    // Re-throw transaction errors unchanged so the caller receives the correct status code
    throw txErr;
  }

  // 2. Call Velocity outside the database transaction
  let velocityResult;
  try {
    velocityResult = await velocityClient.createForwardOrder(
      shipment,
      merchant,
      warehouse,
      dto.carrierId || '',
    );
  } catch (apiErr) {
    console.error(`Velocity API call failed for AWB ${awb}. Rolling back...`, apiErr.message);

    // Compensation: refund wallet charges and set shipment to CANCELLED
    try {
      await runInTransaction(async (session) => {
        await applyTransaction(session, merchantId, TransactionType.REFUND, pricing.merchantCost, {
          reference: `REFUND-${awb}-MERCH`,
          note: `Compensation refund for failed carrier booking for AWB ${awb}`,
        });

        if (distributorId) {
          await applyTransaction(session, distributorId, TransactionType.REFUND, pricing.distributorCost, {
            reference: `REFUND-${awb}-DIST`,
            note: `Compensation refund for failed carrier booking for AWB ${awb}`,
          });
        }

        await Shipment.findByIdAndUpdate(
          shipment._id,
          {
            status: ShipmentStatus.CANCELLED,
            $push: {
              statusHistory: {
                status: ShipmentStatus.CANCELLED,
                updatedBy: caller.userId,
                note: `Carrier booking failed: ${apiErr.message}. Refunding charges.`,
              },
            },
          },
          { session }
        );
      });
    } catch (compErr) {
      console.error('CRITICAL: Failed to execute compensation logic for failed shipment booking!', compErr.message);
    }

    throw Object.assign(new Error(`Carrier booking failed: ${apiErr.message}. Your payment has been refunded.`), { statusCode: 502 });
  }

  // 3. Complete booking: persist carrier details
  const updatedShipment = await Shipment.findByIdAndUpdate(
    shipment._id,
    {
      carrierAWB:         velocityResult.awb,
      carrier:            velocityResult.carrierName,
      labelUrl:           velocityResult.labelUrl,
      velocityShipmentId: velocityResult.shipmentId,
      velocityOrderId:    velocityResult.velocityOrderId,
      velocityBooked:     true,
      velocityBookedAt:   new Date(),
    },
    { new: true }
  );

  // 4. Notifications & Audits
  try {
    await createNotification(merchantId, {
      title: 'Shipment Booked',
      message: `Your shipment ${awb} has been booked via ${velocityResult.carrierName}. AWB: ${velocityResult.awb}. Cost: ₹${pricing.merchantCost.toFixed(2)}.`,
      type: 'SHIPMENT',
    });
  } catch (notifErr) {
    console.error('Failed to create shipment booked notification:', notifErr);
  }

  logAuditEvent(caller.userId, 'SHIPMENT_CREATED', { awb, pricing }, updatedShipment._id);

  await del(KEYS.shipmentStats(merchantId.toString()));
  if (distributorId) await del(KEYS.shipmentStats(distributorId.toString()));

  // ─── Mark address book entries as used (fire-and-forget) ─────────────────────
  // Called asynchronously so it never delays or blocks the booking response.
  // markAddressUsedService already handles all errors silently per the design spec.
  if (dto.originAddressBookId) {
    setImmediate(() => markAddressUsedService(dto.originAddressBookId, merchantId).catch(() => {}));
  }
  if (dto.destinationAddressBookId) {
    setImmediate(() => markAddressUsedService(dto.destinationAddressBookId, merchantId).catch(() => {}));
  }

  return {
    ...updatedShipment.toObject(),
    carrierAWB: velocityResult.awb,
    carrier:    velocityResult.carrierName,
    labelUrl:   velocityResult.labelUrl,
  };
};

module.exports = {
  createShipmentService,
};
