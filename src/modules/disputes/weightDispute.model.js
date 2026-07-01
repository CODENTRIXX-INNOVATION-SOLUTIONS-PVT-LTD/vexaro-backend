const mongoose = require('mongoose');
const { DisputeStatus } = require('../../constants');

const weightDisputeSchema = new mongoose.Schema(
  {
    shipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
      unique: true,
      index: true,
    },
    declaredWeight: {
      type: Number,
      required: true,
    },
    actualWeight: {
      type: Number,
      required: true,
    },
    extraCharge: {
      type: Number,
      required: true,
      min: 0,
    },
    proofImages: [{
      type: String,
    }],
    status: {
      type: String,
      enum: Object.values(DisputeStatus),
      default: DisputeStatus.OPEN,
      index: true,
    },
    disputeRaisedAt: {
      type: Date,
      default: Date.now,
    },
    disputeExpiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

weightDisputeSchema.index({ disputeExpiresAt: 1 });

const WeightDispute = mongoose.model('WeightDispute', weightDisputeSchema);

module.exports = { WeightDispute };
