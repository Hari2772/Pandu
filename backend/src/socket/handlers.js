const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Call = require('../models/Call');
const TierData = require('../models/TierData');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class SocketHandlers {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map(); // userId -> socketId
    this.socketUsers = new Map(); // socketId -> userId
    this.userRooms = new Map(); // userId -> roomIds
    this.activeCalls = new Map(); // callId -> callData
  }

  // Handle user connection
  async handleConnection(socket) {
    try {
      const userId = socket.userId;
      if (!userId) {
        socket.disconnect();
        return;
      }

      // Store socket mappings
      this.userSockets.set(userId.toString(), socket.id);
      this.socketUsers.set(socket.id, userId.toString());

      // Update user online status
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        lastSeen: new Date()
      });

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          isOnline: true,
          lastSeen: new Date(),
          lastUpdate: new Date()
        }
      );

      // Join user to personal room
      socket.join(`user:${userId}`);

      // Join user to tier-based discovery room
      const user = await User.findById(userId);
      if (user && user.location && user.location.coordinates) {
        const tier = user.tier || 5;
        socket.join(`tier:${tier}`);
        
        // Join nearby tier rooms for discovery
        for (let i = Math.max(1, tier - 1); i <= Math.min(6, tier + 1); i++) {
          socket.join(`tier:${i}`);
        }
      }

      // Emit user online status to friends
      await this.notifyFriendsStatus(userId, true);

      // Send user's active chats
      await this.sendActiveChats(socket, userId);

      logger.info(`User ${userId} connected via socket ${socket.id}`);

    } catch (error) {
      logger.error('Socket connection error:', error);
      socket.disconnect();
    }
  }

  // Handle user disconnection
  async handleDisconnection(socket) {
    try {
      const userId = this.socketUsers.get(socket.id);
      if (!userId) return;

      // Remove socket mappings
      this.userSockets.delete(userId);
      this.socketUsers.delete(socket.id);

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

      // Leave all rooms
      const userRooms = this.userRooms.get(userId) || [];
      userRooms.forEach(roomId => {
        socket.leave(roomId);
      });
      this.userRooms.delete(userId);

      // End active calls
      await this.endUserCalls(userId);

      // Notify friends of offline status
      await this.notifyFriendsStatus(userId, false);

      logger.info(`User ${userId} disconnected from socket ${socket.id}`);

    } catch (error) {
      logger.error('Socket disconnection error:', error);
    }
  }

  // Handle chat message
  async handleChatMessage(socket, data) {
    try {
      const { chatId, content, messageType = 'text', replyTo, attachments } = data;
      const senderId = this.socketUsers.get(socket.id);

      if (!senderId || !chatId || !content) {
        socket.emit('error', { message: 'Invalid message data' });
        return;
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

      // Update chat last message
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: message._id,
        lastMessageAt: new Date(),
        lastMessageBy: senderId
      });

      // Populate sender info
      await message.populate('senderId', 'username displayName profilePicture');

      // Emit to chat room
      this.io.to(`chat:${chatId}`).emit('new_message', {
        message: message.toJSON(),
        chatId
      });

      // Send push notification to offline users
      await this.sendPushNotification(chatId, message, senderId);

      logger.info(`Message sent in chat ${chatId} by user ${senderId}`);

    } catch (error) {
      logger.error('Chat message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  // Handle typing indicator
  async handleTyping(socket, data) {
    try {
      const { chatId, isTyping } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId || !chatId) return;

      // Emit typing indicator to chat room (excluding sender)
      socket.to(`chat:${chatId}`).emit('typing', {
        chatId,
        userId,
        isTyping
      });

    } catch (error) {
      logger.error('Typing indicator error:', error);
    }
  }

  // Handle call initiation
  async handleCallInitiate(socket, data) {
    try {
      const { targetUserId, callType = 'audio', chatId } = data;
      const callerId = this.socketUsers.get(socket.id);

      if (!callerId || !targetUserId) {
        socket.emit('error', { message: 'Invalid call data' });
        return;
      }

      // Check if target user is online
      const targetSocketId = this.userSockets.get(targetUserId);
      if (!targetSocketId) {
        socket.emit('call_failed', { message: 'User is offline' });
        return;
      }

      // Create call record
      const call = new Call({
        callerId,
        receiverId: targetUserId,
        callType,
        chatId,
        status: 'initiating'
      });

      await call.save();

      // Store active call
      this.activeCalls.set(call._id.toString(), {
        callId: call._id,
        callerId,
        receiverId: targetUserId,
        callType,
        chatId,
        startTime: new Date()
      });

      // Emit call request to target user
      this.io.to(targetSocketId).emit('incoming_call', {
        callId: call._id,
        callerId,
        callType,
        chatId
      });

      // Emit call initiated to caller
      socket.emit('call_initiated', {
        callId: call._id,
        status: 'initiating'
      });

      logger.info(`Call initiated from ${callerId} to ${targetUserId}`);

    } catch (error) {
      logger.error('Call initiation error:', error);
      socket.emit('error', { message: 'Failed to initiate call' });
    }
  }

  // Handle call answer
  async handleCallAnswer(socket, data) {
    try {
      const { callId, answer } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId || !callId) return;

      const callData = this.activeCalls.get(callId);
      if (!callData) {
        socket.emit('error', { message: 'Call not found' });
        return;
      }

      if (callData.receiverId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      if (answer === 'accept') {
        // Update call status
        await Call.findByIdAndUpdate(callId, {
          status: 'active',
          answeredAt: new Date()
        });

        callData.status = 'active';
        callData.answeredAt = new Date();

        // Create WebRTC room
        const roomId = `call:${callId}`;
        const callerSocketId = this.userSockets.get(callData.callerId);
        
        if (callerSocketId) {
          this.io.sockets.sockets.get(callerSocketId).join(roomId);
        }
        socket.join(roomId);

        // Store room mapping
        this.userRooms.set(callData.callerId, roomId);
        this.userRooms.set(userId, roomId);

        // Notify both users
        this.io.to(roomId).emit('call_answered', {
          callId,
          status: 'active',
          roomId
        });

        logger.info(`Call ${callId} answered by ${userId}`);

      } else {
        // Call rejected
        await Call.findByIdAndUpdate(callId, {
          status: 'rejected',
          endedAt: new Date()
        });

        // Notify caller
        const callerSocketId = this.userSockets.get(callData.callerId);
        if (callerSocketId) {
          this.io.to(callerSocketId).emit('call_rejected', {
            callId,
            status: 'rejected'
          });
        }

        // Remove from active calls
        this.activeCalls.delete(callId);

        logger.info(`Call ${callId} rejected by ${userId}`);
      }

    } catch (error) {
      logger.error('Call answer error:', error);
      socket.emit('error', { message: 'Failed to process call answer' });
    }
  }

  // Handle call end
  async handleCallEnd(socket, data) {
    try {
      const { callId } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId || !callId) return;

      const callData = this.activeCalls.get(callId);
      if (!callData) return;

      // Check if user is part of the call
      if (callData.callerId !== userId && callData.receiverId !== userId) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }

      // Update call record
      await Call.findByIdAndUpdate(callId, {
        status: 'ended',
        endedAt: new Date()
      });

      // Notify both users
      const roomId = `call:${callId}`;
      this.io.to(roomId).emit('call_ended', {
        callId,
        status: 'ended'
      });

      // Leave room
      this.io.in(roomId).socketsLeave(roomId);

      // Remove from active calls
      this.activeCalls.delete(callId);

      // Remove room mappings
      this.userRooms.delete(callData.callerId);
      this.userRooms.delete(callData.receiverId);

      logger.info(`Call ${callId} ended by ${userId}`);

    } catch (error) {
      logger.error('Call end error:', error);
      socket.emit('error', { message: 'Failed to end call' });
    }
  }

  // Handle WebRTC signaling
  async handleWebRTCSignal(socket, data) {
    try {
      const { targetUserId, signal, callId } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId || !targetUserId || !signal) return;

      // Forward signal to target user
      const targetSocketId = this.userSockets.get(targetUserId);
      if (targetSocketId) {
        this.io.to(targetSocketId).emit('webrtc_signal', {
          fromUserId: userId,
          signal,
          callId
        });
      }

    } catch (error) {
      logger.error('WebRTC signal error:', error);
    }
  }

  // Handle location update
  async handleLocationUpdate(socket, data) {
    try {
      const { coordinates, accuracy, address, placeName } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId || !coordinates) return;

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

      // Emit location update to nearby users
      await this.broadcastLocationUpdate(userId, coordinates, accuracy);

      logger.info(`Location updated for user ${userId}`);

    } catch (error) {
      logger.error('Location update error:', error);
    }
  }

  // Handle discovery request
  async handleDiscoveryRequest(socket, data) {
    try {
      const { tier, radius, limit = 50 } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId) return;

      const user = await User.findById(userId);
      if (!user || !user.location || !user.location.coordinates) {
        socket.emit('discovery_response', { users: [] });
        return;
      }

      // Find nearby users based on tier
      const nearbyUsers = await TierData.find({
        userId: { $ne: userId },
        isActive: true,
        isOnline: true,
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: user.location.coordinates
            },
            $maxDistance: radius || constants.TIER_DISTANCES[tier || user.tier]
          }
        }
      })
      .populate('userId', 'username displayName profilePicture bio')
      .limit(limit)
      .sort({ 'location.lastUpdated': -1 });

      // Filter by tier if specified
      const filteredUsers = tier 
        ? nearbyUsers.filter(u => u.tier === tier)
        : nearbyUsers;

      socket.emit('discovery_response', {
        users: filteredUsers.map(u => ({
          id: u.userId._id,
          username: u.userId.username,
          displayName: u.userId.displayName,
          profilePicture: u.userId.profilePicture,
          bio: u.userId.bio,
          tier: u.tier,
          tierName: u.tierName,
          distance: u.tierDistance,
          isOnline: u.isOnline,
          lastSeen: u.lastSeen
        }))
      });

    } catch (error) {
      logger.error('Discovery request error:', error);
      socket.emit('error', { message: 'Failed to get nearby users' });
    }
  }

  // Handle friend request
  async handleFriendRequest(socket, data) {
    try {
      const { targetUserId, message } = data;
      const senderId = this.socketUsers.get(socket.id);

      if (!senderId || !targetUserId) return;

      // Check if already friends
      const existingFriendship = await User.findOne({
        _id: senderId,
        'friends.userId': targetUserId
      });

      if (existingFriendship) {
        socket.emit('error', { message: 'Already friends' });
        return;
      }

      // Check if request already sent
      const existingRequest = await User.findOne({
        _id: targetUserId,
        'friendRequests.userId': senderId
      });

      if (existingRequest) {
        socket.emit('error', { message: 'Friend request already sent' });
        return;
      }

      // Add friend request
      await User.findByIdAndUpdate(targetUserId, {
        $push: {
          friendRequests: {
            userId: senderId,
            message: message || '',
            sentAt: new Date()
          }
        }
      });

      // Notify target user
      const targetSocketId = this.userSockets.get(targetUserId);
      if (targetSocketId) {
        this.io.to(targetSocketId).emit('friend_request_received', {
          fromUserId: senderId,
          message: message || ''
        });
      }

      socket.emit('friend_request_sent', {
        targetUserId,
        message: 'Friend request sent successfully'
      });

      logger.info(`Friend request sent from ${senderId} to ${targetUserId}`);

    } catch (error) {
      logger.error('Friend request error:', error);
      socket.emit('error', { message: 'Failed to send friend request' });
    }
  }

  // Handle friend request response
  async handleFriendRequestResponse(socket, data) {
    try {
      const { fromUserId, response } = data;
      const userId = this.socketUsers.get(socket.id);

      if (!userId || !fromUserId || !response) return;

      if (response === 'accept') {
        // Add to friends list for both users
        await User.findByIdAndUpdate(userId, {
          $push: { friends: { userId: fromUserId, addedAt: new Date() } },
          $pull: { friendRequests: { userId: fromUserId } }
        });

        await User.findByIdAndUpdate(fromUserId, {
          $push: { friends: { userId, addedAt: new Date() } }
        });

        // Notify both users
        socket.emit('friend_request_accepted', {
          fromUserId,
          message: 'Friend request accepted'
        });

        const fromUserSocketId = this.userSockets.get(fromUserId);
        if (fromUserSocketId) {
          this.io.to(fromUserSocketId).emit('friend_request_accepted', {
            byUserId: userId,
            message: 'Friend request accepted'
          });
        }

        logger.info(`Friend request accepted between ${userId} and ${fromUserId}`);

      } else {
        // Reject friend request
        await User.findByIdAndUpdate(userId, {
          $pull: { friendRequests: { userId: fromUserId } }
        });

        // Notify sender
        const fromUserSocketId = this.userSockets.get(fromUserId);
        if (fromUserSocketId) {
          this.io.to(fromUserSocketId).emit('friend_request_rejected', {
            byUserId: userId
          });
        }

        socket.emit('friend_request_rejected', {
          fromUserId,
          message: 'Friend request rejected'
        });

        logger.info(`Friend request rejected by ${userId} from ${fromUserId}`);
      }

    } catch (error) {
      logger.error('Friend request response error:', error);
      socket.emit('error', { message: 'Failed to process friend request' });
    }
  }

  // Helper methods
  async notifyFriendsStatus(userId, isOnline) {
    try {
      const user = await User.findById(userId).populate('friends.userId');
      if (!user || !user.friends) return;

      user.friends.forEach(friend => {
        const friendSocketId = this.userSockets.get(friend.userId.toString());
        if (friendSocketId) {
          this.io.to(friendSocketId).emit('friend_status_change', {
            userId,
            isOnline,
            lastSeen: new Date()
          });
        }
      });
    } catch (error) {
      logger.error('Notify friends status error:', error);
    }
  }

  async sendActiveChats(socket, userId) {
    try {
      const chats = await Chat.find({
        participants: userId,
        isActive: true
      })
      .populate('participants', 'username displayName profilePicture isOnline')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1 })
      .limit(20);

      socket.emit('active_chats', { chats });
    } catch (error) {
      logger.error('Send active chats error:', error);
    }
  }

  async endUserCalls(userId) {
    try {
      const userCalls = Array.from(this.activeCalls.values()).filter(
        call => call.callerId === userId || call.receiverId === userId
      );

      for (const call of userCalls) {
        await Call.findByIdAndUpdate(call.callId, {
          status: 'ended',
          endedAt: new Date()
        });

        const roomId = `call:${call.callId}`;
        this.io.to(roomId).emit('call_ended', {
          callId: call.callId,
          status: 'ended',
          reason: 'User disconnected'
        });

        this.activeCalls.delete(call.callId);
      }
    } catch (error) {
      logger.error('End user calls error:', error);
    }
  }

  async sendPushNotification(chatId, message, senderId) {
    try {
      const chat = await Chat.findById(chatId).populate('participants');
      if (!chat) return;

      const offlineParticipants = chat.participants.filter(
        participant => !this.userSockets.has(participant._id.toString())
      );

      // Send push notifications to offline users
      offlineParticipants.forEach(participant => {
        // This would integrate with a push notification service
        logger.info(`Push notification sent to ${participant._id} for chat ${chatId}`);
      });
    } catch (error) {
      logger.error('Send push notification error:', error);
    }
  }

  async broadcastLocationUpdate(userId, coordinates, accuracy) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const tier = user.tier || 5;
      const radius = constants.TIER_DISTANCES[tier];

      // Find nearby users in the same tier
      const nearbyUsers = await TierData.find({
        userId: { $ne: userId },
        isActive: true,
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: radius
          }
        }
      });

      // Notify nearby users
      nearbyUsers.forEach(nearbyUser => {
        const socketId = this.userSockets.get(nearbyUser.userId.toString());
        if (socketId) {
          this.io.to(socketId).emit('nearby_user_location_update', {
            userId,
            coordinates,
            accuracy,
            timestamp: new Date()
          });
        }
      });
    } catch (error) {
      logger.error('Broadcast location update error:', error);
    }
  }

  // Get online users count
  getOnlineUsersCount() {
    return this.userSockets.size;
  }

  // Get user socket ID
  getUserSocketId(userId) {
    return this.userSockets.get(userId.toString());
  }

  // Check if user is online
  isUserOnline(userId) {
    return this.userSockets.has(userId.toString());
  }
}

module.exports = SocketHandlers;