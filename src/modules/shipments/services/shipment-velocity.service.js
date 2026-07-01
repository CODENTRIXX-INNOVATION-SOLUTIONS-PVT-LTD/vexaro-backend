'use strict';

const { velocityClient } = require('../../../utils/velocity');
const { remember, TTL, KEYS } = require('../../../utils/cache');

const checkServiceabilityService = async (dto, user) => {
  const cacheKey = KEYS.serviceability(dto.fromPincode, dto.toPincode, dto.isCOD, dto.isForward, dto.weight, dto.length, dto.breadth, dto.height, dto.codAmount);
  return remember(cacheKey, TTL.SERVICEABILITY, async () => {
    const result = await velocityClient.checkServiceability(
      dto.fromPincode,
      dto.toPincode,
      dto.isCOD !== false,
      dto.isForward !== false,
    );

    const { RateCard } = require('../../rates/rate-card.model');
    const { MarginConfig } = require('../../rates/margin-config.model');
    const { calculateShippingCost } = require('../../pricing/pricing.service');
    const userRepository = require('../../users/user.repository');
    const { UserRole } = require('../../../constants');

    let distributorId = null;
    if (user) {
      if (user.role === UserRole.MERCHANT) {
        const merchant = await userRepository.findOne({ _id: user.userId, deletedAt: null });
        if (merchant?.invitedBy) {
          distributorId = merchant.invitedBy.toString();
        }
      } else if (user.role === UserRole.DISTRIBUTOR) {
        distributorId = user.userId;
      }
    }

    const serviceType = dto.serviceType || 'STANDARD';
    const rateCard = await RateCard.findOne({ serviceType, isActive: true });

    let pricing = null;
    if (rateCard) {
      const marginConfig = distributorId
        ? await MarginConfig.findOne({ distributorId, rateCardId: rateCard._id, isActive: true })
        : null;

      pricing = calculateShippingCost({
        rateCard,
        marginConfig,
        distributorId,
        declaredWeight: dto.weight || 0.5,
        length: dto.length || 0,
        breadth: dto.breadth || 0,
        height: dto.height || 0,
        isCOD: dto.isCOD || false,
        codAmount: dto.codAmount || 0,
      });
    }

    const carriersWithPricing = (result.carriers || []).map(carrier => {
      return {
        ...carrier,
        price: pricing ? pricing.merchantCost : 0,
        distributorPrice: pricing ? pricing.distributorCost : 0,
        carrierCost: pricing ? pricing.carrierCost : 0,
        estimatedDeliveryDays: carrier.est_delivery_days || 3,
      };
    });

    return {
      serviceable: carriersWithPricing.length > 0,
      carriers: carriersWithPricing,
      zone: result.zone,
      fromPincode: dto.fromPincode,
      toPincode: dto.toPincode,
      pricing: pricing || null,
    };
  });
};

const getVelocityRatesService = async (dto) => {
  const result = await velocityClient.getRates({
    journeyType: dto.journeyType,
    originPincode: dto.originPincode,
    destinationPincode: dto.destinationPincode,
    deadWeight: dto.deadWeightGrams,
    length: dto.length,
    width: dto.width,
    height: dto.height,
    paymentMethod: dto.paymentMethod || undefined,
    shipmentValue: dto.shipmentValue || undefined,
    qcApplicable: dto.qcApplicable,
  });

  return result;
};

module.exports = {
  checkServiceabilityService,
  getVelocityRatesService,
};
