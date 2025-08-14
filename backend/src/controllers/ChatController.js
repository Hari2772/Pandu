const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Analytics = require('../models/Analytics');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

class ChatController {
  // Create or get existing chat between two users
  async createOrGetChat(req, res) {
    try {
      const { participantId } = req.body;
      const userId = req.user.id;

      if (!participantId) {
        return res.status(400).json({
          success: false,
          message: 'Participant ID is required'
        });
      }

      if (participantId === userId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create chat with yourself'
        });
      }

      // Check if chat already exists
      let chat = await Chat.findOne({
        type: 'direct',
        participants: {
          $all: [
            { userId: userId },
            { userId: participantId }
          ]
        }
      }).populate('participants.userId', 'username displayName profilePicture isOnline lastSeen');

      if (!chat) {
        // Create new chat
        chat = new Chat({
          type: 'direct',
          participants: [
            { userId: userId, role: 'member', status: 'active' },
            { userId: participantId, role: 'member', status: 'active' }
          ],
          createdBy: userId
        });

        await chat.save();
        await chat.populate('participants.userId', 'username displayName profilePicture isOnline lastSeen');
      }

      // Track analytics
      await Analytics.create({
        eventType: 'chat_created',
        eventName: 'Chat Created/Accessed',
        eventCategory: 'communication',
        userId: userId,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          chatId: chat._id,
          chatType: chat.type,
          participantId
        }
      });

      res.json({
        success: true,
        data: {
          chat: {
            id: chat._id,
            type: chat.type,
            participants: chat.participants.map(p => ({
              userId: p.userId._id,
              username: p.userId.username,
              displayName: p.userId.displayName,
              profilePicture: p.userId.profilePicture,
              isOnline: p.userId.isOnline,
              lastSeen: p.userId.lastSeen,
              role: p.role,
              status: p.status
            })),
            lastMessage: chat.lastMessage,
            lastMessageAt: chat.lastMessageAt,
            unreadCount: chat.unreadCount,
            createdAt: chat.createdAt
          }
        }
      });

    } catch (error) {
      logger.error('Create or get chat error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get user's chats
  async getUserChats(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, type } = req.query;

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
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const totalChats = await Chat.countDocuments(query);

      // Format chat data
      const formattedChats = chats.map(chat => {
        const otherParticipant = chat.participants.find(p => 
          p.userId._id.toString() !== userId
        );

        return {
          id: chat._id,
          type: chat.type,
          otherParticipant: otherParticipant ? {
            userId: otherParticipant.userId._id,
            username: otherParticipant.userId.username,
            displayName: otherParticipant.userId.displayName,
            profilePicture: otherParticipant.userId.profilePicture,
            isOnline: otherParticipant.userId.isOnline,
            lastSeen: otherParticipant.userId.lastSeen
          } : null,
          lastMessage: chat.lastMessage ? {
            id: chat.lastMessage._id,
            content: chat.lastMessage.content,
            messageType: chat.lastMessage.messageType,
            senderId: chat.lastMessage.senderId,
            timestamp: chat.lastMessage.timestamp
          } : null,
          lastMessageAt: chat.lastMessageAt,
          unreadCount: chat.unreadCount,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt
        };
      });

      res.json({
        success: true,
        data: {
          chats: formattedChats,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalChats,
            pages: Math.ceil(totalChats / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Get user chats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get chat messages
  async getChatMessages(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 50, before } = req.query;

      // Verify user has access to this chat
      const chat = await Chat.findOne({
        _id: chatId,
        'participants.userId': userId,
        'participants.status': 'active'
      });

      if (!chat) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this chat'
        });
      }

      // Build query
      let query = { chatId };
      if (before) {
        query.timestamp = { $lt: new Date(before) };
      }

      const messages = await Message.find(query)
        .populate('senderId', 'username displayName profilePicture')
        .populate('replyTo')
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const totalMessages = await Message.countDocuments({ chatId });

      // Mark messages as read
      await this.markMessagesAsRead(chatId, userId, messages.map(m => m._id));

      // Format messages
      const formattedMessages = messages.map(message => ({
        id: message._id,
        content: message.content,
        messageType: message.messageType,
        sender: {
          id: message.senderId._id,
          username: message.senderId.username,
          displayName: message.senderId.displayName,
          profilePicture: message.senderId.profilePicture
        },
        replyTo: message.replyTo ? {
          id: message.replyTo._id,
          content: message.replyTo.content,
          messageType: message.replyTo.messageType,
          sender: {
            id: message.replyTo.senderId,
            username: message.replyTo.senderId.username,
            displayName: message.replyTo.senderId.displayName
          }
        } : null,
        attachments: message.attachments,
        timestamp: message.timestamp,
        isRead: message.readBy.includes(userId),
        readAt: message.readBy.find(r => r.userId === userId)?.readAt
      }));

      res.json({
        success: true,
        data: {
          messages: formattedMessages.reverse(), // Reverse to get chronological order
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalMessages,
            pages: Math.ceil(totalMessages / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Get chat messages error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Send message
  async sendMessage(req, res) {
    try {
      const { chatId, content, messageType = 'text', replyTo, attachments } = req.body;
      const senderId = req.user.id;

      if (!content || !chatId) {
        return res.status(400).json({
          success: false,
          message: 'Chat ID and content are required'
        });
      }

      // Verify user has access to this chat
      const chat = await Chat.findOne({
        _id: chatId,
        'participants.userId': senderId,
        'participants.status': 'active'
      });

      if (!chat) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this chat'
        });
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
      await message.populate('senderId', 'username displayName profilePicture');

      // Update chat
      chat.lastMessage = message._id;
      chat.lastMessageAt = new Date();
      chat.unreadCount = chat.participants.reduce((total, p) => {
        return p.userId.equals(senderId) ? total : total + 1;
      }, 0);
      await chat.save();

      // Track analytics
      await Analytics.create({
        eventType: 'message_sent',
        eventName: 'Message Sent',
        eventCategory: 'communication',
        userId: senderId,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          chatId,
          messageType,
          hasAttachments: attachments && attachments.length > 0,
          isReply: !!replyTo
        }
      });

      // Format message for response
      const formattedMessage = {
        id: message._id,
        content: message.content,
        messageType: message.messageType,
        sender: {
          id: message.senderId._id,
          username: message.senderId.username,
          displayName: message.senderId.displayName,
          profilePicture: message.senderId.profilePicture
        },
        replyTo: message.replyTo,
        attachments: message.attachments,
        timestamp: message.timestamp,
        isRead: false
      };

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: {
          message: formattedMessage
        }
      });

    } catch (error) {
      logger.error('Send message error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Delete message
  async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;

      const message = await Message.findById(messageId);
      if (!message) {
        return res.status(404).json({
          success: false,
          message: 'Message not found'
        });
      }

      // Check if user can delete this message
      if (!message.senderId.equals(userId)) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own messages'
        });
      }

      // Soft delete message
      message.isDeleted = true;
      message.deletedAt = new Date();
      await message.save();

      // Track analytics
      await Analytics.create({
        eventType: 'message_deleted',
        eventName: 'Message Deleted',
        eventCategory: 'communication',
        userId: userId,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          messageId,
          chatId: message.chatId
        }
      });

      res.json({
        success: true,
        message: 'Message deleted successfully'
      });

    } catch (error) {
      logger.error('Delete message error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Mark messages as read
  async markMessagesAsRead(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.id;
      const { messageIds } = req.body;

      if (!messageIds || !Array.isArray(messageIds)) {
        return res.status(400).json({
          success: false,
          message: 'Message IDs array is required'
        });
      }

      // Verify user has access to this chat
      const chat = await Chat.findOne({
        _id: chatId,
        'participants.userId': userId,
        'participants.status': 'active'
      });

      if (!chat) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this chat'
        });
      }

      // Mark messages as read
      await Message.updateMany(
        {
          _id: { $in: messageIds },
          chatId,
          senderId: { $ne: userId }
        },
        {
          $addToSet: {
            readBy: {
              userId: userId,
              readAt: new Date()
            }
          }
        }
      );

      // Update chat unread count
      const unreadCount = await Message.countDocuments({
        chatId,
        senderId: { $ne: userId },
        'readBy.userId': { $ne: userId }
      });

      chat.unreadCount = unreadCount;
      await chat.save();

      // Track analytics
      await Analytics.create({
        eventType: 'message_read',
        eventName: 'Messages Marked as Read',
        eventCategory: 'communication',
        userId: userId,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          chatId,
          messageCount: messageIds.length
        }
      });

      res.json({
        success: true,
        message: 'Messages marked as read',
        data: {
          unreadCount
        }
      });

    } catch (error) {
      logger.error('Mark messages as read error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Search messages
  async searchMessages(req, res) {
    try {
      const { query, chatId, page = 1, limit = 20 } = req.query;
      const userId = req.user.id;

      if (!query) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
      }

      let searchQuery = {
        content: { $regex: query, $options: 'i' },
        isDeleted: false
      };

      if (chatId) {
        // Verify user has access to this chat
        const chat = await Chat.findOne({
          _id: chatId,
          'participants.userId': userId,
          'participants.status': 'active'
        });

        if (!chat) {
          return res.status(403).json({
            success: false,
            message: 'Access denied to this chat'
          });
        }
        searchQuery.chatId = chatId;
      } else {
        // Search in all user's chats
        const userChats = await Chat.find({
          'participants.userId': userId,
          'participants.status': 'active'
        }).select('_id');
        
        searchQuery.chatId = { $in: userChats.map(c => c._id) };
      }

      const messages = await Message.find(searchQuery)
        .populate('senderId', 'username displayName profilePicture')
        .populate('chatId', 'type')
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const totalMessages = await Message.countDocuments(searchQuery);

      // Format messages
      const formattedMessages = messages.map(message => ({
        id: message._id,
        content: message.content,
        messageType: message.messageType,
        sender: {
          id: message.senderId._id,
          username: message.senderId.username,
          displayName: message.senderId.displayName,
          profilePicture: message.senderId.profilePicture
        },
        chatId: message.chatId._id,
        chatType: message.chatId.type,
        timestamp: message.timestamp
      }));

      res.json({
        success: true,
        data: {
          messages: formattedMessages,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalMessages,
            pages: Math.ceil(totalMessages / limit)
          }
        }
      });

    } catch (error) {
      logger.error('Search messages error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get chat statistics
  async getChatStats(req, res) {
    try {
      const { chatId } = req.params;
      const userId = req.user.id;

      // Verify user has access to this chat
      const chat = await Chat.findOne({
        _id: chatId,
        'participants.userId': userId,
        'participants.status': 'active'
      });

      if (!chat) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this chat'
        });
      }

      // Get message statistics
      const messageStats = await Message.aggregate([
        { $match: { chatId: chat._id, isDeleted: false } },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: 1 },
            textMessages: { $sum: { $cond: [{ $eq: ['$messageType', 'text'] }, 1, 0] } },
            mediaMessages: { $sum: { $cond: [{ $ne: ['$messageType', 'text'] }, 1, 0] } },
            totalAttachments: { $sum: { $size: { $ifNull: ['$attachments', []] } } }
          }
        }
      ]);

      // Get participant statistics
      const participantStats = await User.aggregate([
        { $match: { _id: { $in: chat.participants.map(p => p.userId) } } },
        {
          $group: {
            _id: null,
            totalParticipants: { $sum: 1 },
            onlineParticipants: { $sum: { $cond: ['$isOnline', 1, 0] } },
            activeParticipants: { $sum: { $cond: [{ $gte: ['$lastActiveDate', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] }, 1, 0] } }
          }
        }
      ]);

      const stats = {
        chatId: chat._id,
        chatType: chat.type,
        createdAt: chat.createdAt,
        lastMessageAt: chat.lastMessageAt,
        unreadCount: chat.unreadCount,
        messageStats: messageStats[0] || {
          totalMessages: 0,
          textMessages: 0,
          mediaMessages: 0,
          totalAttachments: 0
        },
        participantStats: participantStats[0] || {
          totalParticipants: 0,
          onlineParticipants: 0,
          activeParticipants: 0
        }
      };

      res.json({
        success: true,
        data: { stats }
      });

    } catch (error) {
      logger.error('Get chat stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Helper method to mark messages as read
  async markMessagesAsRead(chatId, userId, messageIds) {
    try {
      await Message.updateMany(
        {
          _id: { $in: messageIds },
          chatId,
          senderId: { $ne: userId },
          'readBy.userId': { $ne: userId }
        },
        {
          $addToSet: {
            readBy: {
              userId: userId,
              readAt: new Date()
            }
          }
        }
      );
    } catch (error) {
      logger.error('Mark messages as read helper error:', error);
    }
  }
}

module.exports = new ChatController();