const mongoose = require('mongoose');
const { ShipmentStatus, ShipmentServiceType, ShipmentCODStatus, ShipmentPayoutStatus } = require('../../constants');

// Only these forward transitions are permitted.
const STATUS_TRANSITIONS = {
  [ShipmentStatus.ORDER_CREATED]:    [ShipmentStatus.PICKED_UP,        ShipmentStatus.CANCELLED],
  [ShipmentStatus.PICKED_UP]:        [ShipmentStatus.ARRIVED_AT_HUB],
  [ShipmentStatus.ARRIVED_AT_HUB]:   [ShipmentStatus.OUT_FOR_DELIVERY],
  [ShipmentStatus.OUT_FOR_DELIVERY]: [ShipmentStatus.DELIVERED,        ShipmentStatus.DELIVERY_FAILED],
  [ShipmentStatus.DELIVERY_FAILED]:  [ShipmentStatus.OUT_FOR_DELIVERY, ShipmentStatus.RTO],
  [ShipmentStatus.DELIVERED]:        [], // terminal
  [ShipmentStatus.RTO]:              [], // terminal
  [ShipmentStatus.CANCELLED]:        [], // terminal
};

// ─── Sub-schema: Address ──────────────────────────────────────────────────────
const addressSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, trim: true },
    phone:      { type: String, required: true, trim: true },
    email:      { type: String, default: null, trim: true },
    addressLine:{ type: String, required: true, trim: true },
    city:       { type: String, required: true, trim: true },
    state:      { type: String, required: true, trim: true },
    pincode:    { type: String, required: true, trim: true },
    country:    { type: String, default: 'India', trim: true },
  },
  { _id: false },
);

// ─── Sub-schema: Status history event ────────────────────────────────────────
const statusEventSchema = new mongoose.Schema(
  {
    status:    { type: String, enum: Object.values(ShipmentStatus), required: true },
    timestamp: { type: Date, default: Date.now },
    note:      { type: String, default: null },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: false },
);

// ─── Main Shipment schema ─────────────────────────────────────────────────────
const shipmentSchema = new mongoose.Schema(
  {
    // ── AWB (Air Waybill Number) — unique tracking ID ───────────────────────
    awb: {
      type:     String,
      required: true,
      unique:   true,
      uppercase: true,
      trim:     true,
      index:    true,
    },

    // ── Hierarchy references ────────────────────────────────────────────────
    merchantId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'Merchant is required'],
      index:    true,
    },
    distributorId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'User',
      index: true,
      default: null,
    },
    warehouseId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'Warehouse', // FIX: was 'User' — warehouseId must ref the Warehouse model
      index: true,
      default: null,
    },

    // ── Addresses ───────────────────────────────────────────────────────────
    origin:      { type: addressSchema, required: true  },
    destination: { type: addressSchema, required: true  },

    // ── Package details ─────────────────────────────────────────────────────
    weight:           { type: Number, required: true, min: 0 },   // kg (acts as declaredWeight too)
    declaredWeight:   { type: Number, default: 0 },
    volumetricWeight: { type: Number, default: 0 },
    billingWeight:    { type: Number, default: 0 },
    length:           { type: Number, default: null },             // cm
    breadth:          { type: Number, default: null },
    height:           { type: Number, default: null },
    itemType:         { type: String, default: 'Parcel', trim: true },
    isFragile:        { type: Boolean, default: false },
    declaredValue:    { type: Number, default: 0, min: 0 },        // ₹
    isCOD:            { type: Boolean, default: false },
    codAmount:        { type: Number, default: 0, min: 0 },
    codCollected:     { type: Number, default: 0 },
    codStatus:        { type: String, enum: Object.values(ShipmentCODStatus), default: ShipmentCODStatus.PENDING },
    payoutStatus:     { type: String, enum: Object.values(ShipmentPayoutStatus), default: ShipmentPayoutStatus.PENDING },
    payoutDate:       { type: Date, default: null },

    // ── Cost and Profit tracking ────────────────────────────────────────────
    carrierCost:      { type: Number, default: 0 },
    distributorCost:  { type: Number, default: 0 },
    merchantCost:     { type: Number, default: 0 },
    vexaroProfit:     { type: Number, default: 0 },
    distributorProfit:{ type: Number, default: 0 },

    // ── Service details ─────────────────────────────────────────────────────
    serviceType: {
      type:    String,
      enum:    Object.values(ShipmentServiceType),
      default: ShipmentServiceType.STANDARD,
    },

    // ── Status ──────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    Object.values(ShipmentStatus),
      default: ShipmentStatus.ORDER_CREATED,
      index:   true,
    },
    statusHistory: {
      type:    [statusEventSchema],
      default: [],
    },

    // ── Courier/carrier details ─────────────────────────────────────────────
    carrier:         { type: String, default: null },
    carrierAWB:      { type: String, default: null },
    estimatedDelivery: { type: Date, default: null },
    deliveredAt:     { type: Date, default: null },

    // ── Notes & references ───────────────────────────────────────────────────
    notes:            { type: String, default: null },
    merchantOrderRef: { type: String, default: null, trim: true }, // merchant's own order ID
    invoiceNumber:    { type: String, default: null, trim: true },

    // ── Velocity Shipping fields ─────────────────────────────────────────────
    velocityShipmentId: {
      type:  String,
      default: null,
      index: true,
    },
    velocityOrderId: {
      type:  String,
      default: null,
    },
    velocityReturnId: {
      type:  String,
      default: null,
    },
    velocityBooked: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    velocityBookedAt: {
      type:    Date,
      default: null,
    },
    labelUrl: {
      type:    String,
      default: null,
    },
    isReturn: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    // ── Soft delete ─────────────────────────────────────────────────────────
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// ─── Compound indexes for common queries ──────────────────────────────────────
shipmentSchema.index({ merchantId: 1, status: 1 });
shipmentSchema.index({ distributorId: 1, status: 1 });
shipmentSchema.index({ warehouseId: 1, status: 1 });
shipmentSchema.index({ createdAt: -1, status: 1 });
shipmentSchema.index({ merchantOrderRef: 1 }, { sparse: true });
shipmentSchema.index({ deletedAt: 1 });
shipmentSchema.index({ isCOD: 1, codStatus: 1 });

// ─── Instance methods ─────────────────────────────────────────────────────────

/**
 * Returns true if the given next status is a valid transition from current.
 */
shipmentSchema.methods.canTransitionTo = function (nextStatus) {
  return (STATUS_TRANSITIONS[this.status] ?? []).includes(nextStatus);
};

/**
 * Performs the status transition and appends to statusHistory.
 * Throws if the transition is invalid.
 */
shipmentSchema.methods.transitionTo = function (nextStatus, updatedBy = null, note = null) {
  if (!this.canTransitionTo(nextStatus)) {
    const err = new Error(
      `Invalid status transition: ${this.status} → ${nextStatus}. ` +
      `Allowed: ${(STATUS_TRANSITIONS[this.status] ?? []).join(', ') || 'none (terminal status)'}`,
    );
    err.statusCode = 400;
    throw err;
  }

  this.status = nextStatus;
  this.statusHistory.push({ status: nextStatus, updatedBy, note });

  if (nextStatus === ShipmentStatus.DELIVERED) {
    this.deliveredAt = new Date();
  }
};

// ─── Static methods ───────────────────────────────────────────────────────────

/**
 * Generates a unique AWB.
 * Format: VX-YYYYMMDD-XXXXXX (e.g. VX-20240615-A3F9K2)
 */
shipmentSchema.statics.generateAWB = function () {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).toUpperCase().slice(2, 8);
  return `VX-${date}-${random}`;
};

shipmentSchema.pre('save', function () {
  // Sync weight (declared weight)
  if (this.weight !== undefined && !this.declaredWeight) {
    this.declaredWeight = this.weight;
  }
  if (this.declaredWeight !== undefined) {
    this.weight = this.declaredWeight;
  }

  // Calculate volumetric weight: (L * B * H) / 5000
  if (this.length && this.breadth && this.height) {
    this.volumetricWeight = parseFloat(((this.length * this.breadth * this.height) / 5000).toFixed(2));
  } else {
    this.volumetricWeight = 0;
  }

  // Billing weight is max of declared weight and volumetric weight
  this.billingWeight = Math.max(this.declaredWeight || 0, this.volumetricWeight);

  // Derived profits
  if (this.distributorCost !== undefined && this.carrierCost !== undefined && this.distributorCost !== null && this.carrierCost !== null) {
    this.vexaroProfit = parseFloat((this.distributorCost - this.carrierCost).toFixed(2));
  }
  if (this.merchantCost !== undefined && this.distributorCost !== undefined && this.merchantCost !== null && this.distributorCost !== null) {
    this.distributorProfit = parseFloat((this.merchantCost - this.distributorCost).toFixed(2));
  }
});

const Shipment = mongoose.model('Shipment', shipmentSchema);

module.exports = { Shipment, ShipmentStatus, STATUS_TRANSITIONS };
