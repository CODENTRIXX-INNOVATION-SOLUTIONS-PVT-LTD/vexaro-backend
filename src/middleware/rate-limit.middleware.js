'use strict';

const rateLimit = require('express-rate-limit');

// 1. General Limiter: 15 minutes, 200 requests
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. Auth Limiter: 15 minutes, 10 requests
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Booking Limiter: 1 minute, 5 requests
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: 'Shipment booking rate limit exceeded. Please throttle your requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 4. Webhook Limiter: 1 minute, 100 requests (skips specific Velocity IPs)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, message: 'Webhook processing rate limit exceeded.' },
  skip: (req) => {
    const velocityWebhookIPs = ['15.207.255.190', '13.202.145.74'];
    return velocityWebhookIPs.includes(req.ip);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Exporting aliases for other files that might still import the old limiters
module.exports = {
  generalLimiter,
  authLimiter,
  bookingLimiter,
  webhookLimiter,
  shipmentLimiter: bookingLimiter,
  trackingLimiter: generalLimiter,
  addressBookWriteLimiter: generalLimiter,
};
