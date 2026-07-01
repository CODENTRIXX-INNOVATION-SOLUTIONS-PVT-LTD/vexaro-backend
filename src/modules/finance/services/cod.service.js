'use strict';

const { UserRole, CODStatus, TransactionType } = require('../../../constants');
const { getPaginationParams } = require('../../../utils/pagination');
const { runInTransaction } = require('../../../utils/transaction');
const financeRepository = require('../finance.repository');
const shipmentRepository = require('../../shipments/shipment.repository');
const { applyTransaction } = require('./payment.service');
const { createNotification } = require('../../notifications/notification.service');

const listCODService = async (query, caller) => {
  const filter = {};

  if (caller.role === UserRole.MERCHANT)     filter.merchantId    = caller.userId;
  else if (caller.role === UserRole.DISTRIBUTOR) filter.distributorId = caller.userId;

  if (query.status) filter.status = query.status;
  if (query.merchantId && caller.role === UserRole.SUPER_ADMIN) filter.merchantId = query.merchantId;

  const { limit, skip } = getPaginationParams(query, 20);

  const [cods, total] = await financeRepository.findCodsPaginated(filter, { skip, limit });
  return { items: cods, total };
};

const remitCODService = async (codId, dto, caller) => {
  if (![UserRole.SUPER_ADMIN, UserRole.DISTRIBUTOR].includes(caller.role)) {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  }

  const cod = await financeRepository.findCodById(codId);
  if (!cod) throw Object.assign(new Error('COD record not found'), { statusCode: 404 });

  if (caller.role === UserRole.SUPER_ADMIN) {
    if (cod.status !== CODStatus.PENDING) {
      throw Object.assign(new Error(`Super Admin can only settle PENDING CODs. Current status: ${cod.status}`), { statusCode: 400 });
    }

    return runInTransaction(async (session) => {
      cod.status = CODStatus.SETTLED_TO_VEXARO;
      await financeRepository.saveCod(cod, { session });
      return cod;
    });
  }

  if (caller.role === UserRole.DISTRIBUTOR) {
    if (cod.status !== CODStatus.SETTLED_TO_VEXARO) {
      throw Object.assign(new Error(`Distributors can only remit CODs settled to Vexaro. Current status: ${cod.status}`), { statusCode: 400 });
    }
    if (cod.distributorId?.toString() !== caller.userId) {
      throw Object.assign(new Error('Access denied. This COD shipment is not assigned to your distributor account.'), { statusCode: 403 });
    }

    return runInTransaction(async (session) => {
      await applyTransaction(session, cod.merchantId.toString(), TransactionType.COD_CREDIT, cod.codAmount, {
        shipmentId:  cod.shipmentId,
        performedBy: caller.userId,
        reference:   `COD-${cod._id}`,
        note:        dto.note || 'COD amount credited',
      });

      cod.status     = CODStatus.REMITTED;
      cod.remittedAt = new Date();
      cod.remittedBy = caller.userId;
      cod.note       = dto.note || null;
      await financeRepository.saveCod(cod, { session });

      await shipmentRepository.findByIdAndUpdate(
        cod.shipmentId,
        {
          codStatus: 'REMITTED',
          payoutStatus: 'PAID',
          payoutDate: new Date(),
        },
        { session }
      );

      try {
        await createNotification(cod.merchantId.toString(), {
          title: 'COD Released',
          message: `COD amount of ₹${cod.codAmount.toFixed(2)} has been released to your wallet.`,
          type: 'PAYMENT',
        });
      } catch (notifErr) {
        console.error('Failed to notify COD release:', notifErr);
      }

      return cod;
    });
  }
};

module.exports = {
  listCODService,
  remitCODService,
};
