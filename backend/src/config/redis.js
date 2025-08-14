const Redis = require('ioredis');
const logger = require('../utils/logger');

class RedisManager {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const config = this.getRedisConfig();
      
      this.client = new Redis(config);
      this.subscriber = new Redis(config);
      this.publisher = new Redis(config);

      this.setupEventHandlers();
      await this.testConnection();
      
      this.isConnected = true;
      logger.info('Redis connection established successfully');
      
      return this.client;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  getRedisConfig() {
    if (process.env.REDIS_SENTINEL_HOSTS) {
      return {
        sentinels: process.env.REDIS_SENTINEL_HOSTS.split(',').map(host => {
          const [hostname, port] = host.split(':');
          return { host: hostname, port: parseInt(port) };
        }),
        name: 'mymaster',
        password: process.env.REDIS_PASSWORD,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      };
    }

    if (process.env.REDIS_CLUSTER_NODES) {
      return {
        cluster: true,
        nodes: process.env.REDIS_CLUSTER_NODES.split(',').map(host => {
          const [hostname, port] = host.split(':');
          return { host: hostname, port: parseInt(port) };
        }),
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: 3
      };
    }

    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB) || 0,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      connectTimeout: 10000,
      commandTimeout: 5000
    };
  }

  setupEventHandlers() {
    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error:', error);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      logger.warn('Redis client connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });
  }

  async testConnection() {
    try {
      await this.client.ping();
      logger.info('Redis connection test successful');
    } catch (error) {
      throw new Error(`Redis connection test failed: ${error.message}`);
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      if (this.publisher) {
        await this.publisher.quit();
      }
      this.isConnected = false;
      logger.info('Redis connections closed');
    } catch (error) {
      logger.error('Error closing Redis connections:', error);
    }
  }

  getClient() {
    return this.client;
  }

  getSubscriber() {
    return this.subscriber;
  }

  getPublisher() {
    return this.publisher;
  }

  isConnected() {
    return this.isConnected;
  }
}

const redisManager = new RedisManager();
module.exports = redisManager;