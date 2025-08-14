const jwt = require('jsonwebtoken');
const User = require('../models/User');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

// Verify JWT token
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

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive'
      });
    }

    // Check if token is blacklisted
    const isBlacklisted = await redisManager.getClient().exists(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked'
      });
    }

    // Add user to request
    req.user = user;
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

    logger.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        
        if (user && user.isActive) {
          const isBlacklisted = await redisManager.getClient().exists(`blacklist:${token}`);
          if (!isBlacklisted) {
            req.user = user;
          }
        }
      } catch (error) {
        // Token is invalid, but we continue without authentication
        logger.debug('Optional auth failed:', error.message);
      }
    }

    next();
  } catch (error) {
    logger.error('Optional authentication error:', error);
    next();
  }
};

// Role-based authorization
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

// Admin authorization
const authorizeAdmin = (req, res, next) => {
  return authorizeRole('admin', 'super_admin')(req, res, next);
};

// Super admin authorization
const authorizeSuperAdmin = (req, res, next) => {
  return authorizeRole('super_admin')(req, res, next);
};

// Check if user owns resource or is admin
const authorizeResourceOwner = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const resourceUserId = req.body[resourceUserIdField] || req.params[resourceUserIdField];
    
    if (!resourceUserId) {
      return res.status(400).json({
        success: false,
        message: 'Resource user ID not found'
      });
    }

    // Allow if user owns the resource or is admin
    if (req.user._id.toString() === resourceUserId.toString() || 
        ['admin', 'super_admin'].includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied to this resource'
    });
  };
};

// Check if user is participant in chat/group
const authorizeParticipant = (participantsField = 'participants') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const resourceId = req.params.chatId || req.params.groupId;
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          message: 'Resource ID not found'
        });
      }

      // Check if user is admin (admin can access all resources)
      if (['admin', 'super_admin'].includes(req.user.role)) {
        return next();
      }

      // Check if user is participant
      const Chat = require('../models/Chat');
      const Group = require('../models/Group');

      let isParticipant = false;

      // Check in chats
      const chat = await Chat.findById(resourceId);
      if (chat && chat.participants.includes(req.user._id)) {
        isParticipant = true;
      }

      // Check in groups
      if (!isParticipant) {
        const group = await Group.findById(resourceId);
        if (group && group.members.includes(req.user._id)) {
          isParticipant = true;
        }
      }

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this resource'
        });
      }

      next();
    } catch (error) {
      logger.error('Participant authorization error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authorization check failed'
      });
    }
  };
};

// Rate limiting for authentication attempts
const authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  return async (req, res, next) => {
    try {
      const identifier = req.ip || req.connection.remoteAddress;
      const key = `auth_attempts:${identifier}`;

      const attempts = await redisManager.getClient().incr(key);
      
      if (attempts === 1) {
        await redisManager.getClient().expire(key, windowMs / 1000);
      }

      if (attempts > maxAttempts) {
        return res.status(429).json({
          success: false,
          message: 'Too many authentication attempts. Please try again later.'
        });
      }

      next();
    } catch (error) {
      logger.error('Auth rate limit error:', error);
      next(); // Continue on error
    }
  };
};

// Check if user is online
const requireOnline = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.user.isOnline) {
      return res.status(400).json({
        success: false,
        message: 'User must be online for this action'
      });
    }

    next();
  } catch (error) {
    logger.error('Require online check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Online status check failed'
    });
  }
};

// Validate session
const validateSession = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user's session is still valid
    const sessionValid = await redisManager.getClient().exists(`user:${req.user._id}`);
    if (!sessionValid) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please login again.'
      });
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

module.exports = {
  authenticateToken,
  optionalAuth,
  authorizeRole,
  authorizeAdmin,
  authorizeSuperAdmin,
  authorizeResourceOwner,
  authorizeParticipant,
  authRateLimit,
  requireOnline,
  validateSession
};