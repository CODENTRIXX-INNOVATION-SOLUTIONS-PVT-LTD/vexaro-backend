'use strict';

const { Shipment } = require('../shipment.model');
const { buildShipmentFilter } = require('../shared/shipment.helpers');
const { paginate } = require('../../../utils/pagination');

const listShipmentsService = async (query, caller) => {
  const filter = buildShipmentFilter(caller, query);
  const { limit, skip } = paginate(query);

  const [shipments, total] = await Promise.all([
    Shipment.find(filter)
      .select('merchantOrderRef awb status carrier destination.name destination.city merchantCost isCOD createdAt')
      .populate('merchantId',    'firstName lastName email companyName')
      .populate('distributorId', 'firstName lastName email companyName')
      .populate('warehouseId',   'firstName lastName email companyName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Shipment.countDocuments(filter),
  ]);

  return {
    items: shipments,
    total,
  };
};

module.exports = {
  listShipmentsService,
};
