const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyToken, refreshToken } = require('../config/auth');
const logger = require('../utils/logger');

/**
 * Middleware to authenticate JWT tokens
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify token
    const decoded = verifyToken(token);
    
    // Check if user exists and is not blocked
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Account is blocked'
      });
    }

    // Add user to request object
    req.user = user;
    next();

  } catch (error) {
    logger.error('Token authentication failed:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Middleware to handle token refresh
 */
const refreshTokenMiddleware = async (req, res, next) => {
  try {
    const { refreshToken: refreshTokenFromBody } = req.body;

    if (!refreshTokenFromBody) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    const newTokens = await refreshToken(refreshTokenFromBody);

    res.json({
      success: true,
      data: newTokens,
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    logger.error('Token refresh failed:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).select('-password');
    
    if (user && !user.isBlocked) {
      req.user = user;
    } else {
      req.user = null;
    }

    next();

  } catch (error) {
    // Don't fail for optional auth, just set user to null
    req.user = null;
    next();
  }
};

/**
 * Middleware to check if user is online
 */
const requireOnline = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Update user's online status
    if (!req.user.isOnline) {
      req.user.isOnline = true;
      req.user.lastSeen = new Date();
      await req.user.save();
    }

    next();

  } catch (error) {
    logger.error('Online status check failed:', error);
    next();
  }
};

/**
 * Middleware to validate user permissions
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user has the required permission
    const hasPermission = checkUserPermission(req.user, permission);
    
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

/**
 * Helper function to check user permissions
 */
const checkUserPermission = (user, permission) => {
  // Admin has all permissions
  if (user.role === 'admin' || user.isAdmin) {
    return true;
  }

  // Define permission hierarchy
  const permissions = {
    'user:read': ['user', 'moderator', 'admin'],
    'user:write': ['moderator', 'admin'],
    'user:delete': ['admin'],
    'story:read': ['user', 'moderator', 'admin'],
    'story:write': ['user', 'moderator', 'admin'],
    'story:delete': ['moderator', 'admin'],
    'admin:read': ['moderator', 'admin'],
    'admin:write': ['admin']
  };

  const allowedRoles = permissions[permission] || [];
  return allowedRoles.includes(user.role);
};

/**
 * Middleware to rate limit based on user
 */
const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const userId = req.user.id;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get user's request history
    let userRequests = requests.get(userId) || [];
    
    // Remove old requests outside the window
    userRequests = userRequests.filter(timestamp => timestamp > windowStart);
    
    // Check if user has exceeded the limit
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // Add current request
    userRequests.push(now);
    requests.set(userId, userRequests);

    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
      for (const [key, value] of requests.entries()) {
        if (value.length === 0 || value[value.length - 1] < windowStart) {
          requests.delete(key);
        }
      }
    }

    next();
  };
};

/**
 * Middleware to validate user session
 */
const validateSession = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user's session is still valid
    const lastSeen = req.user.lastSeen;
    const sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours

    if (lastSeen && (Date.now() - lastSeen.getTime()) > sessionTimeout) {
      return res.status(401).json({
        success: false,
        message: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }

    // Update last seen
    req.user.lastSeen = new Date();
    await req.user.save();

    next();

  } catch (error) {
    logger.error('Session validation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Session validation failed'
    });
  }
};

/**
 * Middleware to check if user can access specific resource
 */
const canAccessResource = (resourceType) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const resourceId = req.params[`${resourceType}Id`] || req.params.id;
      
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          message: 'Resource ID required'
        });
      }

      // Check if user owns the resource or has admin access
      if (req.user.role === 'admin' || req.user.isAdmin) {
        return next();
      }

      // For user-specific resources, check ownership
      if (resourceType === 'user' && req.user.id === resourceId) {
        return next();
      }

      // For other resources, check if user is the owner
      const resource = await getResource(resourceType, resourceId);
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }

      if (resource.userId && resource.userId.toString() === req.user.id) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });

    } catch (error) {
      logger.error('Resource access check failed:', error);
      res.status(500).json({
        success: false,
        message: 'Access check failed'
      });
    }
  };
};

/**
 * Helper function to get resource by type and ID
 */
const getResource = async (resourceType, resourceId) => {
  switch (resourceType) {
    case 'story':
      return await require('../models/Story').findById(resourceId);
    case 'user':
      return await User.findById(resourceId);
    default:
      return null;
  }
};

/**
 * Middleware to log authentication events
 */
const logAuthEvent = (eventType) => {
  return (req, res, next) => {
    logger.logSecurity(eventType, {
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    next();
  };
};

module.exports = {
  authenticateToken,
  refreshTokenMiddleware,
  optionalAuth,
  requireOnline,
  requirePermission,
  userRateLimit,
  validateSession,
  canAccessResource,
  logAuthEvent
};