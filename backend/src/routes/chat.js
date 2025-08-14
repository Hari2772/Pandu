const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/ChatController');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimit');
const { upload } = require('../middleware/upload');

// Chat Routes
router.post('/create', 
  authenticateToken, 
  rateLimit('chat', 10, 60000), // 10 requests per minute
  validateRequest(['participantIds']),
  ChatController.createChat
);

router.post('/group/create',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  validateRequest(['groupName', 'participantIds']),
  ChatController.createGroupChat
);

router.get('/list',
  authenticateToken,
  rateLimit('chat', 30, 60000), // 30 requests per minute
  ChatController.getChats
);

router.get('/:chatId',
  authenticateToken,
  rateLimit('chat', 60, 60000), // 60 requests per minute
  ChatController.getChat
);

router.get('/:chatId/messages',
  authenticateToken,
  rateLimit('chat', 100, 60000), // 100 requests per minute
  ChatController.getMessages
);

router.post('/:chatId/messages',
  authenticateToken,
  rateLimit('chat', 20, 60000), // 20 requests per minute
  upload.array('attachments', 5), // Max 5 attachments
  validateRequest(['content']),
  ChatController.sendMessage
);

router.put('/:chatId/messages/:messageId',
  authenticateToken,
  rateLimit('chat', 10, 60000), // 10 requests per minute
  validateRequest(['content']),
  ChatController.updateMessage
);

router.delete('/:chatId/messages/:messageId',
  authenticateToken,
  rateLimit('chat', 10, 60000), // 10 requests per minute
  ChatController.deleteMessage
);

router.post('/:chatId/messages/:messageId/read',
  authenticateToken,
  rateLimit('chat', 50, 60000), // 50 requests per minute
  ChatController.markMessageAsRead
);

router.post('/:chatId/participants',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['userId']),
  ChatController.addParticipant
);

router.delete('/:chatId/participants/:userId',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  ChatController.removeParticipant
);

router.put('/:chatId/participants/:userId/role',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['role']),
  ChatController.updateParticipantRole
);

router.post('/:chatId/typing',
  authenticateToken,
  rateLimit('chat', 30, 60000), // 30 requests per minute
  validateRequest(['isTyping']),
  ChatController.setTypingStatus
);

router.get('/:chatId/typing',
  authenticateToken,
  rateLimit('chat', 60, 60000), // 60 requests per minute
  ChatController.getTypingUsers
);

router.get('/:chatId/stats',
  authenticateToken,
  rateLimit('chat', 20, 300000), // 20 requests per 5 minutes
  ChatController.getChatStats
);

router.post('/:chatId/archive',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  ChatController.archiveChat
);

router.post('/:chatId/unarchive',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  ChatController.unarchiveChat
);

router.delete('/:chatId',
  authenticateToken,
  rateLimit('chat', 3, 600000), // 3 requests per 10 minutes
  ChatController.deleteChat
);

// Search Routes
router.get('/search/global',
  authenticateToken,
  rateLimit('chat', 20, 60000), // 20 requests per minute
  ChatController.searchGlobal
);

router.get('/search/messages',
  authenticateToken,
  rateLimit('chat', 30, 60000), // 30 requests per minute
  ChatController.searchMessages
);

// Group Chat Specific Routes
router.put('/group/:groupId/settings',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  ChatController.updateGroupSettings
);

router.post('/group/:groupId/invite',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['invitees']),
  ChatController.inviteToGroup
);

router.post('/group/:groupId/join',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  ChatController.joinGroup
);

router.post('/group/:groupId/leave',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  ChatController.leaveGroup
);

// Message Reactions
router.post('/:chatId/messages/:messageId/reactions',
  authenticateToken,
  rateLimit('chat', 20, 60000), // 20 requests per minute
  validateRequest(['reaction']),
  ChatController.addReaction
);

router.delete('/:chatId/messages/:messageId/reactions/:reaction',
  authenticateToken,
  rateLimit('chat', 20, 60000), // 20 requests per minute
  ChatController.removeReaction
);

// Message Threading
router.post('/:chatId/messages/:messageId/reply',
  authenticateToken,
  rateLimit('chat', 20, 60000), // 20 requests per minute
  validateRequest(['content']),
  ChatController.replyToMessage
);

router.get('/:chatId/messages/:messageId/replies',
  authenticateToken,
  rateLimit('chat', 50, 60000), // 50 requests per minute
  ChatController.getMessageReplies
);

// Chat Notifications
router.put('/:chatId/notifications',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['enabled']),
  ChatController.updateNotificationSettings
);

router.get('/:chatId/notifications',
  authenticateToken,
  rateLimit('chat', 30, 60000), // 30 requests per minute
  ChatController.getNotificationSettings
);

// Chat Media
router.get('/:chatId/media',
  authenticateToken,
  rateLimit('chat', 30, 60000), // 30 requests per minute
  ChatController.getChatMedia
);

router.get('/:chatId/media/:mediaType',
  authenticateToken,
  rateLimit('chat', 50, 60000), // 50 requests per minute
  ChatController.getChatMediaByType
);

// Chat Analytics
router.get('/:chatId/analytics',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  ChatController.getChatAnalytics
);

router.get('/:chatId/analytics/messages',
  authenticateToken,
  rateLimit('chat', 20, 300000), // 20 requests per 5 minutes
  ChatController.getMessageAnalytics
);

router.get('/:chatId/analytics/participants',
  authenticateToken,
  rateLimit('chat', 20, 300000), // 20 requests per 5 minutes
  ChatController.getParticipantAnalytics
);

// Bulk Operations
router.post('/bulk/read',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['chatIds']),
  ChatController.markMultipleChatsAsRead
);

router.post('/bulk/archive',
  authenticateToken,
  rateLimit('chat', 5, 600000), // 5 requests per 10 minutes
  validateRequest(['chatIds']),
  ChatController.archiveMultipleChats
);

// Chat Export
router.get('/:chatId/export',
  authenticateToken,
  rateLimit('chat', 3, 600000), // 3 requests per 10 minutes
  ChatController.exportChat
);

// Chat Backup
router.post('/:chatId/backup',
  authenticateToken,
  rateLimit('chat', 2, 900000), // 2 requests per 15 minutes
  ChatController.createChatBackup
);

router.get('/:chatId/backup/:backupId',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  ChatController.getChatBackup
);

// Chat Templates
router.get('/templates',
  authenticateToken,
  rateLimit('chat', 20, 60000), // 20 requests per minute
  ChatController.getChatTemplates
);

router.post('/templates',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  validateRequest(['name', 'template']),
  ChatController.createChatTemplate
);

router.put('/templates/:templateId',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  validateRequest(['name', 'template']),
  ChatController.updateChatTemplate
);

router.delete('/templates/:templateId',
  authenticateToken,
  rateLimit('chat', 5, 300000), // 5 requests per 5 minutes
  ChatController.deleteChatTemplate
);

// Chat Moderation
router.post('/:chatId/moderate',
  authenticateToken,
  rateLimit('chat', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['action', 'reason']),
  ChatController.moderateChat
);

router.get('/:chatId/moderation/logs',
  authenticateToken,
  rateLimit('chat', 20, 300000), // 20 requests per 5 minutes
  ChatController.getModerationLogs
);

// Chat Health Check
router.get('/health/status',
  authenticateToken,
  rateLimit('chat', 30, 60000), // 30 requests per minute
  ChatController.getHealthStatus
);

module.exports = router;