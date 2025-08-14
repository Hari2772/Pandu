const redisManager = require('../config/redis');
const logger = require('../utils/logger');

// Rate limiting middleware factory
const rateLimiter = (type, maxRequests, windowMs, options = {}) => {
  return async (req, res, next) => {
    try {
      const {
        keyGenerator = null,
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        errorMessage = 'Rate limit exceeded',
        headers = true
      } = options;

      // Generate rate limit key
      let key;
      if (keyGenerator) {
        key = keyGenerator(req);
      } else {
        // Default key generation based on user ID or IP
        const identifier = req.user ? req.user.id : req.ip;
        key = `rate_limit:${type}:${identifier}`;
      }

      if (!key) {
        return next();
      }

      // Get current usage from Redis
      const currentUsage = await redisManager.getClient().get(key);
      const requests = currentUsage ? parseInt(currentUsage) : 0;

      // Check if limit exceeded
      if (requests >= maxRequests) {
        // Get time until reset
        const ttl = await redisManager.getClient().ttl(key);
        
        if (headers) {
          res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': 0,
            'X-RateLimit-Reset': Math.ceil(Date.now() / 1000) + ttl,
            'Retry-After': ttl
          });
        }

        return res.status(429).json({
          success: false,
          message: errorMessage,
          limit: maxRequests,
          window: windowMs,
          resetTime: Math.ceil(Date.now() / 1000) + ttl,
          retryAfter: ttl
        });
      }

      // Increment counter
      const multi = redisManager.getClient().multi();
      multi.incr(key);
      multi.expire(key, Math.ceil(windowMs / 1000));
      
      const results = await multi.exec();
      const newCount = results[0][1];

      // Set response headers
      if (headers) {
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': Math.max(0, maxRequests - newCount),
          'X-RateLimit-Reset': Math.ceil(Date.now() / 1000) + Math.ceil(windowMs / 1000)
        });
      }

      // Track rate limit usage for analytics
      if (req.user) {
        try {
          const Analytics = require('../models/Analytics');
          await Analytics.create({
            eventType: 'rate_limit_check',
            eventName: 'Rate Limit Check',
            eventCategory: 'system',
            userId: req.user.id,
            sessionId: req.sessionID || 'unknown',
            platform: 'web',
            metadata: {
              type,
              currentUsage: newCount,
              maxRequests,
              windowMs,
              endpoint: req.path,
              method: req.method
            }
          });
        } catch (error) {
          logger.debug('Failed to track rate limit analytics:', error.message);
        }
      }

      next();

    } catch (error) {
      logger.error('Rate limiting error:', error);
      // Continue without rate limiting on error
      next();
    }
  };
};

// User-specific rate limiter
const userRateLimiter = (type, maxRequests, windowMs, options = {}) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for rate limiting'
      });
    }

    const userOptions = {
      ...options,
      keyGenerator: (req) => `rate_limit:${type}:user:${req.user.id}`
    };

    return rateLimiter(type, maxRequests, windowMs, userOptions)(req, res, next);
  };
};

// IP-based rate limiter
const ipRateLimiter = (type, maxRequests, windowMs, options = {}) => {
  return async (req, res, next) => {
    const ipOptions = {
      ...options,
      keyGenerator: (req) => `rate_limit:${type}:ip:${req.ip}`
    };

    return rateLimiter(type, maxRequests, windowMs, ipOptions)(req, res, next);
  };
};

// Tier-based rate limiter
const tierRateLimiter = (type, baseRequests, windowMs, options = {}) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for tier-based rate limiting'
      });
    }

    // Calculate requests based on user tier
    const tierMultiplier = Math.max(1, req.user.tier - 1);
    const maxRequests = baseRequests + (tierMultiplier * 5); // +5 per tier level

    const tierOptions = {
      ...options,
      keyGenerator: (req) => `rate_limit:${type}:tier:${req.user.tier}:${req.user.id}`,
      errorMessage: `Rate limit exceeded for tier ${req.user.tier}`
    };

    return rateLimiter(type, maxRequests, windowMs, tierOptions)(req, res, next);
  };
};

// Burst rate limiter (allows burst of requests with cooldown)
const burstRateLimiter = (type, burstLimit, cooldownMs, options = {}) => {
  return async (req, res, next) => {
    try {
      const {
        keyGenerator = null,
        errorMessage = 'Burst rate limit exceeded'
      } = options;

      // Generate key
      let key;
      if (keyGenerator) {
        key = keyGenerator(req);
      } else {
        const identifier = req.user ? req.user.id : req.ip;
        key = `burst_limit:${type}:${identifier}`;
      }

      if (!key) {
        return next();
      }

      // Get current burst count
      const currentBurst = await redisManager.getClient().get(key);
      const burstCount = currentBurst ? parseInt(currentBurst) : 0;

      if (burstCount >= burstLimit) {
        // Check if cooldown period has passed
        const ttl = await redisManager.getClient().ttl(key);
        
        if (ttl > 0) {
          return res.status(429).json({
            success: false,
            message: errorMessage,
            burstLimit,
            cooldownMs,
            resetTime: Math.ceil(Date.now() / 1000) + ttl,
            retryAfter: ttl
          });
        } else {
          // Reset burst counter
          await redisManager.getClient().del(key);
        }
      }

      // Increment burst counter
      const multi = redisManager.getClient().multi();
      multi.incr(key);
      multi.expire(key, Math.ceil(cooldownMs / 1000));
      
      await multi.exec();

      next();

    } catch (error) {
      logger.error('Burst rate limiting error:', error);
      next();
    }
  };
};

// Adaptive rate limiter (adjusts limits based on user behavior)
const adaptiveRateLimiter = (type, baseRequests, windowMs, options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for adaptive rate limiting'
        });
      }

      const {
        minRequests = 1,
        maxRequests = baseRequests * 5,
        behaviorWindow = 24 * 60 * 60 * 1000, // 24 hours
        goodBehaviorThreshold = 100,
        badBehaviorThreshold = 10
      } = options;

      // Get user behavior score
      const behaviorKey = `behavior_score:${req.user.id}`;
      const behaviorScore = await redisManager.getClient().get(behaviorKey);
      const score = behaviorScore ? parseInt(behaviorScore) : 50; // Default neutral score

      // Calculate adaptive limit
      let adaptiveLimit = baseRequests;
      if (score > goodBehaviorThreshold) {
        adaptiveLimit = Math.min(maxRequests, baseRequests * 2);
      } else if (score < badBehaviorThreshold) {
        adaptiveLimit = Math.max(minRequests, Math.floor(baseRequests * 0.5));
      }

      const adaptiveOptions = {
        ...options,
        keyGenerator: (req) => `rate_limit:${type}:adaptive:${req.user.id}`,
        errorMessage: `Rate limit exceeded (adaptive limit: ${adaptiveLimit})`
      };

      return rateLimiter(type, adaptiveLimit, windowMs, adaptiveOptions)(req, res, next);

    } catch (error) {
      logger.error('Adaptive rate limiting error:', error);
      next();
    }
  };
};

// Global rate limiter for entire application
const globalRateLimiter = (maxRequests, windowMs, options = {}) => {
  return async (req, res, next) => {
    const globalOptions = {
      ...options,
      keyGenerator: () => 'rate_limit:global:all',
      errorMessage: 'Global rate limit exceeded'
    };

    return rateLimiter('global', maxRequests, windowMs, globalOptions)(req, res, next);
  };
};

// Rate limit status middleware
const getRateLimitStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = req.user.id;
    const rateLimits = [];

    // Get all rate limit keys for user
    const keys = await redisManager.getClient().keys(`rate_limit:*:${userId}`);
    
    for (const key of keys) {
      const [_, type, identifier] = key.split(':');
      const currentUsage = await redisManager.getClient().get(key);
      const ttl = await redisManager.getClient().ttl(key);
      
      if (currentUsage && ttl > 0) {
        rateLimits.push({
          type,
          identifier,
          currentUsage: parseInt(currentUsage),
          ttl,
          resetTime: Math.ceil(Date.now() / 1000) + ttl
        });
      }
    }

    res.json({
      success: true,
      data: {
        userId,
        rateLimits,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Get rate limit status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get rate limit status'
    });
  }
};

// Reset rate limit for user (admin only)
const resetUserRateLimit = async (req, res) => {
  try {
    const { userId, type } = req.params;
    
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const pattern = type ? `rate_limit:${type}:*:${userId}` : `rate_limit:*:${userId}`;
    const keys = await redisManager.getClient().keys(pattern);
    
    if (keys.length > 0) {
      await redisManager.getClient().del(...keys);
    }

    res.json({
      success: true,
      message: 'Rate limits reset successfully',
      data: {
        resetKeys: keys.length,
        userId,
        type: type || 'all'
      }
    });

  } catch (error) {
    logger.error('Reset rate limit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset rate limits'
    });
  }
};

module.exports = {
  rateLimiter,
  userRateLimiter,
  ipRateLimiter,
  tierRateLimiter,
  burstRateLimiter,
  adaptiveRateLimiter,
  globalRateLimiter,
  getRateLimitStatus,
  resetUserRateLimit
};