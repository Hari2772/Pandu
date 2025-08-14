const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/ChatController');
const { authenticateToken } = require('../middleware/auth');
const { validateMessage, validateChatAccess } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// Apply authentication middleware to all chat routes
router.use(authenticateToken);

// Apply rate limiting to message sending
router.use('/send', rateLimiter('message', 10, 60000)); // 10 messages per minute

// Chat management routes
router.post('/create', validateChatAccess, ChatController.createOrGetChat);
router.get('/list', ChatController.getUserChats);
router.get('/:chatId/stats', ChatController.getChatStats);

// Message routes
router.get('/:chatId/messages', ChatController.getChatMessages);
router.post('/:chatId/messages', validateMessage, ChatController.sendMessage);
router.delete('/messages/:messageId', ChatController.deleteMessage);
router.post('/:chatId/messages/read', ChatController.markMessagesAsRead);

// Search routes
router.get('/search/messages', ChatController.searchMessages);

module.exports = router;