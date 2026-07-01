require('dotenv').config();

const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'EMAIL_FROM',
  'FRONTEND_URL',
  'VELOCITY_USERNAME',
  'VELOCITY_PASSWORD',
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

// ── Security Hardening checks ──
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Reject localhost/127.0.0.1 in production env
  const dbUri = process.env.MONGODB_URI || '';
  if (dbUri.includes('localhost') || dbUri.includes('127.0.0.1')) {
    throw new Error('Production Database URI cannot connect to localhost or 127.0.0.1');
  }

  // Reject missing secrets in production
  const productionRequired = [
    'VELOCITY_WEBHOOK_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'SMTP_PASS',
    'SMTP_USER',
    'SENTRY_DSN'
  ];
  for (const key of productionRequired) {
    if (!process.env[key]) {
      throw new Error(`Production environment requires variable: ${key}`);
    }
  }
}

// Reject weak or default placeholder JWT secrets
const jwtSec = process.env.JWT_SECRET || '';
const weakSecrets = ['jwt_secret', 'secret', '123456', 'supersecret', 'placeholder', 'development'];
if (jwtSec.length < 32 || weakSecrets.some(ws => jwtSec.toLowerCase().includes(ws))) {
  throw new Error('JWT_SECRET is weak. It must be at least 32 characters and cannot be a common placeholder.');
}

const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_POOL_SIZE: parseInt(process.env.MONGODB_POOL_SIZE || '10', 10),
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  EMAIL_FROM: process.env.EMAIL_FROM,
  FRONTEND_URL: process.env.FRONTEND_URL,
  INVITE_TOKEN_EXPIRES_HOURS: parseInt(process.env.INVITE_TOKEN_EXPIRES_HOURS || '48', 10),
  RESET_TOKEN_EXPIRES_HOURS: parseInt(process.env.RESET_TOKEN_EXPIRES_HOURS || '2', 10),

  // ─── Razorpay ──────────────────────────────────────────────────────────────
  RAZORPAY_KEY_ID:         process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET:     process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  // Maximum single topup allowed (paise → stored as rupees in this field)
  RAZORPAY_MAX_TOPUP_AMOUNT: parseInt(process.env.RAZORPAY_MAX_TOPUP_AMOUNT || '100000', 10),

  // ─── Velocity Shipping ─────────────────────────────────────────────────────
  VELOCITY_USERNAME: process.env.VELOCITY_USERNAME,
  VELOCITY_PASSWORD: process.env.VELOCITY_PASSWORD,
  VELOCITY_BASE_URL: process.env.VELOCITY_BASE_URL || 'https://shazam.velocity.in/',
  // Optional HMAC secret for verifying Velocity webhook signatures
  VELOCITY_WEBHOOK_SECRET: process.env.VELOCITY_WEBHOOK_SECRET || '',

  // ─── Sentry (optional — error monitoring) ──────────────────────────────────
  // Get your DSN from https://sentry.io → Settings → Projects → Client Keys
  // Leave blank or omit in development to disable Sentry.
  SENTRY_DSN: process.env.SENTRY_DSN || '',
};

module.exports = { env };
