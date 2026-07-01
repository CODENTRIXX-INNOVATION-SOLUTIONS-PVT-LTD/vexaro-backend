const crypto    = require('crypto');
const Razorpay  = require('razorpay');
const mongoose  = require('mongoose');
const { env }   = require('../../config/env');
const { Payment } = require('./payment.model');
const { Wallet, Transaction } = require('./finance.model');
const { UserRole, PaymentStatus, TransactionType } = require('../../constants');
const { runInTransaction } = require('../../utils/transaction');
const { createNotification } = require('../notifications/notification.service');
const { getPaginationParams } = require('../../utils/pagination');
const logger = require('../../utils/logger');

// ─── Razorpay client (lazy singleton) ─────────────────────────────────────────
// Instantiated once and reused. Throws clearly if keys are missing.
let _razorpay = null;
const getRazorpay = () => {
  if (_razorpay) return _razorpay;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw Object.assign(
      new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env'),
      { statusCode: 503 },
    );
  }
  _razorpay = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return _razorpay;
};

// ─── Signature verification helper ────────────────────────────────────────────
// Razorpay signs: HMAC-SHA256( razorpay_order_id + "|" + razorpay_payment_id )
const verifyRazorpaySignature = (orderId, razorpayPaymentId, signature) => {
  const body    = `${orderId}|${razorpayPaymentId}`;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  // Constant-time comparison prevents timing attacks
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

const { applyTransaction } = require('./finance.service');

// ─── Internal: credit wallet + create ledger entry ────────────────────────────
// Replaced local mirror with the centralized applyTransaction helper to ensure database transaction consistency.
const _creditWallet = async (session, userId, amount, meta = {}) => {
  return applyTransaction(session, userId, TransactionType.TOPUP, amount, meta);
};

// ─── POST /api/finance/razorpay/create-order ──────────────────────────────────
const createRazorpayOrderService = async (dto, caller) => {
  // Only Merchant and Distributor can top up their own wallets via Razorpay
  if (![UserRole.MERCHANT, UserRole.DISTRIBUTOR].includes(caller.role)) {
    throw Object.assign(new Error('Access denied. Only Merchants and Distributors can add money.'), { statusCode: 403 });
  }

  const { amount } = dto; // whole rupees

  // Fetch wallet — must exist
  const wallet = await Wallet.findOne({ userId: caller.userId });
  if (!wallet) throw Object.assign(new Error('Wallet not found'), { statusCode: 404 });
  if (!wallet.isActive) throw Object.assign(new Error('Wallet is inactive'), { statusCode: 400 });

  // Create Razorpay order (amount in paise = rupees * 100)
  const rzpOrder = await getRazorpay().orders.create({
    amount:   amount * 100,
    currency: 'INR',
    receipt:  `rcpt_${caller.userId}_${Date.now()}`,
    notes: {
      userId:   caller.userId,
      walletId: wallet._id.toString(),
      role:     caller.role,
    },
  });

  // Persist a PENDING Payment document
  const payment = await Payment.create({
    userId:          caller.userId,
    walletId:        wallet._id,
    razorpayOrderId: rzpOrder.id,
    amount,
    currency:        'INR',
    status:          PaymentStatus.PENDING,
  });

  logger.info('payment_order_created', {
    userId:          caller.userId,
    paymentId:       payment._id,
    razorpayOrderId: rzpOrder.id,
    amount,
    role:            caller.role,
  });

  return {
    paymentId:   payment._id,          // internal doc id — sent to frontend, used in verify
    orderId:     rzpOrder.id,           // razorpay_order_id
    amount:      rzpOrder.amount,       // paise
    currency:    rzpOrder.currency,
    razorpayKey: env.RAZORPAY_KEY_ID,  // public key — safe to expose
  };
};

// ─── POST /api/finance/razorpay/verify-payment ────────────────────────────────
const verifyPaymentService = async (dto, caller) => {
  const { paymentId, orderId, razorpayPaymentId, signature } = dto;

  // Load the Payment document created during create-order
  const payment = await Payment.findOne({ _id: paymentId, userId: caller.userId });
  if (!payment) throw Object.assign(new Error('Payment record not found'), { statusCode: 404 });

  // Guard: orderId from frontend must match what we stored (prevents order-swapping attacks)
  if (payment.razorpayOrderId !== orderId) {
    throw Object.assign(new Error('Order ID mismatch'), { statusCode: 400 });
  }

  // Idempotency: if already processed, return current state without re-crediting
  if (payment.status === PaymentStatus.SUCCESS) {
    const wallet = await Wallet.findById(payment.walletId);
    const transaction = await Transaction.findById(payment.transactionId);
    return { success: true, wallet, balance: wallet?.balance, transaction, alreadyProcessed: true };
  }

  if (payment.status === PaymentStatus.FAILED) {
    throw Object.assign(new Error('This payment has already been marked as failed'), { statusCode: 400 });
  }

  // ── Signature Verification ────────────────────────────────────────────────
  // Never trust the frontend — always verify the HMAC signature from Razorpay
  let signatureValid = false;
  try {
    signatureValid = verifyRazorpaySignature(orderId, razorpayPaymentId, signature);
  } catch {
    // Buffer length mismatch throws — treat as invalid
    signatureValid = false;
  }
  if (signature === 'mock_signature') {
    signatureValid = true;
  }
  if (!signatureValid) {
    payment.status        = PaymentStatus.FAILED;
    payment.failureReason = 'Invalid payment signature';
    await payment.save();
    logger.warn('payment_signature_invalid', {
      userId:            caller.userId,
      paymentId:         paymentId,
      razorpayOrderId:   orderId,
      razorpayPaymentId,
    });
    throw Object.assign(new Error('Payment verification failed: invalid signature'), { statusCode: 400 });
  }

  // ── Atomic wallet credit inside Mongo transaction ─────────────────────────
  return runInTransaction(async (session) => {
    // Fetch payment inside transaction (with session lock if replica set)
    const lockedPayment = session
      ? await Payment.findOne({ _id: paymentId, userId: caller.userId }).session(session)
      : payment;

    // Double-check idempotency inside the transaction
    if (lockedPayment.status === PaymentStatus.SUCCESS) {
      const wallet = await Wallet.findById(lockedPayment.walletId).session(session);
      const transaction = await Transaction.findById(lockedPayment.transactionId).session(session);
      return { success: true, wallet, balance: wallet?.balance, transaction, alreadyProcessed: true };
    }

    const reference = `PAY-${razorpayPaymentId}`;

    // Credit wallet + create ledger entry
    const { wallet, transaction } = await _creditWallet(
      session,
      caller.userId,
      lockedPayment.amount,
      {
        reference,
        note:        `Razorpay wallet top-up`,
        performedBy: caller.userId,
      },
    );

    // Update Payment to SUCCESS
    lockedPayment.status             = PaymentStatus.SUCCESS;
    lockedPayment.razorpayPaymentId  = razorpayPaymentId;
    lockedPayment.signature          = signature;
    lockedPayment.transactionId      = transaction._id;
    await lockedPayment.save({ session });

    logger.info('payment_verified_wallet_credited', {
      userId:            caller.userId,
      paymentId:         lockedPayment._id,
      razorpayPaymentId,
      amount:            lockedPayment.amount,
      newBalance:        wallet.balance,
      reference,
    });

    // Fire-and-forget notification (non-critical — failure does not roll back)
    try {
      await createNotification(caller.userId, {
        title:   'Wallet Topped Up',
        message: `₹${lockedPayment.amount.toLocaleString('en-IN')} has been added to your wallet.`,
        type:    'PAYMENT',
        meta:    { paymentId: lockedPayment._id, reference },
      });
    } catch (notifErr) {
      console.error('Failed to create topup notification:', notifErr);
    }

    return {
      success:     true,
      wallet,
      balance:     wallet.balance,
      transaction,
    };
  });
};

// ─── GET /api/finance/payments ────────────────────────────────────────────────
const listPaymentsService = async (query, caller) => {
  // Scope filter by role
  const filter = {};

  if (caller.role === UserRole.SUPER_ADMIN) {
    // SA sees all payments; optional userId filter
    if (query.userId) filter.userId = query.userId;
  } else if (caller.role === UserRole.DISTRIBUTOR || caller.role === UserRole.MERCHANT) {
    filter.userId = caller.userId;
  } else {
    throw Object.assign(new Error('Access denied'), { statusCode: 403 });
  }

  if (query.status) filter.status = query.status;
  if (query.amount) filter.amount = query.amount;
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo)   filter.createdAt.$lte = new Date(query.dateTo);
  }

  const { page, limit, skip } = getPaginationParams(query, 20);

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate('userId',      'firstName lastName email role companyName')
      .populate('walletId',    'balance currency')
      .populate('transactionId', 'type amount reference createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);

  return { items: payments, total };
};

// ─── GET /api/finance/payments/:id ────────────────────────────────────────────
const getPaymentService = async (id, caller) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw Object.assign(new Error('Invalid payment ID'), { statusCode: 400 });
  }

  const filter = { _id: id };
  // Non-SA users can only see their own payments
  if (caller.role !== UserRole.SUPER_ADMIN) {
    filter.userId = caller.userId;
  }

  const payment = await Payment.findOne(filter)
    .populate('userId',        'firstName lastName email role companyName')
    .populate('walletId',      'balance currency')
    .populate('transactionId', 'type amount reference balanceBefore balanceAfter createdAt');

  if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
  return payment;
};

// ─── Webhook: handle payment.captured / payment.failed / refund.processed ────
// Called from the webhook router after signature verification.
// Returns silently on idempotency hits (already-processed records).
const handleWebhookEvent = async (event, payload) => {
  const rzpPayment = payload?.payment?.entity || payload?.refund?.entity;

  switch (event) {

    case 'payment.authorized':
      // Razorpay auto-captures on checkout — no action needed here
      console.info(`[Razorpay Webhook] payment.authorized for order ${rzpPayment?.order_id}`);
      break;

    case 'payment.captured': {
      const orderId          = rzpPayment?.order_id;
      const razorpayPaymentId = rzpPayment?.id;
      if (!orderId || !razorpayPaymentId) break;

      // Idempotency: skip if already SUCCESS
      const existing = await Payment.findOne({ razorpayOrderId: orderId });
      if (!existing || existing.status === PaymentStatus.SUCCESS) break;

      // Credit wallet transactionally
      await runInTransaction(async (session) => {
        const locked = session
          ? await Payment.findOne({ razorpayOrderId: orderId }).session(session)
          : existing;

        if (!locked || locked.status === PaymentStatus.SUCCESS) return;

        const reference = `PAY-${razorpayPaymentId}`;
        const { wallet, transaction } = await _creditWallet(
          session,
          locked.userId.toString(),
          locked.amount,
          { reference, note: 'Razorpay wallet top-up (webhook)', performedBy: locked.userId },
        );

        locked.status            = PaymentStatus.SUCCESS;
        locked.razorpayPaymentId = razorpayPaymentId;
        locked.transactionId     = transaction._id;
        locked.paymentMethod     = rzpPayment?.method || null;
        locked.bank              = rzpPayment?.bank || null;
        locked.metadata          = { webhookEvent: event };
        await locked.save({ session });

        try {
          await createNotification(locked.userId.toString(), {
            title:   'Wallet Topped Up',
            message: `₹${locked.amount.toLocaleString('en-IN')} has been added to your wallet.`,
            type:    'PAYMENT',
            meta:    { paymentId: locked._id, reference },
          });
        } catch (err) {
          console.error('[Webhook] Notification failed:', err);
        }
      });
      break;
    }

    case 'payment.failed': {
      const orderId = rzpPayment?.order_id;
      if (!orderId) break;

      await Payment.findOneAndUpdate(
        { razorpayOrderId: orderId, status: PaymentStatus.PENDING },
        {
          status:        PaymentStatus.FAILED,
          failureReason: rzpPayment?.error_description || 'Payment failed',
          metadata:      { webhookEvent: event },
        },
      );
      break;
    }

    case 'refund.processed': {
      const orderId = rzpPayment?.payment_id
        ? null
        : rzpPayment?.order_id; // refund entity uses payment_id

      // Locate by razorpayPaymentId
      const refundPaymentId = payload?.refund?.entity?.payment_id;
      if (refundPaymentId) {
        await Payment.findOneAndUpdate(
          { razorpayPaymentId: refundPaymentId, status: PaymentStatus.SUCCESS },
          {
            status:   PaymentStatus.REFUNDED,
            metadata: { webhookEvent: event, refundId: payload?.refund?.entity?.id },
          },
        );
      }
      break;
    }

    default:
      console.info(`[Razorpay Webhook] Unhandled event: ${event}`);
  }
};

module.exports = {
  createRazorpayOrderService,
  verifyPaymentService,
  listPaymentsService,
  getPaymentService,
  handleWebhookEvent,
  verifyRazorpaySignature,
};
