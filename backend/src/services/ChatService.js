const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class ChatService {
  constructor() {
    this.activeChats = new Map(); // chatId -> chat data
    this.userChats = new Map(); // userId -> chatIds
    this.chatParticipants = new Map(); // chatId -> participantIds
  }

  // Create or get direct chat between two users
  async createDirectChat(userId1, userId2) {
    try {
      // Check if chat already exists
      let chat = await Chat.findOne({
        type: 'direct',
        participants: { $all: [userId1, userId2] },
        isActive: true
      });

      if (!chat) {
        // Create new chat
        chat = new Chat({
          type: 'direct',
          participants: [userId1, userId2],
          createdBy: userId1,
          isActive: true
        });

        await chat.save();

        // Update user chat mappings
        this.updateUserChatMappings(chat._id, [userId1, userId2]);

        logger.info(`Direct chat created between ${userId1} and ${userId2}`);
      }

      return chat;

    } catch (error) {
      logger.error('Create direct chat error:', error);
      throw error;
    }
  }

  // Create group chat
  async createGroupChat(creatorId, name, description, participants, isPrivate = false) {
    try {
      // Create group
      const group = new Group({
        name,
        description,
        creator: creatorId,
        members: participants,
        admins: [creatorId],
        isPrivate,
        isActive: true
      });

      await group.save();

      // Create chat for group
      const chat = new Chat({
        type: 'group',
        groupId: group._id,
        participants,
        createdBy: creatorId,
        isActive: true
      });

      await chat.save();

      // Update user chat mappings
      this.updateUserChatMappings(chat._id, participants);

      logger.info(`Group chat created: ${name} by user ${creatorId}`);
      return { chat, group };

    } catch (error) {
      logger.error('Create group chat error:', error);
      throw error;
    }
  }

  // Send message to chat
  async sendMessage(chatId, senderId, content, messageType = 'text', replyTo = null, attachments = []) {
    try {
      // Validate chat and sender
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.isActive) {
        throw new Error('Chat not found or inactive');
      }

      if (!chat.participants.includes(senderId)) {
        throw new Error('User not part of this chat');
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

      // Store message in Redis for real-time delivery
      await this.storeMessageInRedis(chatId, message);

      // Update active chats
      this.updateActiveChat(chatId, message);

      logger.info(`Message sent in chat ${chatId} by user ${senderId}`);
      return message;

    } catch (error) {
      logger.error('Send message error:', error);
      throw error;
    }
  }

  // Get chat messages
  async getChatMessages(chatId, userId, page = 1, limit = 50, beforeMessageId = null) {
    try {
      // Validate user access
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.isActive) {
        throw new Error('Chat not found or inactive');
      }

      if (!chat.participants.includes(userId)) {
        throw new Error('User not part of this chat');
      }

      // Build query
      let query = { chatId };
      if (beforeMessageId) {
        query._id = { $lt: beforeMessageId };
      }

      // Get messages
      const messages = await Message.find(query)
        .populate('senderId', 'username displayName profilePicture')
        .populate('replyTo', 'content senderId')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      // Mark messages as read
      await this.markMessagesAsRead(chatId, userId, messages.map(m => m._id));

      return messages.reverse(); // Return in chronological order

    } catch (error) {
      logger.error('Get chat messages error:', error);
      throw error;
    }
  }

  // Get user chats
  async getUserChats(userId, page = 1, limit = 20) {
    try {
      const chats = await Chat.find({
        participants: userId,
        isActive: true
      })
      .populate('participants', 'username displayName profilePicture isOnline lastSeen')
      .populate('lastMessage')
      .populate('groupId', 'name description')
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

      // Get unread counts
      const chatsWithUnread = await Promise.all(
        chats.map(async (chat) => {
          const unreadCount = await Message.countDocuments({
            chatId: chat._id,
            senderId: { $ne: userId },
            readBy: { $ne: userId }
          });

          return {
            ...chat.toJSON(),
            unreadCount
          };
        })
      );

      return chatsWithUnread;

    } catch (error) {
      logger.error('Get user chats error:', error);
      throw error;
    }
  }

  // Search messages in chat
  async searchMessages(chatId, userId, query, page = 1, limit = 20) {
    try {
      // Validate user access
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.isActive) {
        throw new Error('Chat not found or inactive');
      }

      if (!chat.participants.includes(userId)) {
        throw new Error('User not part of this chat');
      }

      // Search messages
      const messages = await Message.find({
        chatId,
        $text: { $search: query }
      })
      .populate('senderId', 'username displayName profilePicture')
      .sort({ score: { $meta: 'textScore' } })
      .skip((page - 1) * limit)
      .limit(limit);

      return messages;

    } catch (error) {
      logger.error('Search messages error:', error);
      throw error;
    }
  }

  // Mark messages as read
  async markMessagesAsRead(chatId, userId, messageIds) {
    try {
      if (!messageIds || messageIds.length === 0) return;

      await Message.updateMany(
        {
          _id: { $in: messageIds },
          chatId,
          senderId: { $ne: userId }
        },
        {
          $addToSet: { readBy: userId }
        }
      );

      // Update chat unread count in Redis
      await this.updateChatUnreadCount(chatId, userId);

    } catch (error) {
      logger.error('Mark messages as read error:', error);
    }
  }

  // Mark all messages in chat as read
  async markChatAsRead(chatId, userId) {
    try {
      await Message.updateMany(
        {
          chatId,
          senderId: { $ne: userId },
          readBy: { $ne: userId }
        },
        {
          $addToSet: { readBy: userId }
        }
      );

      // Update chat unread count in Redis
      await this.updateChatUnreadCount(chatId, userId);

      logger.info(`Chat ${chatId} marked as read by user ${userId}`);

    } catch (error) {
      logger.error('Mark chat as read error:', error);
      throw error;
    }
  }

  // Delete message
  async deleteMessage(messageId, userId) {
    try {
      const message = await Message.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Check if user can delete message
      if (message.senderId.toString() !== userId) {
        throw new Error('Unauthorized to delete this message');
      }

      // Soft delete message
      message.isDeleted = true;
      message.deletedAt = new Date();
      await message.save();

      // Remove from Redis
      await redisManager.getClient().lrem(`chat:${message.chatId}:messages`, 0, messageId.toString());

      logger.info(`Message ${messageId} deleted by user ${userId}`);
      return message;

    } catch (error) {
      logger.error('Delete message error:', error);
      throw error;
    }
  }

  // Add participant to group chat
  async addParticipantToGroup(chatId, userId, newParticipantId) {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat || chat.type !== 'group') {
        throw new Error('Group chat not found');
      }

      // Check if user is admin
      const group = await Group.findById(chat.groupId);
      if (!group.admins.includes(userId)) {
        throw new Error('Unauthorized to add participants');
      }

      // Add participant
      if (!chat.participants.includes(newParticipantId)) {
        chat.participants.push(newParticipantId);
        await chat.save();

        // Update group members
        if (!group.members.includes(newParticipantId)) {
          group.members.push(newParticipantId);
          await group.save();
        }

        // Update user chat mappings
        this.updateUserChatMappings(chatId, [newParticipantId]);

        // Send system message
        await this.sendSystemMessage(chatId, `User added to group`);

        logger.info(`User ${newParticipantId} added to group chat ${chatId}`);
      }

    } catch (error) {
      logger.error('Add participant to group error:', error);
      throw error;
    }
  }

  // Remove participant from group chat
  async removeParticipantFromGroup(chatId, userId, participantId) {
    try {
      const chat = await Chat.findById(chatId);
      if (!chat || chat.type !== 'group') {
        throw new Error('Group chat not found');
      }

      // Check if user is admin
      const group = await Group.findById(chat.groupId);
      if (!group.admins.includes(userId)) {
        throw new Error('Unauthorized to remove participants');
      }

      // Remove participant
      if (chat.participants.includes(participantId)) {
        chat.participants = chat.participants.filter(id => id.toString() !== participantId);
        await chat.save();

        // Update group members
        group.members = group.members.filter(id => id.toString() !== participantId);
        await group.save();

        // Update user chat mappings
        this.removeUserFromChat(chatId, participantId);

        // Send system message
        await this.sendSystemMessage(chatId, `User removed from group`);

        logger.info(`User ${participantId} removed from group chat ${chatId}`);
      }

    } catch (error) {
      logger.error('Remove participant from group error:', error);
      throw error;
    }
  }

  // Send system message
  async sendSystemMessage(chatId, content) {
    try {
      const message = new Message({
        chatId,
        senderId: null, // System message
        content,
        messageType: 'system',
        isSystemMessage: true
      });

      await message.save();

      // Store in Redis
      await this.storeMessageInRedis(chatId, message);

      logger.info(`System message sent in chat ${chatId}: ${content}`);
      return message;

    } catch (error) {
      logger.error('Send system message error:', error);
      throw error;
    }
  }

  // Get chat statistics
  async getChatStats(chatId, userId) {
    try {
      // Validate user access
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.isActive) {
        throw new Error('Chat not found or inactive');
      }

      if (!chat.participants.includes(userId)) {
        throw new Error('User not part of this chat');
      }

      const stats = await Message.aggregate([
        { $match: { chatId: chat._id } },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: 1 },
            textMessages: { $sum: { $cond: [{ $eq: ['$messageType', 'text'] }, 1, 0] } },
            mediaMessages: { $sum: { $cond: [{ $eq: ['$messageType', 'media'] }, 1, 0] } },
            systemMessages: { $sum: { $cond: [{ $eq: ['$messageType', 'system'] }, 1, 0] } },
            firstMessage: { $min: '$createdAt' },
            lastMessage: { $max: '$createdAt' }
          }
        }
      ]);

      return stats[0] || {
        totalMessages: 0,
        textMessages: 0,
        mediaMessages: 0,
        systemMessages: 0,
        firstMessage: null,
        lastMessage: null
      };

    } catch (error) {
      logger.error('Get chat stats error:', error);
      throw error;
    }
  }

  // Helper methods
  async storeMessageInRedis(chatId, message) {
    try {
      await redisManager.getClient().lpush(
        `chat:${chatId}:messages`,
        message._id.toString()
      );

      // Keep only last 100 messages in Redis
      await redisManager.getClient().ltrim(`chat:${chatId}:messages`, 0, 99);

      // Set TTL for chat messages (24 hours)
      await redisManager.getClient().expire(`chat:${chatId}:messages`, 86400);

    } catch (error) {
      logger.error('Store message in Redis error:', error);
    }
  }

  updateActiveChat(chatId, message) {
    try {
      if (!this.activeChats.has(chatId)) {
        this.activeChats.set(chatId, {
          chatId,
          lastMessage: message._id,
          lastMessageAt: message.createdAt,
          lastMessageBy: message.senderId,
          participantCount: 0
        });
      } else {
        const chat = this.activeChats.get(chatId);
        chat.lastMessage = message._id;
        chat.lastMessageAt = message.createdAt;
        chat.lastMessageBy = message.senderId;
      }
    } catch (error) {
      logger.error('Update active chat error:', error);
    }
  }

  updateUserChatMappings(chatId, userIds) {
    try {
      userIds.forEach(userId => {
        if (!this.userChats.has(userId.toString())) {
          this.userChats.set(userId.toString(), []);
        }
        const userChats = this.userChats.get(userId.toString());
        if (!userChats.includes(chatId)) {
          userChats.push(chatId);
        }
      });

      this.chatParticipants.set(chatId.toString(), userIds.map(id => id.toString()));
    } catch (error) {
      logger.error('Update user chat mappings error:', error);
    }
  }

  removeUserFromChat(chatId, userId) {
    try {
      const userChats = this.userChats.get(userId.toString());
      if (userChats) {
        const index = userChats.indexOf(chatId);
        if (index > -1) {
          userChats.splice(index, 1);
        }
      }

      const participants = this.chatParticipants.get(chatId.toString());
      if (participants) {
        const index = participants.indexOf(userId.toString());
        if (index > -1) {
          participants.splice(index, 1);
        }
      }
    } catch (error) {
      logger.error('Remove user from chat error:', error);
    }
  }

  async updateChatUnreadCount(chatId, userId) {
    try {
      const unreadCount = await Message.countDocuments({
        chatId,
        senderId: { $ne: userId },
        readBy: { $ne: userId }
      });

      await redisManager.getClient().hset(
        `chat:${chatId}:unread`,
        userId.toString(),
        unreadCount
      );

    } catch (error) {
      logger.error('Update chat unread count error:', error);
    }
  }

  // Get active chats count
  getActiveChatsCount() {
    return this.activeChats.size;
  }

  // Get total user chats count
  getTotalUserChatsCount() {
    return this.userChats.size;
  }

  // Clean up expired data
  async cleanupExpiredData() {
    try {
      // Clean up old Redis keys
      const keys = await redisManager.getClient().keys('chat:*:messages');
      const now = Date.now();
      const expiryTime = 7 * 24 * 60 * 60 * 1000; // 7 days

      for (const key of keys) {
        const ttl = await redisManager.getClient().ttl(key);
        if (ttl === -1) { // No TTL set
          await redisManager.getClient().expire(key, 86400); // Set 24 hour TTL
        }
      }

      logger.info('Chat service cleanup completed');

    } catch (error) {
      logger.error('Chat service cleanup error:', error);
    }
  }
}

module.exports = ChatService;