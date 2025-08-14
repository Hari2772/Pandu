const express = require('express');
const router = express.Router();
const ChatService = require('../services/ChatService');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { validateChatData, validateMessageData } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const chatService = new ChatService();

// Apply rate limiting to all chat routes
router.use(rateLimiter('chat', 100, 60)); // 100 requests per minute

// Get user's chats
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;

    const chats = await chatService.getUserChats(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type
    });

    res.json({
      success: true,
      data: {
        chats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: chats.length
        }
      }
    });

  } catch (error) {
    logger.error('Get user chats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create or get direct chat
router.post('/direct', authenticateToken, validateChatData, async (req, res) => {
  try {
    const userId = req.user.id;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'Target user ID is required'
      });
    }

    if (userId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create chat with yourself'
      });
    }

    const chat = await chatService.getOrCreateDirectChat(userId, targetUserId);

    res.json({
      success: true,
      message: 'Direct chat created/retrieved successfully',
      data: { chat }
    });

  } catch (error) {
    logger.error('Create direct chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create direct chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Create group chat
router.post('/group', authenticateToken, validateChatData, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description, participants, isPrivate = false, avatar } = req.body;

    if (!name || !participants || participants.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Group name and at least one participant are required'
      });
    }

    // Add creator to participants if not already included
    if (!participants.includes(userId)) {
      participants.push(userId);
    }

    const result = await chatService.createGroupChat(userId, {
      name,
      description,
      participants,
      isPrivate,
      avatar
    });

    res.status(201).json({
      success: true,
      message: 'Group chat created successfully',
      data: result
    });

  } catch (error) {
    logger.error('Create group chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat by ID
router.get('/:chatId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const chat = await chatService.getChatById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Check if user is participant
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this chat'
      });
    }

    res.json({
      success: true,
      data: { chat }
    });

  } catch (error) {
    logger.error('Get chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat messages
router.get('/:chatId/messages', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { page = 1, limit = 50, before, after, messageType } = req.query;

    const messages = await chatService.getChatMessages(chatId, userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      before,
      after,
      messageType
    });

    res.json({
      success: true,
      data: {
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get chat messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Send message
router.post('/:chatId/messages', authenticateToken, validateMessageData, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { content, messageType = 'text', replyTo, attachments } = req.body;

    const message = await chatService.sendMessage(chatId, userId, {
      content,
      messageType,
      replyTo,
      attachments
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: { message }
    });

  } catch (error) {
    logger.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update message
router.put('/:chatId/messages/:messageId', authenticateToken, validateMessageData, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, messageId } = req.params;
    const { content, attachments, metadata } = req.body;

    const message = await chatService.updateMessage(messageId, userId, {
      content,
      attachments,
      metadata
    });

    res.json({
      success: true,
      message: 'Message updated successfully',
      data: { message }
    });

  } catch (error) {
    logger.error('Update message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete message
router.delete('/:chatId/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const message = await chatService.deleteMessage(messageId, userId);

    res.json({
      success: true,
      message: 'Message deleted successfully',
      data: { message }
    });

  } catch (error) {
    logger.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Mark messages as read
router.post('/:chatId/read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { messageIds } = req.body;

    if (!messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({
        success: false,
        message: 'Message IDs array is required'
      });
    }

    await chatService.markMessagesAsRead(chatId, userId, messageIds);

    res.json({
      success: true,
      message: 'Messages marked as read successfully'
    });

  } catch (error) {
    logger.error('Mark messages as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search messages
router.get('/:chatId/search', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { query, page = 1, limit = 20, messageType, startDate, endDate } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const messages = await chatService.searchMessages(userId, query, {
      chatId,
      page: parseInt(page),
      limit: parseInt(limit),
      messageType,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null
    });

    res.json({
      success: true,
      data: {
        messages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Search messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Add participant to group chat
router.post('/:chatId/participants', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;
    const { participantId } = req.body;

    if (!participantId) {
      return res.status(400).json({
        success: false,
        message: 'Participant ID is required'
      });
    }

    const result = await chatService.addParticipantToGroup(chatId, participantId, userId);

    res.json({
      success: true,
      message: 'Participant added successfully',
      data: result
    });

  } catch (error) {
    logger.error('Add participant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add participant',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Remove participant from group chat
router.delete('/:chatId/participants/:participantId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId, participantId } = req.params;

    const result = await chatService.removeParticipantFromGroup(chatId, participantId, userId);

    res.json({
      success: true,
      message: 'Participant removed successfully',
      data: result
    });

  } catch (error) {
    logger.error('Remove participant error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove participant',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat statistics
router.get('/:chatId/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    const stats = await chatService.getChatStats(chatId, userId);

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    logger.error('Get chat stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get chat statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Archive chat
router.post('/:chatId/archive', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    await chatService.archiveChat(chatId, userId);

    res.json({
      success: true,
      message: 'Chat archived successfully'
    });

  } catch (error) {
    logger.error('Archive chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Unarchive chat
router.post('/:chatId/unarchive', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    await chatService.unarchiveChat(chatId, userId);

    res.json({
      success: true,
      message: 'Chat unarchived successfully'
    });

  } catch (error) {
    logger.error('Unarchive chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unarchive chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Leave group chat
router.post('/:chatId/leave', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { chatId } = req.params;

    await chatService.leaveGroupChat(chatId, userId);

    res.json({
      success: true,
      message: 'Left group chat successfully'
    });

  } catch (error) {
    logger.error('Leave group chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave group chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;