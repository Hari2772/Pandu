const Message = require('../../models/Message');
const Chat = require('../../models/Chat');
const User = require('../../models/User');
const Analytics = require('../../models/Analytics');
const redisManager = require('../../config/redis');
const logger = require('../../utils/logger');
const constants = require('../../utils/constants');

class MessageHandler {
  constructor(io, authHandler) {
    this.io = io;
    this.authHandler = authHandler;
    this.typingUsers = new Map(); // chatId -> Set of typing users
    this.typingTimers = new Map(); // userId -> typing timeout
  }

  // Handle new message
  async handleNewMessage(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { chatId, content, messageType = 'text', replyTo, mediaUrl, location, metadata } = data;

      if (!chatId || !content) {
        socket.emit('message:error', { error: 'Chat ID and content are required' });
        return;
      }

      // Validate chat access
      const chat = await Chat.findById(chatId)
        .populate('participants.userId', 'username displayName profilePicture isBlocked')
        .populate('lastMessage');

      if (!chat) {
        socket.emit('message:error', { error: 'Chat not found' });
        return;
      }

      // Check if user is participant
      const participant = chat.participants.find(p => p.userId._id.toString() === userData.id.toString());
      if (!participant) {
        socket.emit('message:error', { error: 'Access denied' });
        return;
      }

      // Check if user is blocked
      if (participant.isBlocked) {
        socket.emit('message:error', { error: 'You are blocked from sending messages' });
        return;
      }

      // Create message
      const message = new Message({
        chatId,
        senderId: userData.id,
        content,
        messageType,
        replyTo,
        mediaUrl,
        location,
        metadata: {
          ...metadata,
          platform: 'socket',
          socketId: socket.id
        }
      });

      await message.save();

      // Populate sender info
      await message.populate('senderId', 'username displayName profilePicture');

      // Update chat
      chat.lastMessage = message._id;
      chat.lastActivity = new Date();
      chat.unreadCount = chat.participants.reduce((total, p) => {
        if (p.userId._id.toString() !== userData.id.toString()) {
          return total + 1;
        }
        return total;
      }, 0);
      await chat.save();

      // Prepare message data for broadcasting
      const messageData = {
        id: message._id,
        chatId: message.chatId,
        senderId: message.senderId,
        content: message.content,
        messageType: message.messageType,
        replyTo: message.replyTo,
        mediaUrl: message.mediaUrl,
        location: message.location,
        metadata: message.metadata,
        timestamp: message.timestamp,
        isRead: false,
        reactions: []
      };

      // Broadcast to chat participants
      await this.broadcastToChat(chatId, 'message:new', messageData, userData.id);

      // Send delivery confirmation to sender
      socket.emit('message:sent', {
        messageId: message._id,
        timestamp: message.timestamp,
        status: 'sent'
      });

      // Update typing status
      this.stopTyping(socket, chatId);

      // Track analytics
      await Analytics.create({
        eventType: 'message_sent',
        eventName: 'Message Sent',
        eventCategory: 'communication',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          chatId,
          messageType,
          hasReply: !!replyTo,
          hasMedia: !!mediaUrl,
          hasLocation: !!location
        }
      });

      // Send push notifications to offline participants
      await this.sendPushNotifications(chat, message, userData);

      logger.info(`Message sent in chat ${chatId} by user ${userData.username}`);

    } catch (error) {
      logger.error('Handle new message error:', error);
      socket.emit('message:error', { error: 'Failed to send message' });
    }
  }

  // Handle message read
  async handleMessageRead(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { messageIds, chatId } = data;

      if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
        socket.emit('message:error', { error: 'Message IDs are required' });
        return;
      }

      // Mark messages as read
      await Message.updateMany(
        {
          _id: { $in: messageIds },
          chatId,
          senderId: { $ne: userData.id } // Don't mark own messages as read
        },
        {
          $addToSet: { readBy: userData.id },
          $set: { readAt: new Date() }
        }
      );

      // Update chat unread count
      if (chatId) {
        const chat = await Chat.findById(chatId);
        if (chat) {
          const unreadCount = await Message.countDocuments({
            chatId,
            senderId: { $ne: userData.id },
            readBy: { $ne: userData.id }
          });

          chat.unreadCount = unreadCount;
          await chat.save();
        }
      }

      // Broadcast read status to chat participants
      await this.broadcastToChat(chatId, 'message:read', {
        messageIds,
        readBy: userData.id,
        readAt: new Date()
      }, userData.id);

      // Track analytics
      await Analytics.create({
        eventType: 'message_read',
        eventName: 'Message Read',
        eventCategory: 'communication',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          messageIds,
          chatId,
          messageCount: messageIds.length
        }
      });

    } catch (error) {
      logger.error('Handle message read error:', error);
      socket.emit('message:error', { error: 'Failed to mark messages as read' });
    }
  }

  // Handle message reaction
  async handleMessageReaction(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { messageId, reaction, action = 'add' } = data;

      if (!messageId || !reaction) {
        socket.emit('message:error', { error: 'Message ID and reaction are required' });
        return;
      }

      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('message:error', { error: 'Message not found' });
        return;
      }

      // Check if user can react to this message
      const chat = await Chat.findById(message.chatId);
      if (!chat) {
        socket.emit('message:error', { error: 'Chat not found' });
        return;
      }

      const participant = chat.participants.find(p => p.userId.toString() === userData.id.toString());
      if (!participant || participant.isBlocked) {
        socket.emit('message:error', { error: 'Access denied' });
        return;
      }

      if (action === 'add') {
        // Add reaction
        const existingReaction = message.reactions.find(r => 
          r.userId.toString() === userData.id.toString() && r.reaction === reaction
        );

        if (!existingReaction) {
          message.reactions.push({
            userId: userData.id,
            reaction,
            timestamp: new Date()
          });
        }
      } else if (action === 'remove') {
        // Remove reaction
        message.reactions = message.reactions.filter(r => 
          !(r.userId.toString() === userData.id.toString() && r.reaction === reaction)
        );
      }

      await message.save();

      // Broadcast reaction to chat participants
      await this.broadcastToChat(message.chatId, 'message:reaction', {
        messageId,
        reaction,
        action,
        userId: userData.id,
        timestamp: new Date()
      }, userData.id);

      // Track analytics
      await Analytics.create({
        eventType: 'message_reaction',
        eventName: 'Message Reaction',
        eventCategory: 'communication',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          messageId,
          reaction,
          action
        }
      });

    } catch (error) {
      logger.error('Handle message reaction error:', error);
      socket.emit('message:error', { error: 'Failed to update reaction' });
    }
  }

  // Handle message deletion
  async handleMessageDelete(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { messageId } = data;

      if (!messageId) {
        socket.emit('message:error', { error: 'Message ID is required' });
        return;
      }

      const message = await Message.findById(messageId);
      if (!message) {
        socket.emit('message:error', { error: 'Message not found' });
        return;
      }

      // Check if user can delete this message
      if (message.senderId.toString() !== userData.id.toString()) {
        const chat = await Chat.findById(message.chatId);
        if (!chat) {
          socket.emit('message:error', { error: 'Chat not found' });
          return;
        }

        const participant = chat.participants.find(p => p.userId.toString() === userData.id.toString());
        if (!participant || !participant.canDeleteMessages) {
          socket.emit('message:error', { error: 'Permission denied' });
          return;
        }
      }

      // Soft delete message
      message.isDeleted = true;
      message.deletedAt = new Date();
      message.deletedBy = userData.id;
      await message.save();

      // Broadcast deletion to chat participants
      await this.broadcastToChat(message.chatId, 'message:deleted', {
        messageId,
        deletedBy: userData.id,
        deletedAt: new Date()
      }, userData.id);

      // Track analytics
      await Analytics.create({
        eventType: 'message_deleted',
        eventName: 'Message Deleted',
        eventCategory: 'communication',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          messageId,
          originalSender: message.senderId.toString() === userData.id.toString()
        }
      });

    } catch (error) {
      logger.error('Handle message delete error:', error);
      socket.emit('message:error', { error: 'Failed to delete message' });
    }
  }

  // Handle typing indicator
  async handleTyping(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { chatId, isTyping } = data;

      if (!chatId) {
        socket.emit('message:error', { error: 'Chat ID is required' });
        return;
      }

      if (isTyping) {
        this.startTyping(socket, chatId, userData);
      } else {
        this.stopTyping(socket, chatId);
      }

    } catch (error) {
      logger.error('Handle typing error:', error);
    }
  }

  // Start typing indicator
  startTyping(socket, chatId, userData) {
    if (!this.typingUsers.has(chatId)) {
      this.typingUsers.set(chatId, new Set());
    }

    this.typingUsers.get(chatId).add(userData.id);

    // Broadcast typing status
    this.broadcastToChat(chatId, 'typing:start', {
      userId: userData.id,
      username: userData.username
    }, userData.id);

    // Set timer to stop typing
    const timerKey = `${userData.id}-${chatId}`;
    if (this.typingTimers.has(timerKey)) {
      clearTimeout(this.typingTimers.get(timerKey));
    }

    const timer = setTimeout(() => {
      this.stopTyping(socket, chatId);
    }, 5000); // Stop typing after 5 seconds

    this.typingTimers.set(timerKey, timer);
  }

  // Stop typing indicator
  stopTyping(socket, chatId) {
    const userData = this.authHandler.getUserBySocketId(socket.id);
    if (!userData) return;

    if (this.typingUsers.has(chatId)) {
      this.typingUsers.get(chatId).delete(userData.id);
      
      if (this.typingUsers.get(chatId).size === 0) {
        this.typingUsers.delete(chatId);
      }
    }

    // Clear timer
    const timerKey = `${userData.id}-${chatId}`;
    if (this.typingTimers.has(timerKey)) {
      clearTimeout(this.typingTimers.get(timerKey));
      this.typingTimers.delete(timerKey);
    }

    // Broadcast typing stopped
    this.broadcastToChat(chatId, 'typing:stop', {
      userId: userData.id
    }, userData.id);
  }

  // Handle message search
  async handleMessageSearch(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { chatId, query, limit = 20, offset = 0 } = data;

      if (!query || query.trim().length < 2) {
        socket.emit('message:error', { error: 'Search query must be at least 2 characters' });
        return;
      }

      // Check chat access
      const chat = await Chat.findById(chatId);
      if (!chat) {
        socket.emit('message:error', { error: 'Chat not found' });
        return;
      }

      const participant = chat.participants.find(p => p.userId.toString() === userData.id.toString());
      if (!participant) {
        socket.emit('message:error', { error: 'Access denied' });
        return;
      }

      // Search messages
      const messages = await Message.find({
        chatId,
        content: { $regex: query, $options: 'i' },
        isDeleted: false
      })
        .populate('senderId', 'username displayName profilePicture')
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit);

      // Send search results
      socket.emit('message:search_results', {
        query,
        messages,
        hasMore: messages.length === limit
      });

    } catch (error) {
      logger.error('Handle message search error:', error);
      socket.emit('message:error', { error: 'Search failed' });
    }
  }

  // Broadcast to chat participants
  async broadcastToChat(chatId, event, data, excludeUserId = null) {
    try {
      const chat = await Chat.findById(chatId).populate('participants.userId');
      if (!chat) return;

      chat.participants.forEach(participant => {
        if (excludeUserId && participant.userId._id.toString() === excludeUserId.toString()) {
          return;
        }

        const userSockets = this.authHandler.getUserSockets(participant.userId._id);
        userSockets.forEach(socketId => {
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit(event, data);
          }
        });
      });

    } catch (error) {
      logger.error('Broadcast to chat error:', error);
    }
  }

  // Send push notifications
  async sendPushNotifications(chat, message, sender) {
    try {
      // This would integrate with your push notification service
      // For now, we'll just log the intent
      logger.info(`Push notification intent for chat ${chat._id} - message from ${sender.username}`);

      // You would implement push notification logic here:
      // - Get offline participants
      // - Send to FCM/APNS
      // - Update notification preferences
      // - Track delivery status

    } catch (error) {
      logger.error('Send push notifications error:', error);
    }
  }

  // Get chat statistics
  async getChatStats(chatId) {
    try {
      const messageCount = await Message.countDocuments({ chatId, isDeleted: false });
      const participantCount = await Chat.findById(chatId).then(chat => chat?.participants.length || 0);
      const lastActivity = await Message.findOne({ chatId, isDeleted: false })
        .sort({ timestamp: -1 })
        .select('timestamp');

      return {
        messageCount,
        participantCount,
        lastActivity: lastActivity?.timestamp
      };

    } catch (error) {
      logger.error('Get chat stats error:', error);
      return null;
    }
  }

  // Clean up expired typing indicators
  cleanupExpingTyping() {
    const now = Date.now();
    
    for (const [timerKey, timer] of this.typingTimers) {
      if (now - timer.startTime > 10000) { // 10 seconds
        clearTimeout(timer);
        this.typingTimers.delete(timerKey);
      }
    }
  }
}

module.exports = MessageHandler;