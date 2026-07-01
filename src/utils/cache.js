/**
 * src/utils/cache.js
 *
 * Lightweight, in-memory cache utility replacing Redis.
 * Eliminates external Redis dependency and hosting costs completely.
 */

'use strict';

const logger  = require('./logger');

// ── In-Memory Map Store ──────────────────────────────────────────────────────
const store = new Map();

// Helper to check if key is expired
const isExpired = (entry) => {
  if (!entry) return true;
  return Date.now() > entry.expiresAt;
};

const getClient = () => {
  return null; // Redis client is completely removed
};

const connect = async () => {
  logger.info('in_memory_cache_initialized', { note: 'Redis has been completely disabled and removed. Cache is backed by local memory.' });
};

const disconnect = async () => {
  store.clear();
};

const get = async (key) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    store.delete(key);
    return null;
  }
  return entry.value;
};

const set = async (key, value, ttlSeconds) => {
  const ttl = ttlSeconds ?? TTL.DEFAULT;
  store.set(key, {
    value,
    expiresAt: Date.now() + (ttl * 1000)
  });
};

const del = async (...keys) => {
  for (const key of keys) {
    store.delete(key);
  }
};

const delPattern = async (pattern) => {
  // Convert glob pattern (e.g. "vx:rate:cards:*") to RegExp
  // Escapes regex chars except *
  const regexStr = '^' + pattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, (m) => m === '*' ? '.*' : '\\' + m) + '$';
  const regex = new RegExp(regexStr);

  let deleted = 0;
  for (const key of store.keys()) {
    if (regex.test(key)) {
      store.delete(key);
      deleted++;
    }
  }
  if (deleted > 0) {
    logger.debug('in_memory_pattern_deleted', { pattern, deleted });
  }
};

const remember = async (key, ttlSeconds, fn) => {
  const cached = await get(key);
  if (cached !== null) {
    logger.debug('cache_hit', { key });
    return cached;
  }
  logger.debug('cache_miss', { key });
  const fresh = await fn();
  await set(key, fresh, ttlSeconds);
  return fresh;
};

// ── TTL constants (all in seconds) ───────────────────────────────────────────
const TTL = Object.freeze({
  DEFAULT:        5 * 60,            //  5 min
  RATE_CARDS:    10 * 60,            // 10 min
  MARGIN_CONFIG: 10 * 60,            // 10 min
  SHIPMENT_STATS: 2 * 60,            //  2 min
  REPORT:         5 * 60,            //  5 min
  USER_PROFILE:   5 * 60,            //  5 min
  VELOCITY_TOKEN: 23 * 60 * 60,      // 23 hrs
  SERVICEABILITY: 30 * 60,           // 30 min
});

// ── Cache key builders ────────────────────────────────────────────────────────
const KEYS = Object.freeze({
  rateCards:       ()                        => 'vx:rate:cards:all',
  rateCard:        (id)                      => `vx:rate:card:${id}`,
  marginConfig:    (distId, cardId)          => `vx:rate:margin:${distId}:${cardId}`,
  shipmentStats:   (userId)                  => `vx:stats:shipments:${userId}`,
  report:          (type, userId, hash)      => `vx:report:${type}:${userId}:${hash}`,
  userProfile:     (userId)                  => `vx:user:profile:${userId}`,
  velocityToken:   ()                        => 'vx:velocity:auth:token',
  serviceability:  (from, to, cod, fwd)      => `vx:svc:${from}:${to}:${cod ? 1 : 0}:${fwd ? 1 : 0}`,
});

// Periodic cleanup of expired entries (every 10 minutes)
const intervalId = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}, 10 * 60 * 1000);
if (intervalId && typeof intervalId.unref === 'function') {
  intervalId.unref();
}

module.exports = {
  connect,
  disconnect,
  getClient,
  get,
  set,
  del,
  delPattern,
  remember,
  TTL,
  KEYS,
};
