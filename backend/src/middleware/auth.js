const jwt = require('jsonwebtoken');
const User = require('../models/User');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

// JWT token verification middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Check if token is blacklisted
    const isBlacklisted = await redisManager.getClient().get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked'
      });
    }

    // Get user from database
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check if user is deleted
    if (user.isDeleted) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deleted'
      });
    }

    // Add user info to request
    req.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      tier: user.tier,
      isEmailVerified: user.isEmailVerified
    };

    // Update last activity
    await User.findByIdAndUpdate(user._id, {
      lastActiveDate: new Date()
    });

    next();

  } catch (error) {
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

    logger.error('Authentication middleware error:', error);
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
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.userId) {
          // Check if token is blacklisted
          const isBlacklisted = await redisManager.getClient().get(`blacklist:${token}`);
          if (!isBlacklisted) {
            const user = await User.findById(decoded.userId).select('-password');
            if (user && user.isActive && !user.isDeleted) {
              req.user = {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                tier: user.tier,
                isEmailVerified: user.isEmailVerified
              };
            }
          }
        }
      } catch (error) {
        // Token is invalid, but we don't fail the request
        logger.debug('Optional auth token invalid:', error.message);
      }
    }

    next();
  } catch (error) {
    logger.error('Optional authentication middleware error:', error);
    next();
  }
};

// Role-based authorization middleware
const authorizeRole = (...roles) => {
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

// Admin authorization middleware
const authorizeAdmin = (req, res, next) => {
  return authorizeRole('admin', 'superadmin')(req, res, next);
};

// Super admin authorization middleware
const authorizeSuperAdmin = (req, res, next) => {
  return authorizeRole('superadmin')(req, res, next);
};

// Tier-based authorization middleware
const authorizeTier = (minTier) => {
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

// Email verification required middleware
const requireEmailVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!req.user.isEmailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required'
    });
  }

  next();
};

// Rate limiting middleware for authentication
const authRateLimit = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const key = `auth:rate:${ip}`;
    
    const attempts = await redisManager.getClient().incr(key);
    
    if (attempts === 1) {
      await redisManager.getClient().expire(key, 300); // 5 minutes
    }
    
    if (attempts > 5) { // Max 5 auth attempts per 5 minutes
      return res.status(429).json({
        success: false,
        message: 'Too many authentication attempts. Please try again later.'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Auth rate limit error:', error);
    next();
  }
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

    // Check if user session is still valid in Redis
    const sessionKey = `session:${req.user.id}`;
    const sessionData = await redisManager.getClient().get(sessionKey);
    
    if (!sessionData) {
      return res.status(401).json({
        success: false,
        message: 'Session expired'
      });
    }

    // Validate session data
    const session = JSON.parse(sessionData);
    if (session.userId !== req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session'
      });
    }

    // Check if session is expired
    if (session.expiresAt && new Date() > new Date(session.expiresAt)) {
      await redisManager.getClient().del(sessionKey);
      return res.status(401).json({
        success: false,
        message: 'Session expired'
      });
    }

    // Extend session if needed
    if (session.expiresAt) {
      const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      session.expiresAt = newExpiry;
      await redisManager.getClient().setex(sessionKey, 86400, JSON.stringify(session));
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

// Device validation middleware
const validateDevice = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const deviceId = req.headers['x-device-id'];
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'Device ID required'
      });
    }

    // Check if device is authorized for this user
    const deviceKey = `device:${req.user.id}:${deviceId}`;
    const deviceData = await redisManager.getClient().get(deviceKey);
    
    if (!deviceData) {
      return res.status(403).json({
        success: false,
        message: 'Device not authorized'
      });
    }

    // Validate device data
    const device = JSON.parse(deviceData);
    if (device.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Device not authorized for this user'
      });
    }

    // Check if device is active
    if (!device.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Device is deactivated'
      });
    }

    // Add device info to request
    req.device = {
      id: deviceId,
      type: device.type,
      platform: device.platform,
      version: device.version
    };

    next();

  } catch (error) {
    logger.error('Device validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Device validation failed'
    });
  }
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
      const feature = await FeatureFlag.findOne({
        name: featureName,
        isActive: true
      });

      if (!feature) {
        return res.status(403).json({
          success: false,
          message: 'Feature not available'
        });
      }

      // Check if user has access to feature
      if (feature.userTiers && !feature.userTiers.includes(req.user.tier)) {
        return res.status(403).json({
          success: false,
          message: 'Feature not available for your tier'
        });
      }

      // Check if feature is enabled for user's role
      if (feature.userRoles && !feature.userRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Feature not available for your role'
        });
      }

      next();

    } catch (error) {
      logger.error('Feature flag middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Feature validation failed'
      });
    }
  };
};

// Logout middleware (blacklist token)
const logout = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      // Add token to blacklist
      const decoded = jwt.decode(token);
      if (decoded && decoded.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redisManager.getClient().setex(`blacklist:${token}`, ttl, 'revoked');
        }
      }
    }

    next();
  } catch (error) {
    logger.error('Logout middleware error:', error);
    next();
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  authorizeRole,
  authorizeAdmin,
  authorizeSuperAdmin,
  authorizeTier,
  requireEmailVerification,
  authRateLimit,
  validateSession,
  validateDevice,
  requireFeature,
  logout
};