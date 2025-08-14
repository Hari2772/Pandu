const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { incrementRateLimit, getRateLimit } = require('../config/redis');
const logger = require('../utils/logger');

// Global rate limiter for all requests
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.logSecurity('rate_limit_exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: 15 * 60
    });
  }
});

// Authentication rate limiter (more strict)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth attempts per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.logSecurity('auth_rate_limit_exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: 15 * 60
    });
  }
});

// User-specific rate limiter
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each user to 500 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise use IP
    return req.user ? req.user.id : req.ip;
  },
  handler: (req, res) => {
    logger.logSecurity('user_rate_limit_exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.',
      retryAfter: 15 * 60
    });
  }
});

// Story creation rate limiter
const storyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each user to 10 stories per hour
  message: {
    success: false,
    message: 'Too many stories created, please try again later.',
    retryAfter: 60 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  handler: (req, res) => {
    logger.logSecurity('story_rate_limit_exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      url: req.url
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many stories created, please try again later.',
      retryAfter: 60 * 60
    });
  }
});

// Message rate limiter
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each user to 30 messages per minute
  message: {
    success: false,
    message: 'Too many messages sent, please slow down.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  handler: (req, res) => {
    logger.logSecurity('message_rate_limit_exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      url: req.url
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many messages sent, please slow down.',
      retryAfter: 60
    });
  }
});

// Friend request rate limiter
const friendRequestLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 50, // Limit each user to 50 friend requests per day
  message: {
    success: false,
    message: 'Too many friend requests sent today, please try again tomorrow.',
    retryAfter: 24 * 60 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  handler: (req, res) => {
    logger.logSecurity('friend_request_rate_limit_exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      url: req.url
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many friend requests sent today, please try again tomorrow.',
      retryAfter: 24 * 60 * 60
    });
  }
});

// Search rate limiter
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit each user to 20 searches per minute
  message: {
    success: false,
    message: 'Too many searches, please slow down.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  handler: (req, res) => {
    logger.logSecurity('search_rate_limit_exceeded', {
      userId: req.user?.id,
      ip: req.ip,
      url: req.url
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many searches, please slow down.',
      retryAfter: 60
    });
  }
});

// Slow down middleware for repeated requests
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Allow 100 requests per 15 minutes without delay
  delayMs: 500, // Add 500ms delay per request after delayAfter
  maxDelayMs: 20000, // Maximum delay of 20 seconds
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  skip: (req) => {
    // Skip slowdown for certain endpoints
    return req.path.startsWith('/health') || req.path.startsWith('/api/admin');
  }
});

// Redis-based rate limiter for high-traffic scenarios
const redisRateLimiter = (maxRequests = 100, windowMs = 60 * 1000) => {
  return async (req, res, next) => {
    try {
      const key = req.user ? `rate_limit:user:${req.user.id}` : `rate_limit:ip:${req.ip}`;
      const current = await incrementRateLimit(key, windowMs / 1000);

      if (current > maxRequests) {
        logger.logSecurity('redis_rate_limit_exceeded', {
          userId: req.user?.id,
          ip: req.ip,
          key,
          current,
          maxRequests
        });

        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - current),
        'X-RateLimit-Reset': Date.now() + windowMs
      });

      next();
    } catch (error) {
      logger.error('Redis rate limiter error:', error);
      // Continue without rate limiting if Redis fails
      next();
    }
  };
};

// Concurrent user limiter
const concurrentUserLimiter = (maxConcurrentUsers = 25000) => {
  let currentUsers = 0;
  const userSessions = new Map();

  return (req, res, next) => {
    const userId = req.user?.id || req.ip;
    
    if (!userSessions.has(userId)) {
      if (currentUsers >= maxConcurrentUsers) {
        logger.logSecurity('concurrent_user_limit_exceeded', {
          currentUsers,
          maxConcurrentUsers,
          userId
        });

        return res.status(503).json({
          success: false,
          message: 'Server is at maximum capacity, please try again later.',
          code: 'MAX_CAPACITY'
        });
      }

      currentUsers++;
      userSessions.set(userId, Date.now());
    } else {
      // Update existing session
      userSessions.set(userId, Date.now());
    }

    // Clean up old sessions periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
      const now = Date.now();
      const sessionTimeout = 30 * 60 * 1000; // 30 minutes

      for (const [key, timestamp] of userSessions.entries()) {
        if (now - timestamp > sessionTimeout) {
          userSessions.delete(key);
          currentUsers = Math.max(0, currentUsers - 1);
        }
      }
    }

    next();
  };
};

// Graceful degradation middleware
const gracefulDegradation = (req, res, next) => {
  // Check system load
  const memUsage = process.memoryUsage();
  const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  // If memory usage is high, return simplified responses
  if (heapUsedPercent > 90) {
    logger.warn('High memory usage detected, enabling graceful degradation', {
      heapUsedPercent,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal
    });

    req.gracefulDegradation = true;
  }

  // Check CPU usage (simplified)
  const startTime = process.hrtime();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const responseTime = seconds * 1000 + nanoseconds / 1000000;

    if (responseTime > 5000) { // 5 seconds
      logger.warn('Slow response detected', {
        url: req.url,
        method: req.method,
        responseTime,
        userId: req.user?.id
      });
    }
  });

  next();
};

// Circuit breaker pattern for external services
const circuitBreaker = (failureThreshold = 5, timeout = 60000) => {
  let failures = 0;
  let lastFailureTime = 0;
  let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN

  return (req, res, next) => {
    if (state === 'OPEN') {
      if (Date.now() - lastFailureTime > timeout) {
        state = 'HALF_OPEN';
      } else {
        return res.status(503).json({
          success: false,
          message: 'Service temporarily unavailable',
          code: 'CIRCUIT_OPEN'
        });
      }
    }

    // Add error handler to track failures
    const originalSend = res.send;
    res.send = function(data) {
      if (res.statusCode >= 500) {
        failures++;
        lastFailureTime = Date.now();

        if (failures >= failureThreshold) {
          state = 'OPEN';
          logger.error('Circuit breaker opened', {
            failures,
            failureThreshold,
            url: req.url
          });
        }
      } else {
        if (state === 'HALF_OPEN') {
          state = 'CLOSED';
          failures = 0;
        }
      }

      return originalSend.call(this, data);
    };

    next();
  };
};

// Export all rate limiters
module.exports = {
  globalLimiter,
  authLimiter,
  userLimiter,
  storyLimiter,
  messageLimiter,
  friendRequestLimiter,
  searchLimiter,
  speedLimiter,
  redisRateLimiter,
  concurrentUserLimiter,
  gracefulDegradation,
  circuitBreaker
};