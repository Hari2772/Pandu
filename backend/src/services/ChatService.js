const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const Analytics = require('../models/Analytics');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class ChatService {
  constructor() {
    this.messageCache = new Map(); // chatId -> recent messages
    this.userTyping = new Map(); // chatId -> Set of typing users
    this.unreadCounts = new Map(); // userId -> Map of chatId -> count
  }

  // Chat Management
  async createChat(participantIds, chatType = 'direct', metadata = {}) {
    try {
      // Validate participants
      if (participantIds.length < 2) {
        throw new Error('At least 2 participants required');
      }

      // Check if direct chat already exists
      if (chatType === 'direct' && participantIds.length === 2) {
        const existingChat = await Chat.findOne({
          type: 'direct',
          'participants.userId': { $all: participantIds },
          'participants.status': 'active'
        });

        if (existingChat) {
          return existingChat;
        }
      }

      // Create chat
      const chat = new Chat({
        type: chatType,
        participants: participantIds.map(userId => ({
          userId,
          status: 'active',
          joinedAt: new Date(),
          role: 'member'
        })),
        metadata,
        lastMessageAt: new Date()
      });

      await chat.save();

      // Initialize cache
      this.messageCache.set(chat._id.toString(), []);
      this.userTyping.set(chat._id.toString(), new Set());
      this.initializeUnreadCounts(chat._id, participantIds);

      // Track analytics
      await Analytics.create({
        eventType: 'group_created',
        eventName: 'Chat Created',
        eventCategory: 'communication',
        userId: participantIds[0],
        platform: 'service',
        metadata: {
          chatId: chat._id,
          chatType,
          participantCount: participantIds.length
        }
      });

      logger.info(`Chat created: ${chat._id} (${chatType}) with ${participantIds.length} participants`);
      return chat;

    } catch (error) {
      logger.error('Create chat error:', error);
      throw error;
    }
  }

  async createGroupChat(creatorId, groupName, participantIds, description = '', avatar = null) {
    try {
      // Create group
      const group = new Group({
        name: groupName,
        description,
        avatar,
        creatorId,
        members: participantIds.map(userId => ({
          userId,
          role: userId.toString() === creatorId.toString() ? 'admin' : 'member',
          status: 'active',
          joinedAt: new Date()
        })),
        settings: {
          allowMemberInvites: true,
          requireAdminApproval: false,
          allowMemberEditing: false
        }
      });

      await group.save();

      // Create group chat
      const chat = await this.createChat(participantIds, 'group', {
        groupId: group._id,
        groupName: group.name,
        groupDescription: group.description
      });

      // Track analytics
      await Analytics.create({
        eventType: 'group_created',
        eventName: 'Group Chat Created',
        eventCategory: 'social',
        userId: creatorId,
        platform: 'service',
        metadata: {
          groupId: group._id,
          chatId: chat._id,
          participantCount: participantIds.length
        }
      });

      logger.info(`Group chat created: ${group.name} (${group._id}) with ${participantIds.length} members`);
      return { group, chat };

    } catch (error) {
      logger.error('Create group chat error:', error);
      throw error;
    }
  }

  async addParticipantToChat(chatId, userId, addedBy, role = 'member') {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      // Check if user is already a participant
      const existingParticipant = chat.participants.find(
        p => p.userId.toString() === userId.toString()
      );

      if (existingParticipant) {
        if (existingParticipant.status === 'active') {
          throw new Error('User is already an active participant');
        }
        // Reactivate user
        existingParticipant.status = 'active';
        existingParticipant.role = role;
        existingParticipant.joinedAt = new Date();
      } else {
        // Add new participant
        chat.participants.push({
          userId,
          status: 'active',
          joinedAt: new Date(),
          role
        });
      }

      await chat.save();

      // Initialize unread count for new participant
      this.initializeUnreadCounts(chatId, [userId]);

      // Track analytics
      await Analytics.create({
        eventType: 'group_joined',
        eventName: 'User Added to Chat',
        eventCategory: 'social',
        userId: addedBy,
        platform: 'service',
        metadata: {
          chatId,
          addedUserId: userId,
          role
        }
      });

      logger.info(`User ${userId} added to chat ${chatId} by ${addedBy}`);
      return chat;

    } catch (error) {
      logger.error('Add participant to chat error:', error);
      throw error;
    }
  }

  async removeParticipantFromChat(chatId, userId, removedBy) {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      const participant = chat.participants.find(
        p => p.userId.toString() === userId.toString()
      );

      if (!participant) {
        throw new Error('User is not a participant in this chat');
      }

      // Soft remove participant
      participant.status = 'removed';
      participant.removedAt = new Date();
      participant.removedBy = removedBy;

      await chat.save();

      // Remove from unread counts
      this.removeUnreadCount(chatId, userId);

      // Track analytics
      await Analytics.create({
        eventType: 'group_left',
        eventName: 'User Removed from Chat',
        eventCategory: 'social',
        userId: removedBy,
        platform: 'service',
        metadata: {
          chatId,
          removedUserId: userId
        }
      });

      logger.info(`User ${userId} removed from chat ${chatId} by ${removedBy}`);
      return chat;

    } catch (error) {
      logger.error('Remove participant from chat error:', error);
      throw error;
    }
  }

  // Message Management
  async sendMessage(chatId, senderId, content, messageType = 'text', replyTo = null, attachments = []) {
    try {
      // Validate chat access
      const chat = await Chat.findById(chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      const participant = chat.participants.find(
        p => p.userId.toString() === senderId.toString() && p.status === 'active'
      );

      if (!participant) {
        throw new Error('User is not an active participant in this chat');
      }

      // Create message
      const message = new Message({
        chatId,
        senderId,
        content,
        messageType,
        replyTo,
        attachments,
        metadata: {
          participantRole: participant.role,
          chatType: chat.type
        }
      });

      await message.save();

      // Update chat
      chat.lastMessage = message._id;
      chat.lastMessageAt = new Date();
      chat.messageCount = (chat.messageCount || 0) + 1;

      // Update unread counts for other participants
      chat.participants.forEach(p => {
        if (p.userId.toString() !== senderId.toString() && p.status === 'active') {
          this.incrementUnreadCount(chatId, p.userId);
        }
      });

      await chat.save();

      // Add to cache
      this.addMessageToCache(chatId, message);

      // Track analytics
      await Analytics.create({
        eventType: 'message_sent',
        eventName: 'Message Sent',
        eventCategory: 'communication',
        userId: senderId,
        platform: 'service',
        metadata: {
          chatId,
          messageId: message._id,
          messageType,
          hasAttachments: attachments.length > 0,
          isReply: !!replyTo,
          chatType: chat.type
        }
      });

      logger.info(`Message sent: ${message._id} in chat ${chatId} by ${senderId}`);
      return message;

    } catch (error) {
      logger.error('Send message error:', error);
      throw error;
    }
  }

  async getMessages(chatId, userId, options = {}) {
    try {
      const { page = 1, limit = 50, before = null, after = null } = options;

      // Validate chat access
      const chat = await Chat.findById(chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      const participant = chat.participants.find(
        p => p.userId.toString() === userId.toString() && p.status === 'active'
      );

      if (!participant) {
        throw new Error('User is not an active participant in this chat');
      }

      // Build query
      let query = { chatId };
      if (before) query._id = { $lt: before };
      if (after) query._id = { $gt: after };

      // Get messages
      const messages = await Message.find(query)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('senderId', 'username displayName profilePicture')
        .populate('replyTo', 'content messageType senderId')
        .lean();

      // Mark messages as read
      await this.markMessagesAsRead(chatId, userId);

      // Track analytics
      await Analytics.create({
        eventType: 'message_read',
        eventName: 'Messages Retrieved',
        eventCategory: 'communication',
        userId,
        platform: 'service',
        metadata: {
          chatId,
          messageCount: messages.length,
          page,
          limit
        }
      });

      return messages.reverse(); // Return in chronological order

    } catch (error) {
      logger.error('Get messages error:', error);
      throw error;
    }
  }

  async markMessagesAsRead(chatId, userId) {
    try {
      // Mark messages as read
      const result = await Message.updateMany(
        {
          chatId,
          senderId: { $ne: userId },
          readBy: { $ne: userId }
        },
        {
          $addToSet: { readBy: userId },
          readAt: new Date()
        }
      );

      if (result.modifiedCount > 0) {
        // Reset unread count for this chat
        this.resetUnreadCount(chatId, userId);

        // Track analytics
        await Analytics.create({
          eventType: 'message_read',
          eventName: 'Messages Marked as Read',
          eventCategory: 'communication',
          userId,
          platform: 'service',
          metadata: {
            chatId,
            messageCount: result.modifiedCount
          }
        });
      }

      return result.modifiedCount;

    } catch (error) {
      logger.error('Mark messages as read error:', error);
      throw error;
    }
  }

  async deleteMessage(messageId, userId) {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Check permissions
      if (message.senderId.toString() !== userId.toString()) {
        // Check if user is admin in group chat
        const chat = await Chat.findById(message.chatId);
        if (!chat || chat.type !== 'group') {
          throw new Error('Unauthorized to delete this message');
        }

        const participant = chat.participants.find(
          p => p.userId.toString() === userId.toString() && p.status === 'active'
        );

        if (!participant || participant.role !== 'admin') {
          throw new Error('Unauthorized to delete this message');
        }
      }

      // Soft delete message
      message.isDeleted = true;
      message.deletedAt = new Date();
      message.deletedBy = userId;
      await message.save();

      // Track analytics
      await Analytics.create({
        eventType: 'message_deleted',
        eventName: 'Message Deleted',
        eventCategory: 'communication',
        userId,
        platform: 'service',
        metadata: {
          messageId,
          chatId: message.chatId,
          originalSenderId: message.senderId
        }
      });

      logger.info(`Message ${messageId} deleted by ${userId}`);
      return message;

    } catch (error) {
      logger.error('Delete message error:', error);
      throw error;
    }
  }

  // Typing Indicators
  async setTypingStatus(chatId, userId, isTyping) {
    try {
      if (!this.userTyping.has(chatId)) {
        this.userTyping.set(chatId, new Set());
      }

      const typingUsers = this.userTyping.get(chatId);

      if (isTyping) {
        typingUsers.add(userId);
        // Auto-remove typing status after 10 seconds
        setTimeout(() => {
          this.removeTypingStatus(chatId, userId);
        }, 10000);
      } else {
        typingUsers.delete(userId);
      }

      return Array.from(typingUsers);

    } catch (error) {
      logger.error('Set typing status error:', error);
      throw error;
    }
  }

  async getTypingUsers(chatId) {
    try {
      const typingUsers = this.userTyping.get(chatId) || new Set();
      return Array.from(typingUsers);
    } catch (error) {
      logger.error('Get typing users error:', error);
      return [];
    }
  }

  async removeTypingStatus(chatId, userId) {
    try {
      const typingUsers = this.userTyping.get(chatId);
      if (typingUsers) {
        typingUsers.delete(userId);
      }
    } catch (error) {
      logger.error('Remove typing status error:', error);
    }
  }

  // Unread Count Management
  initializeUnreadCounts(chatId, userIds) {
    userIds.forEach(userId => {
      if (!this.unreadCounts.has(userId.toString())) {
        this.unreadCounts.set(userId.toString(), new Map());
      }
      this.unreadCounts.get(userId.toString()).set(chatId.toString(), 0);
    });
  }

  incrementUnreadCount(chatId, userId) {
    try {
      if (!this.unreadCounts.has(userId.toString())) {
        this.unreadCounts.set(userId.toString(), new Map());
      }

      const userCounts = this.unreadCounts.get(userId.toString());
      const currentCount = userCounts.get(chatId.toString()) || 0;
      userCounts.set(chatId.toString(), currentCount + 1);
    } catch (error) {
      logger.error('Increment unread count error:', error);
    }
  }

  resetUnreadCount(chatId, userId) {
    try {
      const userCounts = this.unreadCounts.get(userId.toString());
      if (userCounts) {
        userCounts.set(chatId.toString(), 0);
      }
    } catch (error) {
      logger.error('Reset unread count error:', error);
    }
  }

  removeUnreadCount(chatId, userId) {
    try {
      const userCounts = this.unreadCounts.get(userId.toString());
      if (userCounts) {
        userCounts.delete(chatId.toString());
      }
    } catch (error) {
      logger.error('Remove unread count error:', error);
    }
  }

  getUnreadCount(chatId, userId) {
    try {
      const userCounts = this.unreadCounts.get(userId.toString());
      return userCounts ? (userCounts.get(chatId.toString()) || 0) : 0;
    } catch (error) {
      logger.error('Get unread count error:', error);
      return 0;
    }
  }

  getTotalUnreadCount(userId) {
    try {
      const userCounts = this.unreadCounts.get(userId.toString());
      if (!userCounts) return 0;

      let total = 0;
      for (const count of userCounts.values()) {
        total += count;
      }
      return total;
    } catch (error) {
      logger.error('Get total unread count error:', error);
      return 0;
    }
  }

  // Cache Management
  addMessageToCache(chatId, message) {
    try {
      if (!this.messageCache.has(chatId)) {
        this.messageCache.set(chatId, []);
      }

      const cache = this.messageCache.get(chatId);
      cache.push(message);

      // Keep only last 100 messages in cache
      if (cache.length > 100) {
        cache.shift();
      }
    } catch (error) {
      logger.error('Add message to cache error:', error);
    }
  }

  getCachedMessages(chatId) {
    try {
      return this.messageCache.get(chatId) || [];
    } catch (error) {
      logger.error('Get cached messages error:', error);
      return [];
    }
  }

  clearCache(chatId) {
    try {
      this.messageCache.delete(chatId);
      this.userTyping.delete(chatId);
    } catch (error) {
      logger.error('Clear cache error:', error);
    }
  }

  // Chat Discovery
  async getChatsForUser(userId, options = {}) {
    try {
      const { page = 1, limit = 20, type = null } = options;

      let query = {
        'participants.userId': userId,
        'participants.status': 'active'
      };

      if (type) {
        query.type = type;
      }

      const chats = await Chat.find(query)
        .populate('participants.userId', 'username displayName profilePicture isOnline lastSeen')
        .populate('lastMessage')
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Add unread counts and typing status
      const enrichedChats = chats.map(chat => {
        const participant = chat.participants.find(
          p => p.userId._id.toString() === userId.toString()
        );

        return {
          ...chat,
          unreadCount: this.getUnreadCount(chat._id, userId),
          typingUsers: this.getTypingUsers(chat._id),
          userRole: participant ? participant.role : null
        };
      });

      return enrichedChats;

    } catch (error) {
      logger.error('Get chats for user error:', error);
      throw error;
    }
  }

  async searchChats(userId, query, options = {}) {
    try {
      const { page = 1, limit = 20, type = null } = options;

      let searchQuery = {
        'participants.userId': userId,
        'participants.status': 'active'
      };

      if (type) {
        searchQuery.type = type;
      }

      if (query) {
        searchQuery.$or = [
          { 'metadata.groupName': { $regex: query, $options: 'i' } },
          { 'metadata.groupDescription': { $regex: query, $options: 'i' } }
        ];
      }

      const chats = await Chat.find(searchQuery)
        .populate('participants.userId', 'username displayName profilePicture')
        .populate('lastMessage')
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      return chats;

    } catch (error) {
      logger.error('Search chats error:', error);
      throw error;
    }
  }

  // Analytics and Statistics
  async getChatStats(chatId, userId) {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      // Get message statistics
      const messageStats = await Message.aggregate([
        { $match: { chatId: chat._id } },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: 1 },
            messageTypes: { $addToSet: '$messageType' },
            firstMessage: { $min: '$timestamp' },
            lastMessage: { $max: '$timestamp' }
          }
        }
      ]);

      // Get participant statistics
      const participantStats = {
        totalParticipants: chat.participants.length,
        activeParticipants: chat.participants.filter(p => p.status === 'active').length,
        adminCount: chat.participants.filter(p => p.role === 'admin').length
      };

      // Get user's message count
      const userMessageCount = await Message.countDocuments({
        chatId: chat._id,
        senderId: userId
      });

      return {
        chatId,
        messageStats: messageStats[0] || {},
        participantStats,
        userMessageCount,
        unreadCount: this.getUnreadCount(chatId, userId),
        lastActivity: chat.lastMessageAt
      };

    } catch (error) {
      logger.error('Get chat stats error:', error);
      throw error;
    }
  }

  // Cleanup and Maintenance
  async cleanupInactiveChats() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const inactiveChats = await Chat.find({
        lastMessageAt: { $lt: thirtyDaysAgo },
        type: 'direct'
      });

      for (const chat of inactiveChats) {
        // Archive inactive direct chats
        chat.isArchived = true;
        chat.archivedAt = new Date();
        await chat.save();

        // Clear cache
        this.clearCache(chat._id);

        logger.info(`Archived inactive chat: ${chat._id}`);
      }

      return inactiveChats.length;

    } catch (error) {
      logger.error('Cleanup inactive chats error:', error);
      throw error;
    }
  }

  // Health Check
  getHealthStatus() {
    return {
      messageCacheSize: this.messageCache.size,
      userTypingSize: this.userTyping.size,
      unreadCountsSize: this.unreadCounts.size,
      totalCachedMessages: Array.from(this.messageCache.values()).reduce((total, messages) => total + messages.length, 0),
      timestamp: new Date()
    };
  }
}

module.exports = new ChatService();