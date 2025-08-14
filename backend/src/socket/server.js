const { Server } = require('socket.io');
const SocketHandlers = require('./handlers');
const SocketMiddleware = require('./middleware');
const logger = require('../utils/logger');

class SocketServer {
  constructor(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      upgradeTimeout: 10000,
      maxHttpBufferSize: 1e8, // 100MB
      allowEIO3: true
    });

    this.handlers = new SocketHandlers(this.io);
    this.middleware = SocketMiddleware;
    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupErrorHandling();
  }

  // Setup Socket.IO middleware
  setupMiddleware() {
    const middleware = this.middleware.getMiddleware();
    middleware.forEach(middlewareFn => {
      this.io.use(middlewareFn);
    });
  }

  // Setup event handlers
  setupEventHandlers() {
    this.io.on('connection', async (socket) => {
      try {
        // Log connection
        this.middleware.logConnection(socket);

        // Handle connection
        await this.handlers.handleConnection(socket);

        // Setup event listeners
        this.setupSocketEvents(socket);

        // Handle disconnection
        socket.on('disconnect', async (reason) => {
          await this.handlers.handleDisconnection(socket);
          this.middleware.cleanup(socket);
          logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
        });

      } catch (error) {
        logger.error('Socket connection setup error:', error);
        socket.disconnect(true);
      }
    });
  }

  // Setup individual socket event handlers
  setupSocketEvents(socket) {
    // Chat events
    socket.on('chat_message', (data) => {
      this.handlers.handleChatMessage(socket, data);
    });

    socket.on('typing', (data) => {
      this.handlers.handleTyping(socket, data);
    });

    socket.on('stop_typing', (data) => {
      this.handlers.handleTyping(socket, { ...data, isTyping: false });
    });

    // Call events
    socket.on('call_initiate', (data) => {
      this.handlers.handleCallInitiate(socket, data);
    });

    socket.on('call_answer', (data) => {
      this.handlers.handleCallAnswer(socket, data);
    });

    socket.on('call_end', (data) => {
      this.handlers.handleCallEnd(socket, data);
    });

    socket.on('call_reject', (data) => {
      this.handlers.handleCallAnswer(socket, { ...data, answer: 'reject' });
    });

    // WebRTC events
    socket.on('webrtc_signal', (data) => {
      this.handlers.handleWebRTCSignal(socket, data);
    });

    socket.on('ice_candidate', (data) => {
      this.handlers.handleWebRTCSignal(socket, {
        ...data,
        signal: { type: 'ice_candidate', candidate: data.candidate }
      });
    });

    socket.on('offer', (data) => {
      this.handlers.handleWebRTCSignal(socket, {
        ...data,
        signal: { type: 'offer', sdp: data.sdp }
      });
    });

    socket.on('answer', (data) => {
      this.handlers.handleWebRTCSignal(socket, {
        ...data,
        signal: { type: 'answer', sdp: data.sdp }
      });
    });

    // Location and discovery events
    socket.on('location_update', (data) => {
      this.handlers.handleLocationUpdate(socket, data);
    });

    socket.on('discovery_request', (data) => {
      this.handlers.handleDiscoveryRequest(socket, data);
    });

    // Social events
    socket.on('friend_request', (data) => {
      this.handlers.handleFriendRequest(socket, data);
    });

    socket.on('friend_request_response', (data) => {
      this.handlers.handleFriendRequestResponse(socket, data);
    });

    // Room management events
    socket.on('join_chat', (data) => {
      this.handleJoinChat(socket, data);
    });

    socket.on('leave_chat', (data) => {
      this.handleLeaveChat(socket, data);
    });

    socket.on('join_tier', (data) => {
      this.handleJoinTier(socket, data);
    });

    // Utility events
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    socket.on('get_online_status', (data) => {
      this.handleGetOnlineStatus(socket, data);
    });

    socket.on('get_user_info', (data) => {
      this.handleGetUserInfo(socket, data);
    });
  }

  // Handle joining chat room
  async handleJoinChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = this.handlers.socketUsers.get(socket.id);

      if (!userId || !chatId) return;

      // Verify user is participant in chat
      const chat = await require('../models/Chat').findById(chatId);
      if (!chat || !chat.participants.includes(userId)) {
        socket.emit('error', { message: 'Access denied to chat' });
        return;
      }

      // Join chat room
      socket.join(`chat:${chatId}`);

      // Store room mapping
      const userRooms = this.handlers.userRooms.get(userId) || [];
      if (!userRooms.includes(`chat:${chatId}`)) {
        userRooms.push(`chat:${chatId}`);
        this.handlers.userRooms.set(userId, userRooms);
      }

      // Emit join confirmation
      socket.emit('chat_joined', { chatId });

      logger.info(`User ${userId} joined chat ${chatId}`);

    } catch (error) {
      logger.error('Join chat error:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  }

  // Handle leaving chat room
  async handleLeaveChat(socket, data) {
    try {
      const { chatId } = data;
      const userId = this.handlers.socketUsers.get(socket.id);

      if (!userId || !chatId) return;

      // Leave chat room
      socket.leave(`chat:${chatId}`);

      // Remove room mapping
      const userRooms = this.handlers.userRooms.get(userId) || [];
      const updatedRooms = userRooms.filter(room => room !== `chat:${chatId}`);
      this.handlers.userRooms.set(userId, updatedRooms);

      // Emit leave confirmation
      socket.emit('chat_left', { chatId });

      logger.info(`User ${userId} left chat ${chatId}`);

    } catch (error) {
      logger.error('Leave chat error:', error);
    }
  }

  // Handle joining tier room
  async handleJoinTier(socket, data) {
    try {
      const { tier } = data;
      const userId = this.handlers.socketUsers.get(socket.id);

      if (!userId || !tier) return;

      // Validate tier
      if (tier < 1 || tier > 6) {
        socket.emit('error', { message: 'Invalid tier' });
        return;
      }

      // Join tier room
      socket.join(`tier:${tier}`);

      // Store room mapping
      const userRooms = this.handlers.userRooms.get(userId) || [];
      if (!userRooms.includes(`tier:${tier}`)) {
        userRooms.push(`tier:${tier}`);
        this.handlers.userRooms.set(userId, userRooms);
      }

      // Emit join confirmation
      socket.emit('tier_joined', { tier });

      logger.info(`User ${userId} joined tier ${tier}`);

    } catch (error) {
      logger.error('Join tier error:', error);
      socket.emit('error', { message: 'Failed to join tier' });
    }
  }

  // Handle getting online status
  async handleGetOnlineStatus(socket, data) {
    try {
      const { userIds } = data;
      const currentUserId = this.handlers.socketUsers.get(socket.id);

      if (!currentUserId || !userIds || !Array.isArray(userIds)) return;

      const statuses = {};
      userIds.forEach(userId => {
        statuses[userId] = {
          isOnline: this.handlers.isUserOnline(userId),
          lastSeen: null
        };
      });

      // Get last seen times for offline users
      const offlineUserIds = userIds.filter(userId => !statuses[userId].isOnline);
      if (offlineUserIds.length > 0) {
        const offlineUsers = await require('../models/User').find({
          _id: { $in: offlineUserIds }
        }).select('lastSeen');

        offlineUsers.forEach(user => {
          if (statuses[user._id]) {
            statuses[user._id].lastSeen = user.lastSeen;
          }
        });
      }

      socket.emit('online_status_response', { statuses });

    } catch (error) {
      logger.error('Get online status error:', error);
      socket.emit('error', { message: 'Failed to get online status' });
    }
  }

  // Handle getting user info
  async handleGetUserInfo(socket, data) {
    try {
      const { userIds } = data;
      const currentUserId = this.handlers.socketUsers.get(socket.id);

      if (!currentUserId || !userIds || !Array.isArray(userIds)) return;

      const users = await require('../models/User').find({
        _id: { $in: userIds }
      }).select('username displayName profilePicture bio tier isOnline lastSeen');

      const userInfos = users.map(user => ({
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        bio: user.bio,
        tier: user.tier,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      }));

      socket.emit('user_info_response', { users: userInfos });

    } catch (error) {
      logger.error('Get user info error:', error);
      socket.emit('error', { message: 'Failed to get user info' });
    }
  }

  // Setup error handling
  setupErrorHandling() {
    this.io.on('error', (error) => {
      logger.error('Socket.IO server error:', error);
    });

    this.io.engine.on('connection_error', (error) => {
      logger.error('Socket.IO connection error:', error);
    });
  }

  // Get server instance
  getServer() {
    return this.io;
  }

  // Get handlers instance
  getHandlers() {
    return this.handlers;
  }

  // Broadcast to all connected clients
  broadcast(event, data) {
    this.io.emit(event, data);
  }

  // Broadcast to specific room
  broadcastToRoom(room, event, data) {
    this.io.to(room).emit(event, data);
  }

  // Broadcast to specific user
  broadcastToUser(userId, event, data) {
    const socketId = this.handlers.getUserSocketId(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  // Get server statistics
  getStats() {
    return {
      connectedClients: this.io.engine.clientsCount,
      onlineUsers: this.handlers.getOnlineUsersCount(),
      activeRooms: this.io.sockets.adapter.rooms.size,
      activeCalls: this.handlers.activeCalls.size
    };
  }
}

module.exports = SocketServer;