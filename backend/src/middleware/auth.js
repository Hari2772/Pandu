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
    
    // Check if user exists and is active
    const user = await User.findById(decoded.id).select('_id username displayName email role isActive isDeleted tier');
    
    if (!user || !user.isActive || user.isDeleted) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or inactive user account'
      });
    }

    // Check if token is blacklisted in Redis
    const isBlacklisted = await redisManager.getClient().get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked'
      });
    }

    // Attach user to request
    req.user = {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      tier: user.tier
    };

    // Update last active timestamp
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
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    } else {
      logger.error('Authentication error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authentication failed'
      });
    }
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

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
};

// Tier-based access control middleware
const requireTier = (minTier) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userTier = req.user.tier || 0;

    if (userTier < minTier) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient tier level',
        required: minTier,
        current: userTier
      });
    }

    next();
  };
};

// Optional authentication middleware (for public routes that can show different content for authenticated users)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id username displayName email role isActive tier');
        
        if (user && user.isActive && !user.isDeleted) {
          req.user = {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            tier: user.tier
          };
        }
      } catch (error) {
        // Token is invalid, but we continue without authentication
        logger.debug('Optional auth failed:', error.message);
      }
    }

    next();
  } catch (error) {
    logger.error('Optional authentication error:', error);
    next(); // Continue without authentication
  }
};

// API key authentication middleware
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API key required'
      });
    }

    // Check if API key exists and is valid
    const validApiKey = await redisManager.getClient().get(`apikey:${apiKey}`);
    
    if (!validApiKey) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key'
      });
    }

    // Parse API key data
    const apiKeyData = JSON.parse(validApiKey);
    
    // Check if API key is expired
    if (apiKeyData.expiresAt && new Date() > new Date(apiKeyData.expiresAt)) {
      return res.status(401).json({
        success: false,
        message: 'API key expired'
      });
    }

    // Check rate limits
    const rateLimitKey = `rate_limit:${apiKey}`;
    const currentUsage = await redisManager.getClient().get(rateLimitKey);
    
    if (currentUsage && parseInt(currentUsage) >= apiKeyData.rateLimit) {
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded',
        limit: apiKeyData.rateLimit,
        resetTime: await redisManager.getClient().ttl(rateLimitKey)
      });
    }

    // Increment rate limit counter
    await redisManager.getClient().incr(rateLimitKey);
    await redisManager.getClient().expire(rateLimitKey, 3600); // Reset every hour

    // Attach API key data to request
    req.apiKey = apiKeyData;
    req.user = {
      id: apiKeyData.userId,
      username: apiKeyData.username,
      role: 'api_user',
      tier: apiKeyData.tier || 0
    };

    next();

  } catch (error) {
    logger.error('API key authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Session-based authentication middleware (for web admin panel)
const authenticateSession = async (req, res, next) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        message: 'Session authentication required'
      });
    }

    const user = await User.findById(req.session.userId).select('_id username displayName email role isActive isDeleted tier');
    
    if (!user || !user.isActive || user.isDeleted) {
      // Clear invalid session
      req.session.destroy();
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session'
      });
    }

    // Attach user to request
    req.user = {
      id: user._id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      tier: user.tier
    };

    // Extend session
    req.session.touch();

    next();

  } catch (error) {
    logger.error('Session authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Two-factor authentication middleware
const require2FA = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const user = await User.findById(req.user.id).select('twoFactorEnabled twoFactorVerified');
    
    if (user.twoFactorEnabled && !user.twoFactorVerified) {
      return res.status(403).json({
        success: false,
        message: 'Two-factor authentication required',
        requires2FA: true
      });
    }

    next();

  } catch (error) {
    logger.error('2FA check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Two-factor authentication check failed'
    });
  }
};

// Device verification middleware
const requireDeviceVerification = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const deviceId = req.headers['x-device-id'] || req.body.deviceId;
    
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'Device ID required'
      });
    }

    // Check if device is verified for this user
    const user = await User.findById(req.user.id).select('verifiedDevices');
    const device = user.verifiedDevices.find(d => d.deviceId === deviceId);
    
    if (!device || !device.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Device verification required',
        requiresDeviceVerification: true,
        deviceId
      });
    }

    // Attach device info to request
    req.device = device;
    next();

  } catch (error) {
    logger.error('Device verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Device verification check failed'
    });
  }
};

// Logout middleware (blacklist token)
const logout = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      // Add token to blacklist with expiration
      const decoded = jwt.decode(token);
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      
      if (expiresIn > 0) {
        await redisManager.getClient().setex(`blacklist:${token}`, expiresIn, 'revoked');
      }
    }

    next();
  } catch (error) {
    logger.error('Logout middleware error:', error);
    next(); // Continue even if blacklisting fails
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requireTier,
  optionalAuth,
  authenticateApiKey,
  authenticateSession,
  require2FA,
  requireDeviceVerification,
  logout
};