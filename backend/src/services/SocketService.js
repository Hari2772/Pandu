const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Call = require('../models/Call');
const Recording = require('../models/Recording');
const Story = require('../models/Story');
const Group = require('../models/Group');
const TierData = require('../models/TierData');
const FeatureFlag = require('../models/FeatureFlag');
const Analytics = require('../models/Analytics');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userSessions = new Map(); // socketId -> userData
    this.activeCalls = new Map(); // callId -> callData
    this.screenSharing = new Map(); // userId -> screenShareData
    this.recordingSessions = new Map(); // userId -> recordingData
  }

  initialize(server) {
    this.io = socketIO(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e8, // 100MB for file uploads
      upgradeTimeout: 30000
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupCleanup();

    logger.info('Socket.IO service initialized');
    return this.io;
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id username displayName profilePicture isActive tier');
        
        if (!user || !user.isActive) {
          return next(new Error('Invalid or inactive user'));
        }

        socket.userId = user._id;
        socket.userData = user;
        next();
      } catch (error) {
        logger.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });

    // Rate limiting middleware
    this.io.use((socket, next) => {
      const userId = socket.userId;
      const now = Date.now();
      
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, { lastMessage: 0, messageCount: 0 });
      }
      
      const session = this.userSessions.get(userId);
      if (now - session.lastMessage < 100) { // 100ms between messages
        return next(new Error('Rate limit exceeded'));
      }
      
      session.lastMessage = now;
      session.messageCount++;
      next();
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      // Chat events
      socket.on('send_message', (data) => this.handleSendMessage(socket, data));
      socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
      socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));
      socket.on('message_read', (data) => this.handleMessageRead(socket, data));
      socket.on('message_deleted', (data) => this.handleMessageDeleted(socket, data));
      
      // Call events
      socket.on('call_initiate', (data) => this.handleCallInitiate(socket, data));
      socket.on('call_answer', (data) => this.handleCallAnswer(socket, data));
      socket.on('call_reject', (data) => this.handleCallReject(socket, data));
      socket.on('call_end', (data) => this.handleCallEnd(socket, data));
      socket.on('call_ice_candidate', (data) => this.handleCallIceCandidate(socket, data));
      socket.on('call_offer', (data) => this.handleCallOffer(socket, data));
      socket.on('call_answer_webrtc', (data) => this.handleCallAnswerWebRTC(socket, data));
      
      // Screen sharing events
      socket.on('screen_share_start', (data) => this.handleScreenShareStart(socket, data));
      socket.on('screen_share_stop', (data) => this.handleScreenShareStop(socket, data));
      socket.on('screen_share_ice_candidate', (data) => this.handleScreenShareIceCandidate(socket, data));
      
      // Recording events
      socket.on('recording_start', (data) => this.handleRecordingStart(socket, data));
      socket.on('recording_stop', (data) => this.handleRecordingStop(socket, data));
      socket.on('recording_pause', (data) => this.handleRecordingPause(socket, data));
      socket.on('recording_resume', (data) => this.handleRecordingResume(socket, data));
      
      // Story events
      socket.on('story_create', (data) => this.handleStoryCreate(socket, data));
      socket.on('story_view', (data) => this.handleStoryView(socket, data));
      socket.on('story_react', (data) => this.handleStoryReact(socket, data));
      
      // Group events
      socket.on('group_join', (data) => this.handleGroupJoin(socket, data));
      socket.on('group_leave', (data) => this.handleGroupLeave(socket, data));
      socket.on('group_message', (data) => this.handleGroupMessage(socket, data));
      
      // Location and discovery events
      socket.on('location_update', (data) => this.handleLocationUpdate(socket, data));
      socket.on('nearby_users_request', (data) => this.handleNearbyUsersRequest(socket, data));
      socket.on('user_status_update', (data) => this.handleUserStatusUpdate(socket, data));
      
      // Disconnection
      socket.on('disconnect', () => this.handleDisconnection(socket));
      socket.on('error', (error) => this.handleSocketError(socket, error));
    });
  }

  async handleConnection(socket) {
    try {
      const userId = socket.userId;
      const userData = socket.userData;

      // Update user online status
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

      // Store connection info
      this.connectedUsers.set(userId, socket.id);
      socket.join(`user:${userId}`);

      // Join user's groups
      const userGroups = await Group.find({
        'members.userId': userId,
        'members.status': 'active'
      });

      userGroups.forEach(group => {
        socket.join(`group:${group._id}`);
      });

      // Notify friends about online status
      const user = await User.findById(userId).populate('friends.userId');
      if (user && user.friends) {
        user.friends.forEach(friend => {
          if (friend.status === 'accepted') {
            const friendSocketId = this.connectedUsers.get(friend.userId._id);
            if (friendSocketId) {
              this.io.to(friendSocketId).emit('friend_online', {
                userId: userId,
                username: userData.username,
                displayName: userData.displayName,
                profilePicture: userData.profilePicture,
                timestamp: new Date()
              });
            }
          }
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'user_login',
        eventName: 'Socket Connection',
        eventCategory: 'user',
        userId: userId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          socketId: socket.id,
          userAgent: socket.handshake.headers['user-agent']
        }
      });

      // Send connection confirmation
      socket.emit('connected', {
        userId: userId,
        username: userData.username,
        displayName: userData.displayName,
        tier: userData.tier,
        timestamp: new Date()
      });

      logger.info(`User ${userData.username} connected via Socket.IO`);

    } catch (error) {
      logger.error('Connection handling error:', error);
      socket.emit('error', { message: 'Connection failed' });
    }
  }

  async handleSendMessage(socket, data) {
    try {
      const { chatId, content, messageType = 'text', replyTo, attachments } = data;
      const senderId = socket.userId;

      // Validate chat access
      const chat = await Chat.findById(chatId).populate('participants.userId');
      if (!chat || !chat.participants.find(p => p.userId._id.equals(senderId))) {
        return socket.emit('error', { message: 'Chat access denied' });
      }

      // Create message
      const message = new Message({
        chatId,
        senderId,
        content,
        messageType,
        replyTo,
        attachments
      });

      await message.save();

      // Update chat
      chat.lastMessage = message._id;
      chat.lastMessageAt = new Date();
      chat.unreadCount = chat.participants.reduce((total, p) => {
        return p.userId._id.equals(senderId) ? total : total + 1;
      }, 0);
      await chat.save();

      // Emit to all participants
      const messageData = {
        _id: message._id,
        chatId,
        senderId,
        content,
        messageType,
        replyTo,
        attachments,
        timestamp: message.timestamp,
        sender: {
          _id: senderId,
          username: socket.userData.username,
          displayName: socket.userData.displayName,
          profilePicture: socket.userData.profilePicture
        }
      };

      chat.participants.forEach(participant => {
        if (!participant.userId._id.equals(senderId)) {
          const participantSocketId = this.connectedUsers.get(participant.userId._id);
          if (participantSocketId) {
            this.io.to(participantSocketId).emit('new_message', messageData);
          }
        }
      });

      // Track analytics
      await Analytics.create({
        eventType: 'message_sent',
        eventName: 'Message Sent',
        eventCategory: 'communication',
        userId: senderId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          chatId,
          messageType,
          hasAttachments: attachments && attachments.length > 0,
          isReply: !!replyTo
        }
      });

      // Confirm message sent
      socket.emit('message_sent', { messageId: message._id, timestamp: new Date() });

    } catch (error) {
      logger.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  async handleCallInitiate(socket, data) {
    try {
      const { recipientId, callType = 'audio', isVideo = false } = data;
      const callerId = socket.userId;

      // Check if recipient is online
      const recipientSocketId = this.connectedUsers.get(recipientId);
      if (!recipientSocketId) {
        return socket.emit('call_failed', { message: 'Recipient is offline' });
      }

      // Check if either user is already in a call
      if (this.activeCalls.has(callerId) || this.activeCalls.has(recipientId)) {
        return socket.emit('call_failed', { message: 'User is already in a call' });
      }

      // Create call record
      const call = new Call({
        callerId,
        recipientId,
        callType: isVideo ? 'video' : callType,
        status: 'initiating'
      });

      await call.save();

      // Store call data
      const callData = {
        callId: call._id,
        callerId,
        recipientId,
        callType: call.callType,
        startTime: new Date(),
        status: 'initiating'
      };

      this.activeCalls.set(callerId, callData);
      this.activeCalls.set(recipientId, callData);

      // Send call request to recipient
      this.io.to(recipientSocketId).emit('incoming_call', {
        callId: call._id,
        caller: {
          _id: callerId,
          username: socket.userData.username,
          displayName: socket.userData.displayName,
          profilePicture: socket.userData.profilePicture
        },
        callType: call.callType,
        timestamp: new Date()
      });

      // Track analytics
      await Analytics.create({
        eventType: 'call_initiated',
        eventName: 'Call Initiated',
        eventCategory: 'communication',
        userId: callerId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId: call._id,
          callType: call.callType,
          recipientId
        }
      });

      logger.info(`Call initiated from ${socket.userData.username} to ${recipientId}`);

    } catch (error) {
      logger.error('Call initiation error:', error);
      socket.emit('call_failed', { message: 'Failed to initiate call' });
    }
  }

  async handleCallAnswer(socket, data) {
    try {
      const { callId, accepted } = data;
      const recipientId = socket.userId;

      const call = await Call.findById(callId);
      if (!call || call.recipientId.toString() !== recipientId.toString()) {
        return socket.emit('error', { message: 'Invalid call' });
      }

      if (accepted) {
        // Update call status
        call.status = 'active';
        call.answeredAt = new Date();
        await call.save();

        // Update active calls
        const callData = this.activeCalls.get(recipientId);
        if (callData) {
          callData.status = 'active';
          callData.answeredAt = new Date();
        }

        // Notify caller
        const callerSocketId = this.connectedUsers.get(call.callerId);
        if (callerSocketId) {
          this.io.to(callerSocketId).emit('call_answered', {
            callId,
            recipientId,
            timestamp: new Date()
          });
        }

        // Track analytics
        await Analytics.create({
          eventType: 'call_answered',
          eventName: 'Call Answered',
          eventCategory: 'communication',
          userId: recipientId,
          sessionId: socket.id,
          platform: 'socket',
          metadata: {
            callId,
            callType: call.callType
          }
        });

        logger.info(`Call ${callId} answered by ${socket.userData.username}`);
      } else {
        // Reject call
        call.status = 'rejected';
        call.endedAt = new Date();
        await call.save();

        // Remove from active calls
        this.activeCalls.delete(call.callerId);
        this.activeCalls.delete(recipientId);

        // Notify caller
        const callerSocketId = this.connectedUsers.get(call.callerId);
        if (callerSocketId) {
          this.io.to(callerSocketId).emit('call_rejected', {
            callId,
            recipientId,
            timestamp: new Date()
          });
        }

        // Track analytics
        await Analytics.create({
          eventType: 'call_ended',
          eventName: 'Call Rejected',
          eventCategory: 'communication',
          userId: recipientId,
          sessionId: socket.id,
          platform: 'socket',
          metadata: {
            callId,
            callType: call.callType,
            reason: 'rejected'
          }
        });
      }

    } catch (error) {
      logger.error('Call answer error:', error);
      socket.emit('error', { message: 'Failed to process call answer' });
    }
  }

  async handleScreenShareStart(socket, data) {
    try {
      const { recipientId, isVideo = false } = data;
      const sharerId = socket.userId;

      // Check if recipient is online
      const recipientSocketId = this.connectedUsers.get(recipientId);
      if (!recipientSocketId) {
        return socket.emit('screen_share_failed', { message: 'Recipient is offline' });
      }

      // Store screen sharing data
      const screenShareData = {
        sharerId,
        recipientId,
        isVideo,
        startTime: new Date(),
        status: 'active'
      };

      this.screenSharing.set(sharerId, screenShareData);

      // Notify recipient
      this.io.to(recipientSocketId).emit('screen_share_started', {
        sharerId,
        isVideo,
        timestamp: new Date()
      });

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_started',
        eventName: 'Screen Share Started',
        eventCategory: 'media',
        userId: sharerId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          recipientId,
          isVideo
        }
      });

      logger.info(`Screen sharing started by ${socket.userData.username}`);

    } catch (error) {
      logger.error('Screen share start error:', error);
      socket.emit('screen_share_failed', { message: 'Failed to start screen sharing' });
    }
  }

  async handleLocationUpdate(socket, data) {
    try {
      const { coordinates, accuracy, address, placeName } = data;
      const userId = socket.userId;

      // Update user location
      await User.findByIdAndUpdate(userId, {
        'location.coordinates': coordinates,
        'location.accuracy': accuracy,
        'location.lastUpdated': new Date()
      });

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          'location.coordinates': coordinates,
          'location.accuracy': accuracy,
          'location.lastUpdated': new Date(),
          'location.address': address,
          'location.placeName': placeName,
          lastUpdate: new Date()
        }
      );

      // Find nearby users based on tier
      const user = await User.findById(userId);
      if (user && user.tier) {
        const nearbyUsers = await this.findNearbyUsers(userId, coordinates, user.tier);
        
        // Notify nearby users about new user in range
        nearbyUsers.forEach(nearbyUser => {
          const nearbySocketId = this.connectedUsers.get(nearbyUser.userId);
          if (nearbySocketId) {
            this.io.to(nearbySocketId).emit('nearby_user_updated', {
              userId: userId,
              username: socket.userData.username,
              displayName: socket.userData.displayName,
              profilePicture: socket.userData.profilePicture,
              location: { coordinates, accuracy, address, placeName },
              timestamp: new Date()
            });
          }
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'location_updated',
        eventName: 'Location Update',
        eventCategory: 'location',
        userId: userId,
        sessionId: socket.id,
        platform: 'socket',
        location: {
          coordinates,
          accuracy,
          address,
          placeName
        },
        metadata: {
          accuracy,
          address,
          placeName
        }
      });

      socket.emit('location_updated', {
        coordinates,
        accuracy,
        address,
        placeName,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Location update error:', error);
      socket.emit('error', { message: 'Failed to update location' });
    }
  }

  async findNearbyUsers(userId, coordinates, tier) {
    try {
      const tierDistance = constants.TIER_DISTANCES[tier] || 1000; // Default 1km
      
      const nearbyUsers = await TierData.find({
        userId: { $ne: userId },
        isActive: true,
        isOnline: true,
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: coordinates
            },
            $maxDistance: tierDistance
          }
        }
      }).populate('userId', 'username displayName profilePicture tier');

      return nearbyUsers.map(tierData => ({
        userId: tierData.userId._id,
        username: tierData.userId.username,
        displayName: tierData.userId.displayName,
        profilePicture: tierData.userId.profilePicture,
        tier: tierData.userId.tier,
        distance: tierData.location.distance,
        lastSeen: tierData.lastSeen
      }));

    } catch (error) {
      logger.error('Find nearby users error:', error);
      return [];
    }
  }

  async handleDisconnection(socket) {
    try {
      const userId = socket.userId;
      if (!userId) return;

      // Update user offline status
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

      // Remove from active calls
      if (this.activeCalls.has(userId)) {
        const callData = this.activeCalls.get(userId);
        this.activeCalls.delete(callData.callerId);
        this.activeCalls.delete(callData.recipientId);
        
        // End call if active
        if (callData.status === 'active') {
          await Call.findByIdAndUpdate(callData.callId, {
            status: 'ended',
            endedAt: new Date()
          });
        }
      }

      // Stop screen sharing
      if (this.screenSharing.has(userId)) {
        const screenShareData = this.screenSharing.get(userId);
        this.screenSharing.delete(userId);
        
        // Notify recipient
        const recipientSocketId = this.connectedUsers.get(screenShareData.recipientId);
        if (recipientSocketId) {
          this.io.to(recipientSocketId).emit('screen_share_stopped', {
            sharerId: userId,
            timestamp: new Date()
          });
        }
      }

      // Stop recording
      if (this.recordingSessions.has(userId)) {
        const recordingData = this.recordingSessions.get(userId);
        this.recordingSessions.delete(userId);
        
        // End recording
        if (recordingData.recordingId) {
          await Recording.findByIdAndUpdate(recordingData.recordingId, {
            status: 'completed',
            endedAt: new Date()
          });
        }
      }

      // Remove connection
      this.connectedUsers.delete(userId);
      this.userSessions.delete(userId);

      // Notify friends about offline status
      const user = await User.findById(userId).populate('friends.userId');
      if (user && user.friends) {
        user.friends.forEach(friend => {
          if (friend.status === 'accepted') {
            const friendSocketId = this.connectedUsers.get(friend.userId._id);
            if (friendSocketId) {
              this.io.to(friendSocketId).emit('friend_offline', {
                userId: userId,
                timestamp: new Date()
              });
            }
          }
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'user_logout',
        eventName: 'Socket Disconnection',
        eventCategory: 'user',
        userId: userId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          socketId: socket.id,
          reason: 'disconnection'
        }
      });

      logger.info(`User ${userId} disconnected from Socket.IO`);

    } catch (error) {
      logger.error('Disconnection handling error:', error);
    }
  }

  handleSocketError(socket, error) {
    logger.error('Socket error:', error);
    socket.emit('error', { message: 'Socket error occurred' });
  }

  setupCleanup() {
    // Cleanup inactive sessions every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [userId, session] of this.userSessions.entries()) {
        if (now - session.lastMessage > 300000) { // 5 minutes
          this.userSessions.delete(userId);
        }
      }
    }, 300000);

    // Cleanup expired calls every minute
    setInterval(() => {
      const now = Date.now();
      for (const [userId, callData] of this.activeCalls.entries()) {
        if (now - callData.startTime > 3600000) { // 1 hour
          this.activeCalls.delete(userId);
          logger.warn(`Expired call cleaned up for user ${userId}`);
        }
      }
    }, 60000);
  }

  // Utility methods
  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }

  getUserSocketId(userId) {
    return this.connectedUsers.get(userId);
  }

  getOnlineUsers() {
    return Array.from(this.connectedUsers.keys());
  }

  broadcastToUser(userId, event, data) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  broadcastToUsers(userIds, event, data) {
    userIds.forEach(userId => {
      this.broadcastToUser(userId, event, data);
    });
  }

  broadcastToGroup(groupId, event, data, excludeUserId = null) {
    this.io.to(`group:${groupId}`).emit(event, data);
  }
}

module.exports = new SocketService();