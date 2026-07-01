const mongoose = require('mongoose');
const { TransactionType, CODStatus } = require('../../constants');

// ─── Wallet Schema ─────────────────────────────────────────────────────────────
// One wallet per user. Created automatically on invite, or manually via seed.
const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Balance cannot be negative'],
    },
    codEscrowBalance: {
      type: Number,
      default: 0,
      min: [0, 'Escrow balance cannot be negative'],
    },
    currency: {
      type: String,
      default: 'INR',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// ─── Transaction Schema ────────────────────────────────────────────────────────
// Every money movement is recorded here — immutable ledger.

const transactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
      immutable: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
      immutable: true,
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
      immutable: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Amount must be positive'],
      immutable: true,
    },
    balanceBefore: { type: Number, required: true, immutable: true },
    balanceAfter:  { type: Number, required: true, immutable: true },

    // Reference to what triggered this transaction
    reference: {
      type:    String,
      default: null,
      trim:    true,
      immutable: true,
    },
    shipmentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Shipment',
      default: null,
      immutable: true,
    },
    performedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
      immutable: true,
    },
    note: {
      type:    String,
      default: null,
      trim:    true,
      immutable: true,
    },
  },
  {
    timestamps: true,
  },
);

const preventMutation = function (next) {
  const err = new Error('Transactions are immutable and cannot be updated or deleted.');
  err.statusCode = 400;
  next(err);
};

transactionSchema.pre('save', function (next) {
  if (!this.isNew) {
    return preventMutation(next);
  }
  next();
});

transactionSchema.pre('updateOne', preventMutation);
transactionSchema.pre('findOneAndUpdate', preventMutation);
transactionSchema.pre('updateMany', preventMutation);
transactionSchema.pre('remove', preventMutation);
transactionSchema.pre('deleteOne', preventMutation);
transactionSchema.pre('deleteMany', preventMutation);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ walletId: 1, createdAt: -1 });
transactionSchema.index({ shipmentId: 1 }, { sparse: true });
transactionSchema.index({ performedBy: 1 }, { sparse: true });
transactionSchema.index({ walletId: 1, type: 1 });

// ─── COD Management Schema ─────────────────────────────────────────────────────

const codSchema = new mongoose.Schema(
  {
    shipmentId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Shipment',
      required: true,
      unique:   true,
      index:    true,
    },
    merchantId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'User',
      required: true,
      index: true,
    },
    distributorId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'User',
      default: null,
      index: true,
    },
    codAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type:    String,
      enum:    Object.values(CODStatus),
      default: CODStatus.PENDING,
    },
    collectedAt:  { type: Date, default: null },
    remittedAt:   { type: Date, default: null },
    remittedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note:         { type: String, default: null },
  },
  { timestamps: true },
);

codSchema.index({ merchantId: 1, status: 1 });
codSchema.index({ distributorId: 1, status: 1 });
codSchema.index({ status: 1 });

// ─── Settlement Schema ─────────────────────────────────────────────────────────
const settlementSchema = new mongoose.Schema(
  {
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
      index: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
      index: true,
    },
    amount:    { type: Number, required: true, min: 0.01 },
    status:    { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
    reference: { type: String, default: null, trim: true },
    note:      { type: String, default: null },
    processedAt: { type: Date, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

settlementSchema.index({ fromUserId: 1, status: 1 });
settlementSchema.index({ toUserId: 1, status: 1 });
settlementSchema.index({ status: 1 });

const Wallet      = mongoose.model('Wallet',      walletSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const COD         = mongoose.model('COD',         codSchema);
const Settlement  = mongoose.model('Settlement',  settlementSchema);

module.exports = { Wallet, Transaction, COD, Settlement, TransactionType, CODStatus };
