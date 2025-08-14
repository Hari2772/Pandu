const jwt = require('jsonwebtoken');
const User = require('../models/User');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Check Redis cache first
    const cachedUser = await redisManager.getClient().get(`token:${token}`);
    if (cachedUser) {
      req.user = JSON.parse(cachedUser);
      return next();
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const user = await User.findById(decoded.id)
      .select('-password -emailVerificationToken -passwordResetToken');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Cache user data in Redis for 5 minutes
    const userData = {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      tier: user.tier,
      isEmailVerified: user.isEmailVerified
    };

    await redisManager.getClient().setex(
      `token:${token}`,
      300, // 5 minutes
      JSON.stringify(userData)
    );

    req.user = userData;
    next();

  } catch (error) {
    logger.error('Authentication error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Continue without authentication
    }

    const token = authHeader.substring(7);

    // Check Redis cache first
    const cachedUser = await redisManager.getClient().get(`token:${token}`);
    if (cachedUser) {
      req.user = JSON.parse(cachedUser);
      return next();
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findById(decoded.id)
      .select('-password -emailVerificationToken -passwordResetToken');

    if (user && user.isActive) {
      const userData = {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        tier: user.tier,
        isEmailVerified: user.isEmailVerified
      };

      await redisManager.getClient().setex(
        `token:${token}`,
        300,
        JSON.stringify(userData)
      );

      req.user = userData;
    }

    next();

  } catch (error) {
    // Don't fail on authentication errors for optional auth
    logger.debug('Optional authentication error:', error);
    next();
  }
};

// Role-based access control middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Admin access middleware
const requireAdmin = requireRole(['admin', 'super_admin']);

// Super admin access middleware
const requireSuperAdmin = requireRole(['super_admin']);

// Tier-based access control middleware
const requireTier = (minTier) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.tier < minTier) {
      return res.status(403).json({
        success: false,
        message: `Minimum tier ${minTier} required`
      });
    }

    next();
  };
};

// Feature flag middleware
const requireFeature = (featureName) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Check if feature is enabled for user
      const FeatureFlag = require('../models/FeatureFlag');
      const feature = await FeatureFlag.findOne({ name: featureName });

      if (!feature || !feature.isEnabled) {
        return res.status(403).json({
          success: false,
          message: 'Feature not available'
        });
      }

      // Check rollout percentage
      if (feature.rolloutPercentage < 100) {
        const userHash = require('crypto')
          .createHash('md5')
          .update(req.user.id.toString())
          .digest('hex');
        
        const userRollout = parseInt(userHash.substring(0, 8), 16) % 100;
        
        if (userRollout >= feature.rolloutPercentage) {
          return res.status(403).json({
            success: false,
            message: 'Feature not available for your account'
          });
        }
      }

      // Check dependencies
      if (feature.dependencies && feature.dependencies.length > 0) {
        for (const dep of feature.dependencies) {
          const depFeature = await FeatureFlag.findOne({ name: dep });
          if (!depFeature || !depFeature.isEnabled) {
            return res.status(403).json({
              success: false,
              message: `Feature dependency '${dep}' not available`
            });
          }
        }
      }

      next();

    } catch (error) {
      logger.error('Feature flag check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Feature availability check failed'
      });
    }
  };
};

// Rate limiting middleware for specific endpoints
const rateLimit = (maxRequests, windowMs) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old requests
    if (requests.has(key)) {
      requests.set(key, requests.get(key).filter(timestamp => timestamp > windowStart));
    }

    const userRequests = requests.get(key) || [];
    
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later'
      });
    }

    userRequests.push(now);
    requests.set(key, userRequests);

    next();
  };
};

// Session validation middleware
const validateSession = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user session is still valid in database
    const user = await User.findById(req.user.id).select('isActive lastSeen');
    
    if (!user || !user.isActive) {
      // Clear cached token
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.substring(7);
        await redisManager.getClient().del(`token:${token}`);
      }

      return res.status(401).json({
        success: false,
        message: 'Session expired or invalid'
      });
    }

    // Update last seen
    if (user.lastSeen) {
      const timeDiff = Date.now() - user.lastSeen.getTime();
      if (timeDiff > 30 * 60 * 1000) { // 30 minutes
        await User.findByIdAndUpdate(req.user.id, { lastSeen: new Date() });
      }
    }

    next();

  } catch (error) {
    logger.error('Session validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Session validation failed'
    });
  }
};

// Device fingerprinting middleware (optional)
const deviceFingerprint = (req, res, next) => {
  try {
    const fingerprint = req.headers['x-device-fingerprint'] || 
                       req.headers['user-agent'] || 
                       req.ip;

    if (fingerprint) {
      req.deviceFingerprint = fingerprint;
    }

    next();
  } catch (error) {
    logger.debug('Device fingerprinting error:', error);
    next();
  }
};

// Logging middleware for authenticated requests
const logAuthenticatedRequest = (req, res, next) => {
  if (req.user) {
    logger.info(`Authenticated request: ${req.method} ${req.path} by user ${req.user.username} (${req.user.id})`);
  }
  next();
};

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireTier,
  requireFeature,
  rateLimit,
  validateSession,
  deviceFingerprint,
  logAuthenticatedRequest
};