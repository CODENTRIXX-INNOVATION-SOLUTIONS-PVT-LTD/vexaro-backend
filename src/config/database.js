const mongoose = require('mongoose');
const { env } = require('./env');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS:    10_000,
      connectTimeoutMS:        10_000,
    });
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = { connectDB };

const gracefulShutdown = async (signal) => {
  const logger = require('../utils/logger');
  logger.info('graceful_shutdown_initiated', { signal });

  try {
    await mongoose.connection.close();
    logger.info('mongodb_connection_closed');
  } catch (err) {
    logger.error('mongodb_close_error', { error: err.message });
  }

  logger.info('graceful_shutdown_complete', { signal });
  process.exit(0);
};

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
