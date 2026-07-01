const UserRole = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  DISTRIBUTOR: 'DISTRIBUTOR',
  MERCHANT: 'MERCHANT',
  WAREHOUSE: 'WAREHOUSE',
});

const ShipmentStatus = Object.freeze({
  ORDER_CREATED:    'ORDER_CREATED',
  PICKED_UP:        'PICKED_UP',
  ARRIVED_AT_HUB:   'ARRIVED_AT_HUB',
  IN_TRANSIT:       'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED:        'DELIVERED',
  DELIVERY_FAILED:  'DELIVERY_FAILED',
  RTO_INITIATED:    'RTO_INITIATED',
  RTO_IN_TRANSIT:   'RTO_IN_TRANSIT',
  RTO_DELIVERED:    'RTO_DELIVERED',
  RTO:              'RTO',
  CANCELLED:        'CANCELLED',
});

const ShipmentServiceType = Object.freeze({
  STANDARD: 'STANDARD',
  EXPRESS: 'EXPRESS',
  SAME_DAY: 'SAME_DAY',
});

const ShipmentCODStatus = Object.freeze({
  PENDING: 'PENDING',
  COLLECTED: 'COLLECTED',
  REMITTED: 'REMITTED',
});

const ShipmentPayoutStatus = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
});

const CODStatus = Object.freeze({
  PENDING:   'PENDING',
  SETTLED_TO_VEXARO: 'SETTLED_TO_VEXARO',
  REMITTED:  'REMITTED',
  DISPUTED:  'DISPUTED',
});

const TransactionType = Object.freeze({
  CREDIT:     'CREDIT',
  DEBIT:      'DEBIT',
  TOPUP:      'TOPUP',
  SETTLEMENT: 'SETTLEMENT',
  REFUND:     'REFUND',
  CHARGE:     'CHARGE',
  COD_CREDIT: 'COD_CREDIT',
  TRANSFER_DEBIT:  'TRANSFER_DEBIT',
  TRANSFER_CREDIT: 'TRANSFER_CREDIT',
  DISPUTE_CHARGE:  'DISPUTE_CHARGE',
  RTO_CHARGE:      'RTO_CHARGE',
});

const PaymentStatus = Object.freeze({
  PENDING:  'PENDING',
  SUCCESS:  'SUCCESS',
  FAILED:   'FAILED',
  REFUNDED: 'REFUNDED',
});

const DisputeStatus = Object.freeze({
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

const DisputeCategory = Object.freeze({
  LOST: 'LOST',
  DAMAGED: 'DAMAGED',
  DELAY: 'DELAY',
  WRONG_DELIVERY: 'WRONG_DELIVERY',
  COD_MISMATCH: 'COD_MISMATCH',
  OTHER: 'OTHER',
});

const TicketStatus = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
});

const TicketPriority = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
});

const TicketCategory = Object.freeze({
  SHIPMENT: 'SHIPMENT',
  BILLING: 'BILLING',
  ACCOUNT: 'ACCOUNT',
  TECHNICAL: 'TECHNICAL',
  OTHER: 'OTHER',
});

const NotificationType = Object.freeze({
  SHIPMENT: 'SHIPMENT',
  PAYMENT: 'PAYMENT',
  DISPUTE: 'DISPUTE',
  SYSTEM: 'SYSTEM',
  INVITE: 'INVITE',
});

const SystemConfig = Object.freeze({
  RTO_CHARGE_DEFAULT: 40,
  VOLUMETRIC_DIVISOR: 5000,
  DEFAULT_SUPER_ADMIN_MARKUP: 25,
  AWB_RETRY_ATTEMPTS: 5,
  WEIGHT_DISPUTE_EXPIRY_DAYS: 3,
  VELOCITY_TOKEN_TTL: 82800, // 23 hours in seconds
  PAGINATION_LIMIT_DEFAULT: 20,
});

module.exports = {
  UserRole,
  ShipmentStatus,
  ShipmentServiceType,
  ShipmentCODStatus,
  ShipmentPayoutStatus,
  CODStatus,
  TransactionType,
  PaymentStatus,
  DisputeStatus,
  DisputeCategory,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  NotificationType,
  SystemConfig,
};
