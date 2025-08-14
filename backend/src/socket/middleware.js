const { verifyJWT } = require('../utils/auth');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

class SocketMiddleware {
  constructor() {
    this.connectionAttempts = new Map(); // socketId -> attempts
    this.rateLimitWindow = 60000; // 1 minute
    this.maxConnectionAttempts = 5;
  }

  // Authentication middleware
  async authenticate(socket, next) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace('Bearer ', '');

      // Verify JWT token
      const decoded = await verifyJWT(cleanToken);
      if (!decoded || !decoded.userId) {
        return next(new Error('Invalid authentication token'));
      }

      // Check if user exists and is active
      const user = await redisManager.getClient().get(`user:${decoded.userId}`);
      if (!user) {
        return next(new Error('User not found or session expired'));
      }

      // Attach user info to socket
      socket.userId = decoded.userId;
      socket.user = JSON.parse(user);

      // Check rate limiting
      if (this.isRateLimited(socket.id)) {
        return next(new Error('Too many connection attempts'));
      }

      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  }

  // Rate limiting middleware
  isRateLimited(socketId) {
    const now = Date.now();
    const attempts = this.connectionAttempts.get(socketId) || [];

    // Remove old attempts outside the window
    const validAttempts = attempts.filter(timestamp => now - timestamp < this.rateLimitWindow);

    if (validAttempts.length >= this.maxConnectionAttempts) {
      return true;
    }

    // Add current attempt
    validAttempts.push(now);
    this.connectionAttempts.set(socketId, validAttempts);

    // Clean up old entries
    setTimeout(() => {
      this.connectionAttempts.delete(socketId);
    }, this.rateLimitWindow);

    return false;
  }

  // Connection validation middleware
  validateConnection(socket, next) {
    try {
      const { deviceId, platform, appVersion } = socket.handshake.auth;

      // Validate required connection parameters
      if (!deviceId || !platform) {
        return next(new Error('Device ID and platform are required'));
      }

      // Validate platform
      const validPlatforms = ['ios', 'android', 'web', 'desktop'];
      if (!validPlatforms.includes(platform)) {
        return next(new Error('Invalid platform'));
      }

      // Attach device info to socket
      socket.deviceId = deviceId;
      socket.platform = platform;
      socket.appVersion = appVersion;

      next();
    } catch (error) {
      logger.error('Connection validation error:', error);
      next(new Error('Connection validation failed'));
    }
  }

  // Error handling middleware
  handleError(socket, error) {
    logger.error(`Socket error for user ${socket.userId}:`, error);

    // Send error to client
    socket.emit('error', {
      message: error.message || 'An error occurred',
      code: error.code || 'UNKNOWN_ERROR'
    });

    // Disconnect socket on critical errors
    if (error.code === 'AUTH_ERROR' || error.code === 'RATE_LIMIT_ERROR') {
      socket.disconnect(true);
    }
  }

  // Logging middleware
  logConnection(socket) {
    logger.info(`Socket connection established: ${socket.id}`, {
      userId: socket.userId,
      deviceId: socket.deviceId,
      platform: socket.platform,
      appVersion: socket.appVersion,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']
    });
  }

  logDisconnection(socket) {
    logger.info(`Socket disconnection: ${socket.id}`, {
      userId: socket.userId,
      deviceId: socket.deviceId,
      platform: socket.platform,
      duration: socket.handshake.time ? Date.now() - socket.handshake.time : 'unknown'
    });
  }

  // Cleanup middleware
  cleanup(socket) {
    // Remove rate limiting data
    this.connectionAttempts.delete(socket.id);

    // Log disconnection
    this.logDisconnection(socket);
  }

  // Get all middleware functions
  getMiddleware() {
    return [
      this.authenticate.bind(this),
      this.validateConnection.bind(this)
    ];
  }

  // Get error handler
  getErrorHandler() {
    return this.handleError.bind(this);
  }

  // Get cleanup handler
  getCleanupHandler() {
    return this.cleanup.bind(this);
  }
}

module.exports = new SocketMiddleware();