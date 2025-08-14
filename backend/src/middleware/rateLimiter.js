const redisManager = require('../config/redis');
const logger = require('../utils/logger');

// Rate limiting middleware factory
const rateLimiter = (key, maxRequests, windowSeconds) => {
  return async (req, res, next) => {
    try {
      // Get client identifier (IP address or user ID)
      const identifier = req.user ? req.user.id : req.ip || req.connection.remoteAddress;
      const rateKey = `rate_limit:${key}:${identifier}`;

      // Get current request count
      const currentCount = await redisManager.getClient().incr(rateKey);

      // Set expiry on first request
      if (currentCount === 1) {
        await redisManager.getClient().expire(rateKey, windowSeconds);
      }

      // Check if rate limit exceeded
      if (currentCount > maxRequests) {
        // Get time until reset
        const ttl = await redisManager.getClient().ttl(rateKey);
        
        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + ttl
        });

        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: windowSeconds,
            resetIn: ttl
          }
        });
      }

      // Set rate limit headers
      const ttl = await redisManager.getClient().ttl(rateKey);
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - currentCount),
        'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + ttl
      });

      next();

    } catch (error) {
      logger.error('Rate limiting error:', error);
      // Continue without rate limiting if Redis fails
      next();
    }
  };
};

// Dynamic rate limiting based on user tier
const dynamicRateLimiter = (baseKey, baseRequests, windowSeconds) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        // Apply base rate limit for unauthenticated users
        return rateLimiter(baseKey, Math.floor(baseRequests * 0.1), windowSeconds)(req, res, next);
      }

      // Calculate rate limit based on user tier
      const tierMultiplier = Math.min(3, 1 + (req.user.tier - 1) * 0.2); // Max 3x for tier 6
      const adjustedRequests = Math.floor(baseRequests * tierMultiplier);

      // Apply adjusted rate limit
      return rateLimiter(baseKey, adjustedRequests, windowSeconds)(req, res, next);

    } catch (error) {
      logger.error('Dynamic rate limiting error:', error);
      next();
    }
  };
};

// Burst rate limiting (allows short bursts above normal limit)
const burstRateLimiter = (key, normalRequests, burstRequests, windowSeconds) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user ? req.user.id : req.ip || req.connection.remoteAddress;
      const normalKey = `rate_limit:${key}:${identifier}:normal`;
      const burstKey = `rate_limit:${key}:${identifier}:burst`;

      // Check normal rate limit
      const normalCount = await redisManager.getClient().incr(normalKey);
      if (normalCount === 1) {
        await redisManager.getClient().expire(normalKey, windowSeconds);
      }

      // Check burst rate limit (shorter window)
      const burstWindow = Math.min(10, Math.floor(windowSeconds * 0.1)); // 10% of normal window
      const burstCount = await redisManager.getClient().incr(burstKey);
      if (burstCount === 1) {
        await redisManager.getClient().expire(burstKey, burstWindow);
      }

      // Apply stricter limit for burst
      if (burstCount > burstRequests) {
        const ttl = await redisManager.getClient().ttl(burstKey);
        return res.status(429).json({
          success: false,
          message: 'Burst rate limit exceeded',
          error: {
            code: 'BURST_RATE_LIMIT_EXCEEDED',
            limit: burstRequests,
            window: burstWindow,
            resetIn: ttl
          }
        });
      }

      // Apply normal rate limit
      if (normalCount > normalRequests) {
        const ttl = await redisManager.getClient().ttl(normalKey);
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            limit: normalRequests,
            window: windowSeconds,
            resetIn: ttl
          }
        });
      }

      next();

    } catch (error) {
      logger.error('Burst rate limiting error:', error);
      next();
    }
  };
};

// Sliding window rate limiting
const slidingWindowRateLimiter = (key, maxRequests, windowSeconds) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user ? req.user.id : req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const windowStart = now - (windowSeconds * 1000);

      // Use sorted set to track requests with timestamps
      const rateKey = `rate_limit:${key}:${identifier}`;
      
      // Add current request
      await redisManager.getClient().zadd(rateKey, now, `${now}-${Math.random()}`);

      // Remove expired requests
      await redisManager.getClient().zremrangebyscore(rateKey, 0, windowStart);

      // Count requests in current window
      const requestCount = await redisManager.getClient().zcard(rateKey);

      // Set expiry
      await redisManager.getClient().expire(rateKey, windowSeconds);

      if (requestCount > maxRequests) {
        // Get oldest request timestamp
        const oldestRequest = await redisManager.getClient().zrange(rateKey, 0, 0, 'WITHSCORES');
        const resetTime = Math.floor((parseInt(oldestRequest[1]) + (windowSeconds * 1000)) / 1000);

        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: windowSeconds,
            resetIn: resetTime - Math.floor(now / 1000)
          }
        });
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - requestCount),
        'X-RateLimit-Reset': Math.floor((now + (windowSeconds * 1000)) / 1000)
      });

      next();

    } catch (error) {
      logger.error('Sliding window rate limiting error:', error);
      next();
    }
  };
};

// User-specific rate limiting
const userRateLimiter = (key, maxRequests, windowSeconds) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for rate limiting'
        });
      }

      const rateKey = `rate_limit:${key}:user:${req.user.id}`;
      const currentCount = await redisManager.getClient().incr(rateKey);

      if (currentCount === 1) {
        await redisManager.getClient().expire(rateKey, windowSeconds);
      }

      if (currentCount > maxRequests) {
        const ttl = await redisManager.getClient().ttl(rateKey);
        
        return res.status(429).json({
          success: false,
          message: 'User rate limit exceeded',
          error: {
            code: 'USER_RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: windowSeconds,
            resetIn: ttl
          }
        });
      }

      next();

    } catch (error) {
      logger.error('User rate limiting error:', error);
      next();
    }
  };
};

// IP-based rate limiting with whitelist
const ipRateLimiter = (key, maxRequests, windowSeconds, whitelist = []) => {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.connection.remoteAddress;

      // Check whitelist
      if (whitelist.includes(ip)) {
        return next();
      }

      const rateKey = `rate_limit:${key}:ip:${ip}`;
      const currentCount = await redisManager.getClient().incr(rateKey);

      if (currentCount === 1) {
        await redisManager.getClient().expire(rateKey, windowSeconds);
      }

      if (currentCount > maxRequests) {
        const ttl = await redisManager.getClient().ttl(rateKey);
        
        return res.status(429).json({
          success: false,
          message: 'IP rate limit exceeded',
          error: {
            code: 'IP_RATE_LIMIT_EXCEEDED',
            limit: maxRequests,
            window: windowSeconds,
            resetIn: ttl
          }
        });
      }

      next();

    } catch (error) {
      logger.error('IP rate limiting error:', error);
      next();
    }
  };
};

// Rate limit info middleware
const rateLimitInfo = (req, res, next) => {
  try {
    const identifier = req.user ? req.user.id : req.ip || req.connection.remoteAddress;
    const key = req.route ? req.route.path : 'unknown';
    const rateKey = `rate_limit:${key}:${identifier}`;

    // Get current count and TTL
    redisManager.getClient().multi()
      .get(rateKey)
      .ttl(rateKey)
      .exec((err, results) => {
        if (!err && results) {
          const currentCount = parseInt(results[0]) || 0;
          const ttl = results[1] || 0;

          res.set({
            'X-RateLimit-Current': currentCount,
            'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + ttl
          });
        }
        next();
      });

  } catch (error) {
    logger.error('Rate limit info error:', error);
    next();
  }
};

// Rate limit cleanup (remove expired entries)
const cleanupRateLimits = async () => {
  try {
    // This would be called periodically to clean up expired rate limit keys
    // Redis automatically expires keys, but we can add additional cleanup logic here
    logger.debug('Rate limit cleanup completed');
  } catch (error) {
    logger.error('Rate limit cleanup error:', error);
  }
};

// Export rate limiting functions
module.exports = {
  rateLimiter,
  dynamicRateLimiter,
  burstRateLimiter,
  slidingWindowRateLimiter,
  userRateLimiter,
  ipRateLimiter,
  rateLimitInfo,
  cleanupRateLimits
};