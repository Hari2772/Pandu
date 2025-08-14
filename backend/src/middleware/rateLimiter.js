const redisManager = require('../config/redis');
const logger = require('../utils/logger');

// Rate limiting middleware
const rateLimiter = (key, maxRequests, windowMs) => {
  return async (req, res, next) => {
    try {
      // Get identifier (IP address or user ID if authenticated)
      const identifier = req.user ? req.user._id.toString() : (req.ip || req.connection.remoteAddress);
      const rateLimitKey = `rate_limit:${key}:${identifier}`;

      // Get current request count
      const currentCount = await redisManager.getClient().incr(rateLimitKey);

      // Set expiry on first request
      if (currentCount === 1) {
        await redisManager.getClient().expire(rateLimitKey, Math.ceil(windowMs / 1000));
      }

      // Check if limit exceeded
      if (currentCount > maxRequests) {
        // Get time until reset
        const ttl = await redisManager.getClient().ttl(rateLimitKey);
        
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: Math.ceil(windowMs / 1000),
            resetIn: ttl,
            retryAfter: ttl
          }
        });
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - currentCount),
        'X-RateLimit-Reset': Math.ceil(Date.now() / 1000) + Math.ceil(windowMs / 1000)
      });

      next();

    } catch (error) {
      logger.error('Rate limiter error:', error);
      // Continue on error to avoid blocking requests
      next();
    }
  };
};

// Dynamic rate limiting based on user tier
const tierBasedRateLimiter = (baseKey, baseLimit, windowMs) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for tier-based rate limiting'
        });
      }

      // Adjust limit based on user tier
      const tier = req.user.tier || 5;
      let adjustedLimit = baseLimit;

      // Higher tiers get more requests
      switch (tier) {
        case 1: // Immediate tier
          adjustedLimit = Math.floor(baseLimit * 2.5);
          break;
        case 2: // Very Close tier
          adjustedLimit = Math.floor(baseLimit * 2.0);
          break;
        case 3: // Close tier
          adjustedLimit = Math.floor(baseLimit * 1.5);
          break;
        case 4: // Nearby tier
          adjustedLimit = Math.floor(baseLimit * 1.2);
          break;
        case 5: // Regional tier
          adjustedLimit = baseLimit;
          break;
        case 6: // Extended tier
          adjustedLimit = Math.floor(baseLimit * 0.8);
          break;
        default:
          adjustedLimit = baseLimit;
      }

      // Apply rate limiting with adjusted limit
      return rateLimiter(baseKey, adjustedLimit, windowMs)(req, res, next);

    } catch (error) {
      logger.error('Tier-based rate limiter error:', error);
      next();
    }
  };
};

// Burst rate limiting (allows burst of requests)
const burstRateLimiter = (key, maxRequests, windowMs, burstLimit) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user ? req.user._id.toString() : (req.ip || req.connection.remoteAddress);
      const rateLimitKey = `rate_limit:${key}:${identifier}`;
      const burstKey = `burst:${key}:${identifier}`;

      // Check burst limit first
      const burstCount = await redisManager.getClient().incr(burstKey);
      
      if (burstCount === 1) {
        await redisManager.getClient().expire(burstKey, 60); // 1 minute burst window
      }

      if (burstCount > burstLimit) {
        return res.status(429).json({
          success: false,
          message: 'Burst rate limit exceeded',
          error: {
            code: 'BURST_LIMIT_EXCEEDED',
            burstLimit,
            retryAfter: 60
          }
        });
      }

      // Apply regular rate limiting
      return rateLimiter(key, maxRequests, windowMs)(req, res, next);

    } catch (error) {
      logger.error('Burst rate limiter error:', error);
      next();
    }
  };
};

// Sliding window rate limiting
const slidingWindowRateLimiter = (key, maxRequests, windowMs) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user ? req.user._id.toString() : (req.ip || req.connection.remoteAddress);
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use sorted set for sliding window
      const rateLimitKey = `sliding_rate_limit:${key}:${identifier}`;

      // Remove old entries
      await redisManager.getClient().zremrangebyscore(rateLimitKey, 0, windowStart);

      // Count current requests in window
      const currentCount = await redisManager.getClient().zcard(rateLimitKey);

      if (currentCount >= maxRequests) {
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: Math.ceil(windowMs / 1000),
            retryAfter: Math.ceil(windowMs / 1000)
          }
        });
      }

      // Add current request
      await redisManager.getClient().zadd(rateLimitKey, now, `${now}-${Math.random()}`);
      await redisManager.getClient().expire(rateLimitKey, Math.ceil(windowMs / 1000));

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - currentCount - 1),
        'X-RateLimit-Reset': Math.ceil((now + windowMs) / 1000)
      });

      next();

    } catch (error) {
      logger.error('Sliding window rate limiter error:', error);
      next();
    }
  };
};

// Adaptive rate limiting (adjusts based on server load)
const adaptiveRateLimiter = (key, baseLimit, windowMs) => {
  return async (req, res, next) => {
    try {
      // Get server load metrics
      const loadAvg = process.loadavg ? process.loadavg()[0] : 0;
      const memoryUsage = process.memoryUsage();
      const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

      // Adjust limit based on server load
      let adjustedLimit = baseLimit;

      if (loadAvg > 2.0 || memoryUsagePercent > 80) {
        // High load - reduce limit
        adjustedLimit = Math.floor(baseLimit * 0.5);
      } else if (loadAvg > 1.0 || memoryUsagePercent > 60) {
        // Medium load - slightly reduce limit
        adjustedLimit = Math.floor(baseLimit * 0.8);
      }

      // Apply adjusted rate limiting
      return rateLimiter(key, adjustedLimit, windowMs)(req, res, next);

    } catch (error) {
      logger.error('Adaptive rate limiter error:', error);
      // Fall back to base rate limiting
      return rateLimiter(key, baseLimit, windowMs)(req, res, next);
    }
  };
};

// Rate limit info middleware
const rateLimitInfo = (req, res, next) => {
  try {
    const identifier = req.user ? req.user._id.toString() : (req.ip || req.connection.remoteAddress);
    
    // Add rate limit info to request for logging/monitoring
    req.rateLimitInfo = {
      identifier,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      timestamp: new Date()
    };

    next();
  } catch (error) {
    logger.error('Rate limit info middleware error:', error);
    next();
  }
};

// Clean up expired rate limit keys
const cleanupRateLimits = async () => {
  try {
    const keys = await redisManager.getClient().keys('rate_limit:*');
    const slidingKeys = await redisManager.getClient().keys('sliding_rate_limit:*');
    const burstKeys = await redisManager.getClient().keys('burst:*');

    const allKeys = [...keys, ...slidingKeys, ...burstKeys];
    
    for (const key of allKeys) {
      const ttl = await redisManager.getClient().ttl(key);
      if (ttl === -1) {
        // Key has no expiry, set default expiry
        await redisManager.getClient().expire(key, 3600); // 1 hour
      }
    }

    logger.info(`Cleaned up ${allKeys.length} rate limit keys`);
  } catch (error) {
    logger.error('Rate limit cleanup error:', error);
  }
};

// Schedule cleanup every hour
setInterval(cleanupRateLimits, 60 * 60 * 1000);

module.exports = {
  rateLimiter,
  tierBasedRateLimiter,
  burstRateLimiter,
  slidingWindowRateLimiter,
  adaptiveRateLimiter,
  rateLimitInfo,
  cleanupRateLimits
};