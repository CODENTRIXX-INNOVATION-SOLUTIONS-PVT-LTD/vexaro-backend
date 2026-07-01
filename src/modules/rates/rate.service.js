'use strict';

const rateRepository = require('./rate.repository');
const userRepository = require('../users/user.repository');
const { delPattern, del, KEYS } = require('../../utils/cache');
const { UserRole, SystemConfig } = require('../../constants');

/**
 * Rate Service
 * Handles business logic for Rate Cards, Margins, and shipping charge calculations.
 */

const getRateCardsService = async () => {
  return rateRepository.findAllActiveCards();
};

const createRateCardService = async (dto) => {
  const card = await rateRepository.createCard(dto);
  await delPattern('vx:rate:cards:*');
  await delPattern('vx:rate:card:*');
  return card;
};

const getRateCardByIdService = async (id) => {
  const card = await rateRepository.findCardById(id);
  if (!card) throw Object.assign(new Error('Rate card not found'), { statusCode: 404 });
  return card;
};

const updateRateCardService = async (id, dto) => {
  const card = await rateRepository.updateCardById(id, dto);
  if (!card) throw Object.assign(new Error('Rate card not found'), { statusCode: 404 });
  await delPattern('vx:rate:cards:*');
  await del(KEYS.rateCard(id));
  return card;
};

const deactivateRateCardService = async (id) => {
  const card = await rateRepository.updateCardById(id, { isActive: false });
  if (!card) throw Object.assign(new Error('Rate card not found'), { statusCode: 404 });
  await delPattern('vx:rate:cards:*');
  await del(KEYS.rateCard(id));
  return card;
};

const getMarginsService = async (filter, skip, limit) => {
  return rateRepository.findMarginsPaginated(filter, { skip, limit });
};

const saveMarginConfigService = async (distributorId, dto) => {
  const card = await rateRepository.findCardById(dto.rateCardId);
  if (!card) throw Object.assign(new Error('Rate card not found'), { statusCode: 404 });

  const margin = await rateRepository.upsertMargin(
    { distributorId, rateCardId: dto.rateCardId },
    { ...dto, distributorId, isActive: true }
  );
  await del(KEYS.marginConfig(distributorId, dto.rateCardId));
  return margin;
};

const calculateRateService = async (dto, user) => {
  const { weight, serviceType, isCOD, codAmount, rateCardId } = dto;

  const card = rateCardId
    ? await rateRepository.findCardById(rateCardId)
    : await rateRepository.findOneCard({ serviceType, isActive: true }); // note: sorted in repo or we sort here

  if (!card) {
    throw Object.assign(new Error('No rate card found for the requested service type'), { statusCode: 404 });
  }

  // Find the matching weight slab
  const sortedSlabs = [...card.weightSlabs].sort((a, b) => a.upToKg - b.upToKg);
  const slab = sortedSlabs.find(s => weight <= s.upToKg) || sortedSlabs[sortedSlabs.length - 1];

  const baseCharge    = (slab.baseRate || 0) + (slab.ratePerKg * weight);
  const fuelCharge    = baseCharge * (card.fuelSurcharge / 100);
  const codCharge     = isCOD ? (card.codCharge + ((codAmount || 0) * card.codPercent / 100)) : 0;
  const totalCharge   = baseCharge + fuelCharge + codCharge;

  // Retrieve Super Admin markup percentage
  const saMarkup = card.superAdminMarkupPercent ?? SystemConfig.DEFAULT_SUPER_ADMIN_MARKUP;

  let finalCharge = totalCharge;
  if (user.role === UserRole.MERCHANT) {
    const merchant = await userRepository.findById(user.userId);
    if (merchant?.invitedBy) {
      // Vexaro charges the distributor marked-up price first
      const distributorCost = totalCharge * (1 + saMarkup / 100);
      const margin = await rateRepository.findOneMargin({ distributorId: merchant.invitedBy, rateCardId: card._id, isActive: true });
      if (margin) {
        // Distributor's margin is calculated on top of Vexaro's price (distributorCost)
        finalCharge = distributorCost * (1 + (margin.marginPercent || 0) / 100) + (margin.flatMargin || 0);
      } else {
        finalCharge = distributorCost;
      }
    } else {
      // Direct merchant -> Vexaro sells directly at marked-up rate
      finalCharge = totalCharge * (1 + saMarkup / 100);
    }
  } else if (user.role === UserRole.DISTRIBUTOR) {
    // Distributor gets Vexaro price (with Super Admin markup)
    finalCharge = totalCharge * (1 + saMarkup / 100);
  }

  return {
    rateCard:    { id: card._id, name: card.name, serviceType: card.serviceType },
    weight,
    breakdown:   { baseCharge: baseCharge.toFixed(2), fuelCharge: fuelCharge.toFixed(2), codCharge: codCharge.toFixed(2) },
    totalCharge: finalCharge.toFixed(2),
    currency:    'INR',
  };
};

module.exports = {
  getRateCardsService,
  createRateCardService,
  getRateCardByIdService,
  updateRateCardService,
  deactivateRateCardService,
  getMarginsService,
  saveMarginConfigService,
  calculateRateService,
};
