const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const TierData = require('../../models/TierData');
const Analytics = require('../../models/Analytics');
const redisManager = require('../../config/redis');
const logger = require('../../utils/logger');
const constants = require('../../utils/constants');

class AuthHandler {
  constructor(io) {
    this.io = io;
    this.authenticatedUsers = new Map(); // socketId -> userData
    this.userSockets = new Map(); // userId -> Set of socketIds
  }

  // Handle socket authentication
  async handleAuthentication(socket, token, callback) {
    try {
      if (!token) {
        return callback({ error: 'Authentication token required' });
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id;

      // Check if user exists and is active
      const user = await User.findById(userId).select('-password');
      if (!user || !user.isActive) {
        return callback({ error: 'Invalid or inactive user' });
      }

      // Check if user is already connected (prevent multiple connections)
      const existingSockets = this.userSockets.get(userId) || new Set();
      if (existingSockets.size > 0) {
        // Disconnect existing connections
        existingSockets.forEach(socketId => {
          const existingSocket = this.io.sockets.sockets.get(socketId);
          if (existingSocket) {
            existingSocket.disconnect(true);
          }
        });
      }

      // Store user data
      const userData = {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        profilePicture: user.profilePicture,
        role: user.role,
        tier: user.tier,
        isOnline: true,
        lastSeen: new Date()
      };

      this.authenticatedUsers.set(socket.id, userData);
      
      // Add socket to user's socket set
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(socket.id);

      // Update user status in database
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: new Date(),
        lastActiveDate: new Date()
      });

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          isOnline: true,
          lastSeen: new Date(),
          lastUpdate: new Date()
        },
        { upsert: true }
      );

      // Cache user data in Redis
      await redisManager.getClient().setex(
        `user:${userId}`,
        3600, // 1 hour
        JSON.stringify(userData)
      );

      // Join user to their personal room
      socket.join(`user:${userId}`);

      // Join user to their tier room for location-based features
      socket.join(`tier:${user.tier}`);

      // Track analytics
      await Analytics.create({
        eventType: 'user_login',
        eventName: 'Socket Authentication',
        eventCategory: 'user',
        userId: user._id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          socketId: socket.id,
          connectionType: 'websocket'
        }
      });

      // Emit authentication success
      callback({ success: true, user: userData });

      // Broadcast user online status to friends
      await this.broadcastUserStatus(userId, true);

      // Send user's current data
      socket.emit('auth:success', {
        user: userData,
        serverTime: new Date(),
        features: await this.getUserFeatures(userId)
      });

      logger.info(`User ${user.username} authenticated via socket ${socket.id}`);

    } catch (error) {
      logger.error('Socket authentication error:', error);
      
      if (error.name === 'JsonWebTokenError') {
        callback({ error: 'Invalid token' });
      } else if (error.name === 'TokenExpiredError') {
        callback({ error: 'Token expired' });
      } else {
        callback({ error: 'Authentication failed' });
      }
    }
  }

  // Handle socket disconnection
  async handleDisconnection(socket) {
    try {
      const userData = this.authenticatedUsers.get(socket.id);
      if (!userData) return;

      const userId = userData.id;

      // Remove socket from tracking
      this.authenticatedUsers.delete(socket.id);
      
      const userSockets = this.userSockets.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.userSockets.delete(userId);
          
          // User has no more active connections
          await this.handleUserOffline(userId);
        }
      }

      logger.info(`User ${userData.username} disconnected from socket ${socket.id}`);

    } catch (error) {
      logger.error('Socket disconnection error:', error);
    }
  }

  // Handle user going offline
  async handleUserOffline(userId) {
    try {
      // Update user status in database
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date()
      });

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          isOnline: false,
          lastSeen: new Date(),
          lastUpdate: new Date()
        }
      );

      // Remove from Redis cache
      await redisManager.getClient().del(`user:${userId}`);

      // Broadcast user offline status to friends
      await this.broadcastUserStatus(userId, false);

      // Track analytics
      await Analytics.create({
        eventType: 'user_logout',
        eventName: 'Socket Disconnection',
        eventCategory: 'user',
        userId,
        sessionId: 'socket',
        platform: 'socket',
        metadata: {
          reason: 'connection_closed'
        }
      });

    } catch (error) {
      logger.error('Handle user offline error:', error);
    }
  }

  // Broadcast user status to friends
  async broadcastUserStatus(userId, isOnline) {
    try {
      const user = await User.findById(userId)
        .populate('friends.userId', 'username displayName profilePicture');

      if (!user) return;

      const statusData = {
        userId: user._id,
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        isOnline,
        lastSeen: user.lastSeen
      };

      // Send to user's friends
      user.friends.forEach(friend => {
        const friendSockets = this.userSockets.get(friend.userId);
        if (friendSockets) {
          friendSockets.forEach(socketId => {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('user:status', statusData);
            }
          });
        }
      });

      // Send to nearby users in same tier
      const tierSockets = this.io.sockets.adapter.rooms.get(`tier:${user.tier}`);
      if (tierSockets) {
        tierSockets.forEach(socketId => {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket && socket.id !== socketId) {
            const socketUserData = this.authenticatedUsers.get(socketId);
            if (socketUserData && socketUserData.id !== userId) {
              socket.emit('nearby:user_status', statusData);
            }
          }
        });
      }

    } catch (error) {
      logger.error('Broadcast user status error:', error);
    }
  }

  // Get user's enabled features
  async getUserFeatures(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) return {};

      // Get feature flags from Redis cache first
      const cachedFeatures = await redisManager.getClient().get('feature_flags');
      let features = {};

      if (cachedFeatures) {
        features = JSON.parse(cachedFeatures);
      } else {
        // Fallback to database if cache miss
        const FeatureFlag = require('../../models/FeatureFlag');
        const featureFlags = await FeatureFlag.find({ isActive: true });
        
        features = featureFlags.reduce((acc, flag) => {
          acc[flag.name] = {
            enabled: flag.isEnabled,
            rollout: flag.rolloutPercentage,
            dependencies: flag.dependencies
          };
          return acc;
        }, {});

        // Cache features for 5 minutes
        await redisManager.getClient().setex(
          'feature_flags',
          300,
          JSON.stringify(features)
        );
      }

      // Apply user-specific feature overrides
      if (user.role === 'admin') {
        // Admins get access to all features
        Object.keys(features).forEach(key => {
          features[key].enabled = true;
        });
      }

      return features;

    } catch (error) {
      logger.error('Get user features error:', error);
      return {};
    }
  }

  // Validate user session
  async validateSession(socket) {
    const userData = this.authenticatedUsers.get(socket.id);
    if (!userData) {
      socket.emit('auth:expired', { message: 'Session expired' });
      socket.disconnect(true);
      return false;
    }
    return userData;
  }

  // Get user data by socket ID
  getUserBySocketId(socketId) {
    return this.authenticatedUsers.get(socketId);
  }

  // Get user data by user ID
  getUserById(userId) {
    for (const [socketId, userData] of this.authenticatedUsers) {
      if (userData.id.toString() === userId.toString()) {
        return userData;
      }
    }
    return null;
  }

  // Get all online users
  getOnlineUsers() {
    return Array.from(this.authenticatedUsers.values());
  }

  // Get user's socket count
  getUserSocketCount(userId) {
    const userSockets = this.userSockets.get(userId);
    return userSockets ? userSockets.size : 0;
  }

  // Check if user is online
  isUserOnline(userId) {
    return this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
  }

  // Get user's active sockets
  getUserSockets(userId) {
    return this.userSockets.get(userId) || new Set();
  }

  // Broadcast to user's sockets
  broadcastToUser(userId, event, data) {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(event, data);
        }
      });
    }
  }

  // Broadcast to multiple users
  broadcastToUsers(userIds, event, data) {
    userIds.forEach(userId => {
      this.broadcastToUser(userId, event, data);
    });
  }

  // Broadcast to tier
  broadcastToTier(tier, event, data, excludeUserId = null) {
    const tierSockets = this.io.sockets.adapter.rooms.get(`tier:${tier}`);
    if (tierSockets) {
      tierSockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          const socketUserData = this.authenticatedUsers.get(socketId);
          if (socketUserData && socketUserData.id.toString() !== excludeUserId?.toString()) {
            socket.emit(event, data);
          }
        }
      });
    }
  }

  // Get connection statistics
  getConnectionStats() {
    return {
      totalConnections: this.authenticatedUsers.size,
      uniqueUsers: this.userSockets.size,
      totalSockets: Array.from(this.userSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0)
    };
  }

  // Clean up expired sessions
  async cleanupExpiredSessions() {
    try {
      const now = new Date();
      const expiredSockets = [];

      for (const [socketId, userData] of this.authenticatedUsers) {
        const lastSeen = new Date(userData.lastSeen);
        const timeDiff = now - lastSeen;
        
        // Consider session expired after 30 minutes of inactivity
        if (timeDiff > 30 * 60 * 1000) {
          expiredSockets.push(socketId);
        }
      }

      expiredSockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('auth:expired', { message: 'Session expired due to inactivity' });
          socket.disconnect(true);
        }
      });

      if (expiredSockets.length > 0) {
        logger.info(`Cleaned up ${expiredSockets.length} expired sessions`);
      }

    } catch (error) {
      logger.error('Cleanup expired sessions error:', error);
    }
  }
}

module.exports = AuthHandler;