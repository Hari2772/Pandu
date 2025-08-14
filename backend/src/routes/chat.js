const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/ChatController');
const { authenticateToken } = require('../middleware/auth');
const { validateChatCreation, validateGroupChatCreation } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Get user chats
router.get('/',
  rateLimiter('chat_list', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  ChatController.getUserChats
);

// Create direct chat
router.post('/direct',
  rateLimiter('chat_create', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  validateChatCreation,
  ChatController.createDirectChat
);

// Create group chat
router.post('/group',
  rateLimiter('chat_create', 10, 15 * 60 * 1000), // 10 requests per 15 minutes
  validateGroupChatCreation,
  ChatController.createGroupChat
);

// Get chat by ID
router.get('/:chatId',
  rateLimiter('chat_get', 200, 15 * 60 * 1000), // 200 requests per 15 minutes
  ChatController.getChatById
);

// Update chat settings
router.put('/:chatId',
  rateLimiter('chat_update', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  ChatController.updateChat
);

// Delete chat
router.delete('/:chatId',
  rateLimiter('chat_delete', 5, 15 * 60 * 1000), // 5 requests per 15 minutes
  ChatController.deleteChat
);

// Add participant to group chat
router.post('/:chatId/participants',
  rateLimiter('chat_participants', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  ChatController.addParticipant
);

// Remove participant from group chat
router.delete('/:chatId/participants/:participantId',
  rateLimiter('chat_participants', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  ChatController.removeParticipant
);

// Get chat participants
router.get('/:chatId/participants',
  rateLimiter('chat_participants', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  ChatController.getChatParticipants
);

// Mark chat as read
router.post('/:chatId/read',
  rateLimiter('chat_read', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  ChatController.markChatAsRead
);

// Get chat statistics
router.get('/:chatId/stats',
  rateLimiter('chat_stats', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  ChatController.getChatStats
);

// Search messages in chat
router.get('/:chatId/search',
  rateLimiter('chat_search', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  ChatController.searchMessages
);

// Archive chat
router.post('/:chatId/archive',
  rateLimiter('chat_archive', 10, 15 * 60 * 1000), // 10 requests per 15 minutes
  ChatController.archiveChat
);

// Unarchive chat
router.post('/:chatId/unarchive',
  rateLimiter('chat_archive', 10, 15 * 60 * 1000), // 10 requests per 15 minutes
  ChatController.unarchiveChat
);

// Pin chat
router.post('/:chatId/pin',
  rateLimiter('chat_pin', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  ChatController.pinChat
);

// Unpin chat
router.post('/:chatId/unpin',
  rateLimiter('chat_pin', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  ChatController.unpinChat
);

// Get chat media
router.get('/:chatId/media',
  rateLimiter('chat_media', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  ChatController.getChatMedia
);

// Get chat links
router.get('/:chatId/links',
  rateLimiter('chat_links', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  ChatController.getChatLinks
);

module.exports = router;