/**
 * Application bootstrap.
 */

require('./config/env');
const { env } = require('./config/env');
const Sentry = require('@sentry/node');

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn:         env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Capture 100% of transactions in development, 10% in production
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Never send PII to Sentry
    beforeSend(event) {
      // Scrub any password fields from request bodies
      if (event.request?.data) {
        const body = event.request.data;
        ['password', 'newPassword', 'currentPassword', 'token', 'inviteToken', 'resetToken'].forEach((field) => {
          if (body[field]) body[field] = '[REDACTED]';
        });
      }
      return event;
    },
  });
}

const logger = require('./utils/logger');
const { connectDB } = require('./config/database');
const { verifyEmailConfig } = require('./utils/email');
const app = require('./app');

const bootstrap = async () => {
  await connectDB();

  const { checkTransactionSupport } = require('./utils/transaction');
  const txSupported = await checkTransactionSupport();
  if (!txSupported && env.NODE_ENV === 'production') {
    logger.error('fatal_no_transaction_support', {
      reason: 'MongoDB is running as Standalone. Transactions require a Replica Set.',
      action: 'Convert MongoDB to a Replica Set (even a single-node rs) before deploying.',
    });
    process.exit(1);
  }
  if (!txSupported) {
    logger.warn('transaction_support_disabled', {
      note: 'Running without ACID transactions. Safe for development only.',
    });
  }

  const { connect: connectRedis } = require('./utils/cache');
  await connectRedis();

  const { initScheduler } = require('./utils/scheduler');
  initScheduler();

  const server = app.listen(env.PORT, () => {
    logger.info('server_started', {
      port:        env.PORT,
      environment: env.NODE_ENV,
      frontendUrl: env.FRONTEND_URL,
      sentry:      !!env.SENTRY_DSN,
    });

    console.log(`\n🚀 Vexaro API  →  http://localhost:${env.PORT}`);
    console.log(`   Env: ${env.NODE_ENV} | Sentry: ${env.SENTRY_DSN ? 'enabled' : 'disabled'}`);
    console.log(`   Redis: ${env.REDIS_ENABLED ? env.REDIS_URL : 'disabled'}\n`);
    console.log('📋 AUTH          POST /api/auth/login');
    console.log('                 GET  /api/auth/verify-invite');
    console.log('                 POST /api/auth/set-password');
    console.log('                 POST /api/auth/forgot-password');
    console.log('                 POST /api/auth/reset-password');
    console.log('                 GET  /api/auth/me');
    console.log('                 POST /api/auth/change-initial-credentials\n');
    console.log('👥 USERS         POST /api/users/invite');
    console.log('                 GET  /api/users  |  GET /api/users/:id');
    console.log('                 PATCH /api/users/:id  |  DELETE /api/users/:id\n');
    console.log('📦 SHIPMENTS     POST/GET /api/shipments');
    console.log('                 GET  /api/shipments/stats');
    console.log('                 GET  /api/shipments/track/:awb');
    console.log('                 GET/PATCH/DELETE /api/shipments/:id');
    console.log('                 PATCH /api/shipments/:id/status');
    console.log('                 POST  /api/shipments/bulk-upload\n');
    console.log('💰 FINANCE       GET  /api/finance/wallet');
    console.log('                 GET  /api/finance/wallets');
    console.log('                 POST /api/finance/topup');
    console.log('                 GET  /api/finance/transactions');
    console.log('                 GET  /api/finance/cod');
    console.log('                 PATCH /api/finance/cod/:id/remit');
    console.log('                 GET/POST /api/finance/settlements');
    console.log('                 PATCH /api/finance/settlements/:id/process\n');
    console.log('⚖️  DISPUTES      GET/POST /api/disputes');
    console.log('                 GET/PATCH /api/disputes/:id\n');
    console.log('📊 REPORTS       GET /api/reports/shipments');
    console.log('                 GET /api/reports/revenue');
    console.log('                 GET /api/reports/merchant-revenue');
    console.log('                 GET /api/reports/performance\n');
    console.log('🎫 SUPPORT       GET/POST /api/support');
    console.log('                 GET/PATCH /api/support/:id');
    console.log('                 POST /api/support/:id/reply\n');
    console.log('🔔 NOTIFICATIONS GET  /api/notifications');
    console.log('                 PATCH /api/notifications/:id/read');
    console.log('                 PATCH /api/notifications/mark-read');
    console.log('                 DELETE /api/notifications/:id\n');
    console.log('⚙️  SETTINGS      GET/PATCH /api/settings/profile');
    console.log('                 POST /api/settings/change-password');
    console.log('                 GET/POST /api/settings/api-keys');
    console.log('                 DELETE /api/settings/api-keys/:id\n');
    console.log('💲 RATES         GET/POST /api/rates/cards');
    console.log('                 GET/PATCH/DELETE /api/rates/cards/:id');
    console.log('                 GET/POST /api/rates/margins');
    console.log('                 POST /api/rates/calculate\n');
  });

  server.timeout = 30_000;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  verifyEmailConfig();
};

bootstrap().catch((err) => {
  logger.error('fatal_startup_error', { message: err.message, stack: err.stack });
  if (env.SENTRY_DSN) Sentry.captureException(err);
  process.exit(1);
});
