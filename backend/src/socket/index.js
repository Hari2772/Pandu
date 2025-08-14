const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const SocketHandlers = require('./handlers');
const WebRTCService = require('../services/WebRTCService');
const ChatService = require('../services/ChatService');
const DiscoveryService = require('../services/DiscoveryService');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

class SocketServer {
  constructor(server) {
    this.server = server;
    this.io = null;
    this.handlers = null;
    this.webrtcService = null;
    this.chatService = null;
    this.discoveryService = null;
    this.connectedUsers = new Map(); // userId -> socket data
  }

  // Initialize Socket.IO server
  initialize() {
    try {
      // Create Socket.IO server
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
        maxHttpBufferSize: 1e8, // 100MB
        upgradeTimeout: 10000
      });

      // Initialize services
      this.webrtcService = new WebRTCService(this.io);
      this.chatService = new ChatService();
      this.discoveryService = new DiscoveryService();

      // Initialize handlers
      this.handlers = new SocketHandlers(this.io);

      // Setup middleware
      this.setupMiddleware();

      // Setup event handlers
      this.setupEventHandlers();

      // Setup cleanup intervals
      this.setupCleanupIntervals();

      logger.info('Socket.IO server initialized successfully');

    } catch (error) {
      logger.error('Socket.IO server initialization error:', error);
      throw error;
    }
  }

  // Setup Socket.IO middleware
  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization;

        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Remove 'Bearer ' prefix if present
        const cleanToken = token.replace('Bearer ', '');

        // Verify JWT token
        const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
        
        if (!decoded.userId) {
          return next(new Error('Invalid token'));
        }

        // Store user ID in socket
        socket.userId = decoded.userId;
        socket.userRole = decoded.role || 'user';

        // Add user to connected users map
        this.connectedUsers.set(decoded.userId, {
          socketId: socket.id,
          connectedAt: new Date(),
          lastActivity: new Date(),
          userAgent: socket.handshake.headers['user-agent'],
          ip: socket.handshake.address
        });

        next();
      } catch (error) {
        logger.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });

    // Rate limiting middleware
    this.io.use(async (socket, next) => {
      try {
        const userId = socket.userId;
        const key = `socket:rate:${userId}`;
        
        const currentCount = await redisManager.getClient().incr(key);
        
        if (currentCount === 1) {
          await redisManager.getClient().expire(key, 60); // 1 minute window
        }
        
        if (currentCount > 100) { // Max 100 events per minute
          return next(new Error('Rate limit exceeded'));
        }
        
        next();
      } catch (error) {
        logger.error('Socket rate limiting error:', error);
        next();
      }
    });
  }

  // Setup event handlers
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`User ${socket.userId} connected via socket ${socket.id}`);

      // Handle connection
      this.handlers.handleConnection(socket);

      // Chat events
      socket.on('send_message', (data) => {
        this.handleChatMessage(socket, data);
      });

      socket.on('typing', (data) => {
        this.handlers.handleTyping(socket, data);
      });

      socket.on('mark_read', (data) => {
        this.handleMarkRead(socket, data);
      });

      // Call events
      socket.on('initiate_call', (data) => {
        this.handlers.handleCallInitiate(socket, data);
      });

      socket.on('answer_call', (data) => {
        this.handlers.handleCallAnswer(socket, data);
      });

      socket.on('end_call', (data) => {
        this.handlers.handleCallEnd(socket, data);
      });

      socket.on('reject_call', (data) => {
        this.handleRejectCall(socket, data);
      });

      // WebRTC events
      socket.on('webrtc_offer', (data) => {
        this.webrtcService.handleOffer(socket, data);
      });

      socket.on('webrtc_answer', (data) => {
        this.webrtcService.handleAnswer(socket, data);
      });

      socket.on('webrtc_ice_candidate', (data) => {
        this.webrtcService.handleICECandidate(socket, data);
      });

      // Screen sharing events
      socket.on('screen_share_start', (data) => {
        this.webrtcService.handleScreenShareStart(socket, data);
      });

      socket.on('screen_share_stop', (data) => {
        this.webrtcService.handleScreenShareStop(socket, data);
      });

      // Recording events
      socket.on('start_recording', (data) => {
        this.webrtcService.handleRecordingStart(socket, data);
      });

      socket.on('stop_recording', (data) => {
        this.webrtcService.handleRecordingStop(socket, data);
      });

      // Discovery events
      socket.on('discovery_request', (data) => {
        this.handlers.handleDiscoveryRequest(socket, data);
      });

      socket.on('location_update', (data) => {
        this.handlers.handleLocationUpdate(socket, data);
      });

      // Social events
      socket.on('friend_request', (data) => {
        this.handlers.handleFriendRequest(socket, data);
      });

      socket.on('friend_request_response', (data) => {
        this.handlers.handleFriendRequestResponse(socket, data);
      });

      // Connection events
      socket.on('connection_state_change', (data) => {
        this.webrtcService.handleConnectionStateChange(socket, data);
      });

      socket.on('bandwidth_estimation', (data) => {
        this.webrtcService.handleBandwidthEstimation(socket, data);
      });

      // Join chat room
      socket.on('join_chat', (data) => {
        this.handleJoinChat(socket, data);
      });

      socket.on('leave_chat', (data) => {
        this.handleLeaveChat(socket, data);
      });

      // Join tier room
      socket.on('join_tier', (data) => {
        this.handleJoinTier(socket, data);
      });

      // Presence events
      socket.on('presence_update', (data) => {
        this.handlePresenceUpdate(socket, data);
      });

      // Activity tracking
      socket.on('activity', (data) => {
        this.handleActivity(socket, data);
      });

      // Disconnect event
      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket, reason);
      });

      // Error handling
      socket.on('error', (error) => {
        logger.error(`Socket error for user ${socket.userId}:`, error);
      });
    });
  }

  // Handle chat message
  async handleChatMessage(socket, data) {
    try {
      const { chatId, content, messageType, replyTo, attachments } = data;
      const senderId = socket.userId;

      // Send message via chat service
      const message = await this.chatService.sendMessage(chatId, senderId, {
        content,
        messageType,
        replyTo,
        attachments
      });

      // Emit to chat room
      this.io.to(`chat:${chatId}`).emit('new_message', {
        message: message.toJSON(),
        chatId
      });

      // Update user activity
      this.updateUserActivity(senderId);

    } catch (error) {
      logger.error('Handle chat message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  // Handle mark read
  async handleMarkRead(socket, data) {
    try {
      const { chatId, messageIds } = data;
      const userId = socket.userId;

      await this.chatService.markMessagesAsRead(chatId, userId, messageIds);

      // Emit read receipt to chat room
      socket.to(`chat:${chatId}`).emit('messages_read', {
        chatId,
        userId,
        messageIds
      });

    } catch (error) {
      logger.error('Handle mark read error:', error);
    }
  }

  // Handle reject call
  async handleRejectCall(socket, data) {
    try {
      const { callId, reason } = data;
      const userId = socket.userId;

      // Update call status
      const Call = require('../models/Call');
      await Call.findByIdAndUpdate(callId, {
        status: 'rejected',
        endedAt: new Date(),
        endReason: reason || 'rejected'
      });

      // Notify caller
      const call = await Call.findById(callId);
      if (call) {
        const callerSocketId = this.handlers.getUserSocketId(call.callerId);
        if (callerSocketId) {
          this.io.to(callerSocketId).emit('call_rejected', {
            callId,
            status: 'rejected',
            reason: reason || 'rejected'
          });
        }
      }

      logger.info(`Call ${callId} rejected by ${userId}`);

    } catch (error) {
      logger.error('Handle reject call error:', error);
    }
  }

  // Handle join chat
  async handleJoinChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.userId;

      // Validate chat access
      const chat = await this.chatService.getChatById(chatId);
      if (!chat || !chat.participants.includes(userId)) {
        socket.emit('error', { message: 'Access denied to chat' });
        return;
      }

      // Join chat room
      socket.join(`chat:${chatId}`);

      // Update user chat mappings
      this.handlers.addUserToChat(userId, chatId);

      // Emit join confirmation
      socket.emit('chat_joined', { chatId });

      // Notify other participants
      socket.to(`chat:${chatId}`).emit('user_joined_chat', {
        chatId,
        userId
      });

    } catch (error) {
      logger.error('Handle join chat error:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  }

  // Handle leave chat
  async handleLeaveChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = socket.userId;

      // Leave chat room
      socket.leave(`chat:${chatId}`);

      // Update user chat mappings
      this.handlers.removeUserFromChat(userId, chatId);

      // Emit leave confirmation
      socket.emit('chat_left', { chatId });

      // Notify other participants
      socket.to(`chat:${chatId}`).emit('user_left_chat', {
        chatId,
        userId
      });

    } catch (error) {
      logger.error('Handle leave chat error:', error);
    }
  }

  // Handle join tier
  async handleJoinTier(socket, data) {
    try {
      const { tier } = data;
      const userId = socket.userId;

      // Join tier room
      socket.join(`tier:${tier}`);

      // Emit join confirmation
      socket.emit('tier_joined', { tier });

    } catch (error) {
      logger.error('Handle join tier error:', error);
    }
  }

  // Handle presence update
  async handlePresenceUpdate(socket, data) {
    try {
      const { status, customStatus } = data;
      const userId = socket.userId;

      // Update user presence
      const User = require('../models/User');
      await User.findByIdAndUpdate(userId, {
        presence: {
          status: status || 'online',
          customStatus,
          lastUpdated: new Date()
        }
      });

      // Emit presence update to friends
      const user = await User.findById(userId).populate('friends.userId');
      if (user && user.friends) {
        user.friends.forEach(friend => {
          const friendSocketId = this.handlers.getUserSocketId(friend.userId);
          if (friendSocketId) {
            this.io.to(friendSocketId).emit('friend_presence_update', {
              userId,
              status: status || 'online',
              customStatus,
              lastUpdated: new Date()
            });
          }
        });
      }

    } catch (error) {
      logger.error('Handle presence update error:', error);
    }
  }

  // Handle activity
  async handleActivity(socket, data) {
    try {
      const { type, details } = data;
      const userId = socket.userId;

      // Update user activity
      this.updateUserActivity(userId);

      // Track analytics
      const Analytics = require('../models/Analytics');
      await Analytics.create({
        eventType: 'user_activity',
        eventName: `User Activity: ${type}`,
        eventCategory: 'user',
        userId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          activityType: type,
          details
        }
      });

    } catch (error) {
      logger.error('Handle activity error:', error);
    }
  }

  // Handle disconnect
  async handleDisconnect(socket, reason) {
    try {
      const userId = socket.userId;
      if (!userId) return;

      // Handle disconnection via handlers
      await this.handlers.handleDisconnection(socket);

      // Remove from connected users
      this.connectedUsers.delete(userId);

      // Update user activity
      this.updateUserActivity(userId);

      logger.info(`User ${userId} disconnected: ${reason}`);

    } catch (error) {
      logger.error('Handle disconnect error:', error);
    }
  }

  // Update user activity
  updateUserActivity(userId) {
    try {
      const userData = this.connectedUsers.get(userId);
      if (userData) {
        userData.lastActivity = new Date();
        this.connectedUsers.set(userId, userData);
      }
    } catch (error) {
      logger.error('Update user activity error:', error);
    }
  }

  // Setup cleanup intervals
  setupCleanupIntervals() {
    // Cleanup inactive users every 5 minutes
    setInterval(() => {
      this.cleanupInactiveUsers();
    }, 5 * 60 * 1000);

    // Cleanup discovery cache every 10 minutes
    setInterval(() => {
      this.discoveryService.cleanupCache();
    }, 10 * 60 * 1000);

    // Cleanup inactive chats every 30 minutes
    setInterval(() => {
      this.chatService.cleanupInactiveChats();
    }, 30 * 60 * 1000);
  }

  // Cleanup inactive users
  cleanupInactiveUsers() {
    try {
      const now = Date.now();
      const inactiveTimeout = 30 * 60 * 1000; // 30 minutes

      for (const [userId, userData] of this.connectedUsers.entries()) {
        if (now - userData.lastActivity > inactiveTimeout) {
          // Force disconnect inactive user
          const socket = this.io.sockets.sockets.get(userData.socketId);
          if (socket) {
            socket.disconnect(true);
          }
          this.connectedUsers.delete(userId);
          logger.info(`Inactive user ${userId} disconnected`);
        }
      }
    } catch (error) {
      logger.error('Cleanup inactive users error:', error);
    }
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  // Get user socket ID
  getUserSocketId(userId) {
    const userData = this.connectedUsers.get(userId);
    return userData ? userData.socketId : null;
  }

  // Check if user is connected
  isUserConnected(userId) {
    return this.connectedUsers.has(userId);
  }

  // Get server statistics
  getServerStats() {
    return {
      connectedUsers: this.getConnectedUsersCount(),
      totalSockets: this.io.engine.clientsCount,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      handlers: this.handlers ? this.handlers.getHealthStatus() : {},
      webrtc: this.webrtcService ? this.webrtcService.getHealthStatus() : {},
      discovery: this.discoveryService ? this.discoveryService.getHealthStatus() : {},
      timestamp: new Date()
    };
  }

  // Broadcast message to all connected users
  broadcastToAll(event, data) {
    this.io.emit(event, data);
  }

  // Broadcast message to specific users
  broadcastToUsers(userIds, event, data) {
    userIds.forEach(userId => {
      const socketId = this.getUserSocketId(userId);
      if (socketId) {
        this.io.to(socketId).emit(event, data);
      }
    });
  }

  // Broadcast message to tier
  broadcastToTier(tier, event, data) {
    this.io.to(`tier:${tier}`).emit(event, data);
  }

  // Broadcast message to chat
  broadcastToChat(chatId, event, data) {
    this.io.to(`chat:${chatId}`).emit(event, data);
  }
}

module.exports = SocketServer;