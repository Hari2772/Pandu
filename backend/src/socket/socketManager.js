const socketIO = require('socket.io');
const AuthHandler = require('./handlers/authHandler');
const MessageHandler = require('./handlers/messageHandler');
const WebRTCHandler = require('./handlers/webrtcHandler');
const logger = require('../utils/logger');
const redisManager = require('../config/redis');

class SocketManager {
  constructor(server) {
    this.server = server;
    this.io = null;
    this.authHandler = null;
    this.messageHandler = null;
    this.webrtcHandler = null;
    this.cleanupIntervals = [];
  }

  // Initialize Socket.IO
  initialize() {
    try {
      // Create Socket.IO server with Redis adapter for scaling
      this.io = socketIO(this.server, {
        cors: {
          origin: process.env.FRONTEND_URL || "http://localhost:3000",
          methods: ["GET", "POST"],
          credentials: true
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true,
        pingTimeout: 60000,
        pingInterval: 25000,
        upgradeTimeout: 10000,
        maxHttpBufferSize: 1e8, // 100MB
        allowRequest: (req, callback) => {
          // Allow all requests for now, can add rate limiting here
          callback(null, true);
        }
      });

      // Initialize handlers
      this.authHandler = new AuthHandler(this.io);
      this.messageHandler = new MessageHandler(this.io, this.authHandler);
      this.webrtcHandler = new WebRTCHandler(this.io, this.authHandler);

      // Setup event handlers
      this.setupEventHandlers();
      
      // Setup cleanup intervals
      this.setupCleanupIntervals();

      // Setup Redis pub/sub for cross-server communication
      this.setupRedisPubSub();

      logger.info('Socket.IO server initialized successfully');

    } catch (error) {
      logger.error('Socket.IO initialization error:', error);
      throw error;
    }
  }

  // Setup Socket.IO event handlers
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`New socket connection: ${socket.id}`);

      // Handle authentication
      socket.on('auth:authenticate', async (data, callback) => {
        await this.authHandler.handleAuthentication(socket, data.token, callback);
      });

      // Handle disconnection
      socket.on('disconnect', async (reason) => {
        logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
        await this.authHandler.handleDisconnection(socket);
      });

      // Handle reconnection
      socket.on('auth:reconnect', async (data, callback) => {
        await this.handleReconnection(socket, data, callback);
      });

      // Message events
      socket.on('message:send', async (data) => {
        await this.messageHandler.handleNewMessage(socket, data);
      });

      socket.on('message:read', async (data) => {
        await this.messageHandler.handleMessageRead(socket, data);
      });

      socket.on('message:react', async (data) => {
        await this.messageHandler.handleMessageReaction(socket, data);
      });

      socket.on('message:delete', async (data) => {
        await this.messageHandler.handleMessageDelete(socket, data);
      });

      socket.on('message:typing', async (data) => {
        await this.messageHandler.handleTyping(socket, data);
      });

      socket.on('message:search', async (data) => {
        await this.messageHandler.handleMessageSearch(socket, data);
      });

      // WebRTC events
      socket.on('call:initiate', async (data) => {
        await this.webrtcHandler.handleCallInitiate(socket, data);
      });

      socket.on('call:answer', async (data) => {
        await this.webrtcHandler.handleCallAnswer(socket, data);
      });

      socket.on('call:end', async (data) => {
        await this.webrtcHandler.handleCallEnd(socket, data);
      });

      socket.on('webrtc:signal', async (data) => {
        await this.webrtcHandler.handleSignaling(socket, data);
      });

      socket.on('screenshare:start', async (data) => {
        await this.webrtcHandler.handleScreenShareStart(socket, data);
      });

      socket.on('screenshare:stop', async (data) => {
        await this.webrtcHandler.handleScreenShareStop(socket, data);
      });

      socket.on('recording:start', async (data) => {
        await this.webrtcHandler.handleRecordingStart(socket, data);
      });

      socket.on('recording:stop', async (data) => {
        await this.webrtcHandler.handleRecordingStop(socket, data);
      });

      socket.on('quality:metrics', async (data) => {
        await this.webrtcHandler.handleQualityMetrics(socket, data);
      });

      // Location and discovery events
      socket.on('location:update', async (data) => {
        await this.handleLocationUpdate(socket, data);
      });

      socket.on('discovery:nearby', async (data) => {
        await this.handleNearbyDiscovery(socket, data);
      });

      // Story events
      socket.on('story:create', async (data) => {
        await this.handleStoryCreate(socket, data);
      });

      socket.on('story:view', async (data) => {
        await this.handleStoryView(socket, data);
      });

      // Group events
      socket.on('group:join', async (data) => {
        await this.handleGroupJoin(socket, data);
      });

      socket.on('group:leave', async (data) => {
        await this.handleGroupLeave(socket, data);
      });

      // Admin events (admin users only)
      socket.on('admin:broadcast', async (data) => {
        await this.handleAdminBroadcast(socket, data);
      });

      socket.on('admin:feature_toggle', async (data) => {
        await this.handleFeatureToggle(socket, data);
      });

      // Health check
      socket.on('health:ping', (callback) => {
        callback({ pong: Date.now(), serverId: process.env.SERVER_ID || 'main' });
      });

      // Error handling
      socket.on('error', (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
        socket.emit('error', { message: 'An error occurred' });
      });
    });

    // Handle server errors
    this.io.engine.on('connection_error', (err) => {
      logger.error('Socket.IO connection error:', err);
    });
  }

  // Handle user reconnection
  async handleReconnection(socket, data, callback) {
    try {
      const { token, lastSocketId } = data;

      if (!token) {
        return callback({ error: 'Authentication token required' });
      }

      // Authenticate user
      await this.authHandler.handleAuthentication(socket, token, async (authResult) => {
        if (authResult.error) {
          return callback(authResult);
        }

        // Transfer any pending data from old socket
        if (lastSocketId) {
          await this.transferSocketData(lastSocketId, socket.id);
        }

        callback({ success: true, user: authResult.user });
      });

    } catch (error) {
      logger.error('Handle reconnection error:', error);
      callback({ error: 'Reconnection failed' });
    }
  }

  // Handle location updates
  async handleLocationUpdate(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { coordinates, accuracy, address, placeName } = data;

      // Update user location in database
      const User = require('../models/User');
      const user = await User.findById(userData.id);
      if (user) {
        user.updateLocation(coordinates, accuracy);
        await user.save();
      }

      // Update tier data
      const TierData = require('../models/TierData');
      const tierData = await TierData.findOne({ userId: userData.id });
      if (tierData) {
        tierData.updateLocation(coordinates, accuracy, address, placeName);
        await tierData.save();
      }

      // Broadcast to nearby users
      await this.broadcastLocationUpdate(userData.id, coordinates, userData.tier);

      // Track analytics
      const Analytics = require('../models/Analytics');
      await Analytics.create({
        eventType: 'location_updated',
        eventName: 'Location Update',
        eventCategory: 'location',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        location: { coordinates, accuracy, address, placeName }
      });

    } catch (error) {
      logger.error('Handle location update error:', error);
      socket.emit('location:error', { error: 'Failed to update location' });
    }
  }

  // Handle nearby user discovery
  async handleNearbyDiscovery(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { coordinates, radius = 1000, limit = 20 } = data;

      // Find nearby users in same tier
      const TierData = require('../models/TierData');
      const nearbyUsers = await TierData.find({
        userId: { $ne: userData.id },
        tier: userData.tier,
        isOnline: true,
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: coordinates
            },
            $maxDistance: radius
          }
        }
      })
        .populate('userId', 'username displayName profilePicture bio')
        .limit(limit)
        .sort({ 'location.lastUpdated': -1 });

      // Send nearby users to client
      socket.emit('discovery:nearby_results', {
        users: nearbyUsers.map(td => ({
          id: td.userId._id,
          username: td.userId.username,
          displayName: td.userId.displayName,
          profilePicture: td.userId.profilePicture,
          bio: td.userId.bio,
          distance: td.location.distance,
          lastSeen: td.lastSeen
        })),
        total: nearbyUsers.length
      });

    } catch (error) {
      logger.error('Handle nearby discovery error:', error);
      socket.emit('discovery:error', { error: 'Failed to discover nearby users' });
    }
  }

  // Handle story creation
  async handleStoryCreate(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { content, mediaUrl, expiresIn = 24, isPublic = false } = data;

      // Create story
      const Story = require('../models/Story');
      const story = new Story({
        userId: userData.id,
        content,
        mediaUrl,
        expiresIn,
        isPublic,
        location: userData.location
      });

      await story.save();

      // Broadcast to nearby users in same tier
      this.authHandler.broadcastToTier(userData.tier, 'story:new', {
        storyId: story._id,
        userId: userData.id,
        username: userData.username,
        displayName: userData.displayName,
        profilePicture: userData.profilePicture,
        content,
        mediaUrl,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt
      }, userData.id);

      // Track analytics
      const Analytics = require('../models/Analytics');
      await Analytics.create({
        eventType: 'story_created',
        eventName: 'Story Created',
        eventCategory: 'social',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: { storyId: story._id, isPublic, expiresIn }
      });

    } catch (error) {
      logger.error('Handle story create error:', error);
      socket.emit('story:error', { error: 'Failed to create story' });
    }
  }

  // Handle story view
  async handleStoryView(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { storyId } = data;

      // Update story view count
      const Story = require('../models/Story');
      await Story.findByIdAndUpdate(storyId, {
        $inc: { viewCount: 1 },
        $addToSet: { viewedBy: userData.id }
      });

      // Track analytics
      const Analytics = require('../models/Analytics');
      await Analytics.create({
        eventType: 'story_viewed',
        eventName: 'Story Viewed',
        eventCategory: 'social',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: { storyId }
      });

    } catch (error) {
      logger.error('Handle story view error:', error);
    }
  }

  // Handle group join
  async handleGroupJoin(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { groupId } = data;

      // Add user to group
      const Group = require('../models/Group');
      const group = await Group.findById(groupId);
      if (group) {
        group.addParticipant(userData.id, 'member');
        await group.save();

        // Notify group members
        group.participants.forEach(participant => {
          this.authHandler.broadcastToUser(participant.userId, 'group:member_joined', {
            groupId,
            userId: userData.id,
            username: userData.username,
            displayName: userData.displayName,
            profilePicture: userData.profilePicture
          });
        });
      }

    } catch (error) {
      logger.error('Handle group join error:', error);
      socket.emit('group:error', { error: 'Failed to join group' });
    }
  }

  // Handle group leave
  async handleGroupLeave(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { groupId } = data;

      // Remove user from group
      const Group = require('../models/Group');
      const group = await Group.findById(groupId);
      if (group) {
        group.removeParticipant(userData.id);
        await group.save();

        // Notify group members
        group.participants.forEach(participant => {
          this.authHandler.broadcastToUser(participant.userId, 'group:member_left', {
            groupId,
            userId: userData.id,
            username: userData.username
          });
        });
      }

    } catch (error) {
      logger.error('Handle group leave error:', error);
      socket.emit('group:error', { error: 'Failed to leave group' });
    }
  }

  // Handle admin broadcast
  async handleAdminBroadcast(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData || userData.role !== 'admin') {
        socket.emit('admin:error', { error: 'Admin access required' });
        return;
      }

      const { message, targetUsers, targetTiers } = data;

      if (targetUsers && targetUsers.length > 0) {
        // Broadcast to specific users
        this.authHandler.broadcastToUsers(targetUsers, 'admin:broadcast', {
          message,
          from: userData.username,
          timestamp: new Date()
        });
      } else if (targetTiers && targetTiers.length > 0) {
        // Broadcast to specific tiers
        targetTiers.forEach(tier => {
          this.authHandler.broadcastToTier(tier, 'admin:broadcast', {
            message,
            from: userData.username,
            timestamp: new Date()
          });
        });
      } else {
        // Broadcast to all users
        this.io.emit('admin:broadcast', {
          message,
          from: userData.username,
          timestamp: new Date()
        });
      }

      logger.info(`Admin broadcast from ${userData.username}: ${message}`);

    } catch (error) {
      logger.error('Handle admin broadcast error:', error);
      socket.emit('admin:error', { error: 'Failed to send broadcast' });
    }
  }

  // Handle feature toggle
  async handleFeatureToggle(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData || userData.role !== 'admin') {
        socket.emit('admin:error', { error: 'Admin access required' });
        return;
      }

      const { featureName, enabled, rolloutPercentage } = data;

      // Update feature flag
      const FeatureFlag = require('../models/FeatureFlag');
      await FeatureFlag.findOneAndUpdate(
        { name: featureName },
        { 
          isEnabled: enabled,
          rolloutPercentage: rolloutPercentage || 100,
          updatedBy: userData.id,
          updatedAt: new Date()
        },
        { upsert: true }
      );

      // Clear feature flags cache
      await redisManager.getClient().del('feature_flags');

      // Broadcast feature update to all users
      this.io.emit('feature:updated', {
        featureName,
        enabled,
        rolloutPercentage,
        updatedBy: userData.username,
        updatedAt: new Date()
      });

      logger.info(`Feature ${featureName} ${enabled ? 'enabled' : 'disabled'} by ${userData.username}`);

    } catch (error) {
      logger.error('Handle feature toggle error:', error);
      socket.emit('admin:error', { error: 'Failed to toggle feature' });
    }
  }

  // Broadcast location update to nearby users
  async broadcastLocationUpdate(userId, coordinates, tier) {
    try {
      // Find nearby users in same tier
      const TierData = require('../models/TierData');
      const nearbyUsers = await TierData.find({
        userId: { $ne: userId },
        tier,
        isOnline: true,
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: coordinates
            },
            $maxDistance: 1000 // 1km
          }
        }
      }).limit(10);

      // Send location update to nearby users
      nearbyUsers.forEach(td => {
        this.authHandler.broadcastToUser(td.userId, 'location:nearby_update', {
          userId,
          coordinates,
          timestamp: new Date()
        });
      });

    } catch (error) {
      logger.error('Broadcast location update error:', error);
    }
  }

  // Transfer data between sockets
  async transferSocketData(oldSocketId, newSocketId) {
    try {
      // Transfer any pending messages, notifications, etc.
      // This is a placeholder for future implementation
      logger.info(`Transferring data from ${oldSocketId} to ${newSocketId}`);
    } catch (error) {
      logger.error('Transfer socket data error:', error);
    }
  }

  // Setup Redis pub/sub for cross-server communication
  setupRedisPubSub() {
    try {
      const subscriber = redisManager.getSubscriber();
      const publisher = redisManager.getPublisher();

      // Subscribe to cross-server events
      subscriber.subscribe('socket:broadcast', 'socket:user_update', 'socket:call_update');

      subscriber.on('message', (channel, message) => {
        try {
          const data = JSON.parse(message);
          
          switch (channel) {
            case 'socket:broadcast':
              this.io.emit(data.event, data.payload);
              break;
            case 'socket:user_update':
              this.handleCrossServerUserUpdate(data);
              break;
            case 'socket:call_update':
              this.handleCrossServerCallUpdate(data);
              break;
          }
        } catch (error) {
          logger.error('Redis pub/sub message error:', error);
        }
      });

      // Store publisher for cross-server communication
      this.publisher = publisher;

    } catch (error) {
      logger.error('Setup Redis pub/sub error:', error);
    }
  }

  // Handle cross-server user updates
  handleCrossServerUserUpdate(data) {
    try {
      const { userId, event, payload } = data;
      
      // Broadcast to user's sockets
      this.authHandler.broadcastToUser(userId, event, payload);
      
    } catch (error) {
      logger.error('Handle cross-server user update error:', error);
    }
  }

  // Handle cross-server call updates
  handleCrossServerCallUpdate(data) {
    try {
      const { callId, event, payload } = data;
      
      // Broadcast to call participants
      const callData = this.webrtcHandler.activeCalls.get(callId);
      if (callData) {
        callData.participants.forEach(userId => {
          this.authHandler.broadcastToUser(userId, event, payload);
        });
      }
      
    } catch (error) {
      logger.error('Handle cross-server call update error:', error);
    }
  }

  // Setup cleanup intervals
  setupCleanupIntervals() {
    // Clean up expired sessions every 5 minutes
    const sessionCleanup = setInterval(async () => {
      await this.authHandler.cleanupExpiredSessions();
    }, 5 * 60 * 1000);

    // Clean up expired calls every 10 minutes
    const callCleanup = setInterval(async () => {
      await this.webrtcHandler.cleanupExpiredCalls();
    }, 10 * 60 * 1000);

    // Clean up expired typing indicators every minute
    const typingCleanup = setInterval(() => {
      this.messageHandler.cleanupExpingTyping();
    }, 60 * 1000);

    this.cleanupIntervals.push(sessionCleanup, callCleanup, typingCleanup);
  }

  // Get server statistics
  getStats() {
    return {
      connections: this.authHandler.getConnectionStats(),
      calls: this.webrtcHandler.getCallStats(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };
  }

  // Graceful shutdown
  async shutdown() {
    try {
      logger.info('Shutting down Socket.IO server...');

      // Clear cleanup intervals
      this.cleanupIntervals.forEach(interval => clearInterval(interval));

      // Close all socket connections
      if (this.io) {
        this.io.close();
      }

      // Close Redis connections
      await redisManager.disconnect();

      logger.info('Socket.IO server shutdown complete');

    } catch (error) {
      logger.error('Socket.IO shutdown error:', error);
    }
  }
}

module.exports = SocketManager;