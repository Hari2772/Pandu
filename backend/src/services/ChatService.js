const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

class ChatService {
  constructor() {
    this.activeChats = new Map(); // chatId -> chat data
    this.userChats = new Map(); // userId -> [chatIds]
  }

  // Create or get direct chat
  async getOrCreateDirectChat(userId1, userId2) {
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
        this.addUserToChat(userId1, chat._id);
        this.addUserToChat(userId2, chat._id);

        logger.info(`New direct chat created: ${chat._id} between ${userId1} and ${userId2}`);
      }

      return chat;
    } catch (error) {
      logger.error('Get or create direct chat error:', error);
      throw error;
    }
  }

  // Create group chat
  async createGroupChat(creatorId, groupData) {
    try {
      const { name, description, participants, isPrivate, avatar } = groupData;

      // Validate participants
      if (!participants || participants.length < 2) {
        throw new Error('Group must have at least 2 participants');
      }

      // Add creator to participants if not already included
      if (!participants.includes(creatorId)) {
        participants.push(creatorId);
      }

      // Create group
      const group = new Group({
        name,
        description,
        creator: creatorId,
        members: participants.map(userId => ({
          userId,
          role: userId === creatorId ? 'admin' : 'member',
          joinedAt: new Date()
        })),
        isPrivate,
        avatar
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
      participants.forEach(userId => {
        this.addUserToChat(userId, chat._id);
      });

      // Populate chat data
      await chat.populate('groupId');
      await chat.populate('participants', 'username displayName profilePicture');

      logger.info(`New group chat created: ${chat._id} by ${creatorId}`);

      return { chat, group };
    } catch (error) {
      logger.error('Create group chat error:', error);
      throw error;
    }
  }

  // Send message
  async sendMessage(chatId, senderId, messageData) {
    try {
      const { content, messageType = 'text', replyTo, attachments, metadata } = messageData;

      // Validate chat
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.isActive) {
        throw new Error('Chat not found or inactive');
      }

      // Check if user is participant
      if (!chat.participants.includes(senderId)) {
        throw new Error('User not authorized to send message in this chat');
      }

      // Create message
      const message = new Message({
        chatId,
        senderId,
        content,
        messageType,
        replyTo,
        attachments,
        metadata
      });

      await message.save();

      // Update chat last message
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: message._id,
        lastMessageAt: new Date(),
        lastMessageBy: senderId,
        messageCount: { $inc: 1 }
      });

      // Populate sender info
      await message.populate('senderId', 'username displayName profilePicture');

      // Cache message in Redis
      await this.cacheMessage(chatId, message);

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
  async getChatMessages(chatId, userId, options = {}) {
    try {
      const { page = 1, limit = 50, before, after, messageType } = options;

      // Validate chat access
      const chat = await Chat.findById(chatId);
      if (!chat || !chat.isActive) {
        throw new Error('Chat not found or inactive');
      }

      if (!chat.participants.includes(userId)) {
        throw new Error('User not authorized to access this chat');
      }

      // Build query
      let query = { chatId };
      if (messageType) query.messageType = messageType;
      if (before) query._id = { $lt: before };
      if (after) query._id = { $gt: after };

      // Get messages
      const messages = await Message.find(query)
        .populate('senderId', 'username displayName profilePicture')
        .populate('replyTo', 'content messageType')
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

  // Mark messages as read
  async markMessagesAsRead(chatId, userId, messageIds) {
    try {
      if (!messageIds || messageIds.length === 0) return;

      // Update messages
      await Message.updateMany(
        {
          _id: { $in: messageIds },
          senderId: { $ne: userId },
          readBy: { $ne: userId }
        },
        {
          $push: { readBy: { userId, readAt: new Date() } }
        }
      );

      // Update chat unread count
      await Chat.findByIdAndUpdate(chatId, {
        $inc: { unreadCount: -1 }
      });

    } catch (error) {
      logger.error('Mark messages as read error:', error);
    }
  }

  // Get user chats
  async getUserChats(userId, options = {}) {
    try {
      const { page = 1, limit = 20, type } = options;

      // Build query
      let query = {
        participants: userId,
        isActive: true
      };

      if (type) query.type = type;

      // Get chats
      const chats = await Chat.find(query)
        .populate('participants', 'username displayName profilePicture isOnline lastSeen')
        .populate('lastMessage')
        .populate('groupId', 'name description avatar')
        .sort({ lastMessageAt: -1, updatedAt: -1 })
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
            ...chat.toObject(),
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

  // Search messages
  async searchMessages(userId, query, options = {}) {
    try {
      const { page = 1, limit = 20, chatId, messageType, startDate, endDate } = options;

      // Build search query
      let searchQuery = {
        $text: { $search: query }
      };

      if (chatId) searchQuery.chatId = chatId;
      if (messageType) searchQuery.messageType = messageType;
      if (startDate || endDate) {
        searchQuery.createdAt = {};
        if (startDate) searchQuery.createdAt.$gte = startDate;
        if (endDate) searchQuery.createdAt.$lte = endDate;
      }

      // Get user's accessible chats
      const userChats = await Chat.find({
        participants: userId,
        isActive: true
      }).select('_id');

      const chatIds = userChats.map(chat => chat._id);
      searchQuery.chatId = { $in: chatIds };

      // Search messages
      const messages = await Message.find(searchQuery)
        .populate('chatId', 'type groupId')
        .populate('senderId', 'username displayName profilePicture')
        .populate('groupId', 'name')
        .sort({ score: { $meta: 'textScore' } })
        .skip((page - 1) * limit)
        .limit(limit);

      return messages;
    } catch (error) {
      logger.error('Search messages error:', error);
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
      if (message.senderId.toString() !== userId.toString()) {
        // Check if user is admin in group chat
        if (message.chatId.type === 'group') {
          const chat = await Chat.findById(message.chatId).populate('groupId');
          const group = chat.groupId;
          const member = group.members.find(m => m.userId.toString() === userId);
          
          if (!member || member.role !== 'admin') {
            throw new Error('Unauthorized to delete message');
          }
        } else {
          throw new Error('Unauthorized to delete message');
        }
      }

      // Soft delete message
      message.isDeleted = true;
      message.deletedAt = new Date();
      message.deletedBy = userId;
      await message.save();

      // Update chat message count
      await Chat.findByIdAndUpdate(message.chatId, {
        $inc: { messageCount: -1 }
      });

      // Remove from cache
      await this.removeCachedMessage(message.chatId, messageId);

      logger.info(`Message ${messageId} deleted by user ${userId}`);

      return message;
    } catch (error) {
      logger.error('Delete message error:', error);
      throw error;
    }
  }

  // Update message
  async updateMessage(messageId, userId, updateData) {
    try {
      const { content, attachments, metadata } = updateData;

      const message = await Message.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Check if user can edit message
      if (message.senderId.toString() !== userId.toString()) {
        throw new Error('Unauthorized to edit message');
      }

      // Check if message is too old to edit (e.g., 15 minutes)
      const editTimeLimit = 15 * 60 * 1000; // 15 minutes
      if (Date.now() - message.createdAt > editTimeLimit) {
        throw new Error('Message too old to edit');
      }

      // Update message
      message.content = content;
      message.attachments = attachments || message.attachments;
      message.metadata = { ...message.metadata, ...metadata };
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save();

      // Update cache
      await this.cacheMessage(message.chatId, message);

      logger.info(`Message ${messageId} updated by user ${userId}`);

      return message;
    } catch (error) {
      logger.error('Update message error:', error);
      throw error;
    }
  }

  // Add participant to group chat
  async addParticipantToGroup(chatId, userId, addedBy) {
    try {
      const chat = await Chat.findById(chatId).populate('groupId');
      if (!chat || chat.type !== 'group') {
        throw new Error('Chat not found or not a group chat');
      }

      // Check if user has permission
      const group = chat.groupId;
      const member = group.members.find(m => m.userId.toString() === addedBy);
      
      if (!member || (member.role !== 'admin' && member.role !== 'moderator')) {
        throw new Error('Insufficient permissions');
      }

      // Check if user is already participant
      if (chat.participants.includes(userId)) {
        throw new Error('User is already a participant');
      }

      // Add to chat participants
      chat.participants.push(userId);
      await chat.save();

      // Add to group members
      group.members.push({
        userId,
        role: 'member',
        joinedAt: new Date(),
        addedBy
      });
      await group.save();

      // Update user chat mappings
      this.addUserToChat(userId, chatId);

      // Send system message
      await this.sendSystemMessage(chatId, `User added to group by ${addedBy}`);

      logger.info(`User ${userId} added to group chat ${chatId} by ${addedBy}`);

      return { chat, group };
    } catch (error) {
      logger.error('Add participant to group error:', error);
      throw error;
    }
  }

  // Remove participant from group chat
  async removeParticipantFromGroup(chatId, userId, removedBy) {
    try {
      const chat = await Chat.findById(chatId).populate('groupId');
      if (!chat || chat.type !== 'group') {
        throw new Error('Chat not found or not a group chat');
      }

      // Check if user has permission
      const group = chat.groupId;
      const member = group.members.find(m => m.userId.toString() === removedBy);
      
      if (!member || (member.role !== 'admin' && member.role !== 'moderator')) {
        throw new Error('Insufficient permissions');
      }

      // Check if trying to remove admin
      const targetMember = group.members.find(m => m.userId.toString() === userId);
      if (targetMember && targetMember.role === 'admin') {
        throw new Error('Cannot remove admin from group');
      }

      // Remove from chat participants
      chat.participants = chat.participants.filter(p => p.toString() !== userId);
      await chat.save();

      // Remove from group members
      group.members = group.members.filter(m => m.userId.toString() !== userId);
      await group.save();

      // Update user chat mappings
      this.removeUserFromChat(userId, chatId);

      // Send system message
      await this.sendSystemMessage(chatId, `User removed from group by ${removedBy}`);

      logger.info(`User ${userId} removed from group chat ${chatId} by ${removedBy}`);

      return { chat, group };
    } catch (error) {
      logger.error('Remove participant from group error:', error);
      throw error;
    }
  }

  // Send system message
  async sendSystemMessage(chatId, content, metadata = {}) {
    try {
      const message = new Message({
        chatId,
        senderId: null, // System message
        content,
        messageType: 'system',
        metadata: {
          ...metadata,
          isSystem: true
        }
      });

      await message.save();

      // Update chat
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: message._id,
        lastMessageAt: new Date(),
        messageCount: { $inc: 1 }
      });

      return message;
    } catch (error) {
      logger.error('Send system message error:', error);
      throw error;
    }
  }

  // Cache message in Redis
  async cacheMessage(chatId, message) {
    try {
      const key = `chat:${chatId}:messages`;
      await redisManager.getClient().lpush(key, JSON.stringify(message));
      
      // Keep only last 100 messages in cache
      await redisManager.getClient().ltrim(key, 0, 99);
      
      // Set expiry (24 hours)
      await redisManager.getClient().expire(key, 86400);
    } catch (error) {
      logger.error('Cache message error:', error);
    }
  }

  // Remove cached message
  async removeCachedMessage(chatId, messageId) {
    try {
      const key = `chat:${chatId}:messages`;
      const messages = await redisManager.getClient().lrange(key, 0, -1);
      
      const filteredMessages = messages.filter(msg => {
        const message = JSON.parse(msg);
        return message._id !== messageId;
      });

      await redisManager.getClient().del(key);
      if (filteredMessages.length > 0) {
        await redisManager.getClient().lpush(key, ...filteredMessages);
        await redisManager.getClient().expire(key, 86400);
      }
    } catch (error) {
      logger.error('Remove cached message error:', error);
    }
  }

  // Update active chat
  updateActiveChat(chatId, message) {
    if (!this.activeChats.has(chatId)) {
      this.activeChats.set(chatId, {
        chatId,
        lastMessage: message,
        lastActivity: new Date(),
        participantCount: 0
      });
    } else {
      const chat = this.activeChats.get(chatId);
      chat.lastMessage = message;
      chat.lastActivity = new Date();
      this.activeChats.set(chatId, chat);
    }
  }

  // Add user to chat mapping
  addUserToChat(userId, chatId) {
    if (!this.userChats.has(userId)) {
      this.userChats.set(userId, []);
    }
    
    const userChats = this.userChats.get(userId);
    if (!userChats.includes(chatId)) {
      userChats.push(chatId);
      this.userChats.set(userId, userChats);
    }
  }

  // Remove user from chat mapping
  removeUserFromChat(userId, chatId) {
    if (this.userChats.has(userId)) {
      const userChats = this.userChats.get(userId);
      const filteredChats = userChats.filter(id => id.toString() !== chatId.toString());
      this.userChats.set(userId, filteredChats);
    }
  }

  // Get active chats
  getActiveChats() {
    return Array.from(this.activeChats.values());
  }

  // Get user chat count
  getUserChatCount(userId) {
    return this.userChats.get(userId)?.length || 0;
  }

  // Cleanup inactive chats
  async cleanupInactiveChats() {
    try {
      const inactiveThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

      const inactiveChats = await Chat.find({
        lastMessageAt: { $lt: inactiveThreshold },
        isActive: true
      });

      for (const chat of inactiveChats) {
        chat.isActive = false;
        chat.deactivatedAt = new Date();
        await chat.save();

        // Remove from active chats
        this.activeChats.delete(chat._id.toString());

        // Remove from user mappings
        chat.participants.forEach(userId => {
          this.removeUserFromChat(userId, chat._id);
        });

        logger.info(`Chat ${chat._id} deactivated due to inactivity`);
      }
    } catch (error) {
      logger.error('Cleanup inactive chats error:', error);
    }
  }
}

module.exports = ChatService;