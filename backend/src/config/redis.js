const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;
let redisSubscriber = null;
let redisPublisher = null;

const connectRedis = async () => {
  try {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4,
      connectTimeout: 10000,
      commandTimeout: 5000,
      maxLoadingTimeout: 10000,
      enableReadyCheck: true,
      maxMemoryPolicy: 'allkeys-lru',
      maxMemory: '512mb',
      // Connection pooling
      maxConnections: 50,
      minConnections: 10,
      // Retry strategy
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Reconnect strategy
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      }
    };

    // Main Redis client for general operations
    redisClient = new Redis(redisConfig);

    // Redis subscriber for pub/sub operations
    redisSubscriber = new Redis(redisConfig);

    // Redis publisher for pub/sub operations
    redisPublisher = new Redis(redisConfig);

    // Event handlers for main client
    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    redisClient.on('close', () => {
      logger.warn('Redis client connection closed');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });

    // Event handlers for subscriber
    redisSubscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
    });

    redisSubscriber.on('ready', () => {
      logger.info('Redis subscriber ready');
    });

    redisSubscriber.on('error', (err) => {
      logger.error('Redis subscriber error:', err);
    });

    // Event handlers for publisher
    redisPublisher.on('connect', () => {
      logger.info('Redis publisher connected');
    });

    redisPublisher.on('ready', () => {
      logger.info('Redis publisher ready');
    });

    redisPublisher.on('error', (err) => {
      logger.error('Redis publisher error:', err);
    });

    // Test connection
    await redisClient.ping();
    logger.info('Redis connection established successfully');

    // Initialize Redis with default data structures
    await initializeRedisData();

  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
};

const initializeRedisData = async () => {
  try {
    // Set default TTL for various data types
    const defaultTTLs = {
      'user:session': 86400, // 24 hours
      'user:online': 300,    // 5 minutes
      'chat:typing': 10,     // 10 seconds
      'streak:cache': 3600,  // 1 hour
      'story:cache': 3600,   // 1 hour
      'rate:limit': 60,      // 1 minute
      'webrtc:session': 300, // 5 minutes
      'broadcast:live': 7200 // 2 hours
    };

    // Store TTLs in Redis for reference
    for (const [key, ttl] of Object.entries(defaultTTLs)) {
      await redisClient.set(`ttl:${key}`, ttl, 'EX', 86400);
    }

    logger.info('Redis data structures initialized');

  } catch (error) {
    logger.error('Error initializing Redis data:', error);
  }
};

// Redis utility functions
const setWithTTL = async (key, value, ttl = 3600) => {
  try {
    await redisClient.setex(key, ttl, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.error(`Error setting Redis key ${key}:`, error);
    return false;
  }
};

const getFromRedis = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error(`Error getting Redis key ${key}:`, error);
    return null;
  }
};

const deleteFromRedis = async (key) => {
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    logger.error(`Error deleting Redis key ${key}:`, error);
    return false;
  }
};

const publishMessage = async (channel, message) => {
  try {
    await redisPublisher.publish(channel, JSON.stringify(message));
    return true;
  } catch (error) {
    logger.error(`Error publishing to Redis channel ${channel}:`, error);
    return false;
  }
};

const subscribeToChannel = async (channel, callback) => {
  try {
    await redisSubscriber.subscribe(channel);
    redisSubscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          const parsedMessage = JSON.parse(message);
          callback(parsedMessage);
        } catch (error) {
          logger.error('Error parsing Redis message:', error);
        }
      }
    });
    return true;
  } catch (error) {
    logger.error(`Error subscribing to Redis channel ${channel}:`, error);
    return false;
  }
};

const unsubscribeFromChannel = async (channel) => {
  try {
    await redisSubscriber.unsubscribe(channel);
    return true;
  } catch (error) {
    logger.error(`Error unsubscribing from Redis channel ${channel}:`, error);
    return false;
  }
};

// Rate limiting with Redis
const incrementRateLimit = async (key, window = 60) => {
  try {
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, window);
    }
    return current;
  } catch (error) {
    logger.error(`Error incrementing rate limit for ${key}:`, error);
    return 0;
  }
};

const getRateLimit = async (key) => {
  try {
    const current = await redisClient.get(key);
    return current ? parseInt(current) : 0;
  } catch (error) {
    logger.error(`Error getting rate limit for ${key}:`, error);
    return 0;
  }
};

// User session management
const setUserSession = async (userId, sessionData) => {
  const key = `user:session:${userId}`;
  return await setWithTTL(key, sessionData, 86400); // 24 hours
};

const getUserSession = async (userId) => {
  const key = `user:session:${userId}`;
  return await getFromRedis(key);
};

const removeUserSession = async (userId) => {
  const key = `user:session:${userId}`;
  return await deleteFromRedis(key);
};

// Online user tracking
const setUserOnline = async (userId, userData) => {
  const key = `user:online:${userId}`;
  return await setWithTTL(key, userData, 300); // 5 minutes
};

const getUserOnline = async (userId) => {
  const key = `user:online:${userId}`;
  return await getFromRedis(key);
};

const removeUserOnline = async (userId) => {
  const key = `user:online:${userId}`;
  return await deleteFromRedis(key);
};

// Get all online users
const getAllOnlineUsers = async () => {
  try {
    const keys = await redisClient.keys('user:online:*');
    const users = [];
    
    for (const key of keys) {
      const userData = await getFromRedis(key);
      if (userData) {
        users.push(userData);
      }
    }
    
    return users;
  } catch (error) {
    logger.error('Error getting online users:', error);
    return [];
  }
};

// Redis health check
const checkRedisHealth = async () => {
  try {
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
};

// Get Redis statistics
const getRedisStats = async () => {
  try {
    const info = await redisClient.info();
    const stats = {};
    
    info.split('\r\n').forEach(line => {
      const [key, value] = line.split(':');
      if (key && value) {
        stats[key] = value;
      }
    });
    
    return stats;
  } catch (error) {
    logger.error('Error getting Redis stats:', error);
    return null;
  }
};

// Graceful shutdown
const closeRedisConnections = async () => {
  try {
    if (redisClient) {
      await redisClient.quit();
      logger.info('Redis client connection closed');
    }
    if (redisSubscriber) {
      await redisSubscriber.quit();
      logger.info('Redis subscriber connection closed');
    }
    if (redisPublisher) {
      await redisPublisher.quit();
      logger.info('Redis publisher connection closed');
    }
  } catch (error) {
    logger.error('Error closing Redis connections:', error);
  }
};

module.exports = {
  connectRedis,
  redisClient,
  redisSubscriber,
  redisPublisher,
  setWithTTL,
  getFromRedis,
  deleteFromRedis,
  publishMessage,
  subscribeToChannel,
  unsubscribeFromChannel,
  incrementRateLimit,
  getRateLimit,
  setUserSession,
  getUserSession,
  removeUserSession,
  setUserOnline,
  getUserOnline,
  removeUserOnline,
  getAllOnlineUsers,
  checkRedisHealth,
  getRedisStats,
  closeRedisConnections
};