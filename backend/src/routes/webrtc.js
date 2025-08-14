const express = require('express');
const router = express.Router();
const WebRTCController = require('../controllers/WebRTCController');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimit');

// Call Management Routes
router.post('/calls/initiate',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  validateRequest(['recipientId', 'callType']),
  WebRTCController.initiateCall
);

router.post('/calls/:callId/answer',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  validateRequest(['accepted']),
  WebRTCController.answerCall
);

router.post('/calls/:callId/reject',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  validateRequest(['reason']),
  WebRTCController.rejectCall
);

router.post('/calls/:callId/end',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  validateRequest(['reason']),
  WebRTCController.endCall
);

router.get('/calls/:callId',
  authenticateToken,
  rateLimit('webrtc', 60, 60000), // 60 requests per minute
  WebRTCController.getCall
);

router.get('/calls/active',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getActiveCalls
);

router.get('/calls/history',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  WebRTCController.getCallHistory
);

// WebRTC Signaling Routes
router.post('/calls/:callId/offer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  validateRequest(['offer']),
  WebRTCController.setCallOffer
);

router.get('/calls/:callId/offer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  WebRTCController.getCallOffer
);

router.post('/calls/:callId/answer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  validateRequest(['answer']),
  WebRTCController.setCallAnswer
);

router.get('/calls/:callId/answer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  WebRTCController.getCallAnswer
);

router.post('/calls/:callId/ice-candidate',
  authenticateToken,
  rateLimit('webrtc', 100, 60000), // 100 requests per minute
  validateRequest(['candidate']),
  WebRTCController.addIceCandidate
);

router.get('/calls/:callId/ice-candidates',
  authenticateToken,
  rateLimit('webrtc', 100, 60000), // 100 requests per minute
  WebRTCController.getIceCandidates
);

// Screen Sharing Routes
router.post('/screen-share/start',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  validateRequest(['recipientId', 'isVideo']),
  WebRTCController.startScreenShare
);

router.post('/screen-share/stop',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  WebRTCController.stopScreenShare
);

router.post('/screen-share/:sessionId/offer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  validateRequest(['offer']),
  WebRTCController.setScreenShareOffer
);

router.get('/screen-share/:sessionId/offer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  WebRTCController.getScreenShareOffer
);

router.post('/screen-share/:sessionId/answer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  validateRequest(['answer']),
  WebRTCController.setScreenShareAnswer
);

router.get('/screen-share/:sessionId/answer',
  authenticateToken,
  rateLimit('webrtc', 50, 60000), // 50 requests per minute
  WebRTCController.getScreenShareAnswer
);

router.post('/screen-share/:sessionId/ice-candidate',
  authenticateToken,
  rateLimit('webrtc', 100, 60000), // 100 requests per minute
  validateRequest(['candidate']),
  WebRTCController.addScreenShareIceCandidate
);

router.get('/screen-share/:sessionId/ice-candidates',
  authenticateToken,
  rateLimit('webrtc', 100, 60000), // 100 requests per minute
  WebRTCController.getScreenShareIceCandidates
);

router.get('/screen-share/active',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getActiveScreenShares
);

// Recording Routes
router.post('/recording/start',
  authenticateToken,
  rateLimit('webrtc', 5, 60000), // 5 requests per minute
  validateRequest(['type']),
  WebRTCController.startRecording
);

router.post('/recording/stop',
  authenticateToken,
  rateLimit('webrtc', 5, 60000), // 5 requests per minute
  WebRTCController.stopRecording
);

router.post('/recording/pause',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  WebRTCController.pauseRecording
);

router.post('/recording/resume',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  WebRTCController.resumeRecording
);

router.get('/recording/:recordingId',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getRecording
);

router.get('/recording/list',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  WebRTCController.getRecordings
);

router.delete('/recording/:recordingId',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  WebRTCController.deleteRecording
);

router.post('/recording/:recordingId/share',
  authenticateToken,
  rateLimit('webrtc', 10, 60000), // 10 requests per minute
  validateRequest(['recipientIds']),
  WebRTCController.shareRecording
);

// Call Quality and Statistics
router.post('/calls/:callId/quality',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  validateRequest(['metrics']),
  WebRTCController.reportCallQuality
);

router.get('/calls/:callId/quality',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getCallQuality
);

router.get('/calls/:callId/statistics',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getCallStatistics
);

// Call Settings and Preferences
router.get('/settings',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getCallSettings
);

router.put('/settings',
  authenticateToken,
  rateLimit('webrtc', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['settings']),
  WebRTCController.updateCallSettings
);

router.get('/preferences',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getCallPreferences
);

router.put('/preferences',
  authenticateToken,
  rateLimit('webrtc', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['preferences']),
  WebRTCController.updateCallPreferences
);

// Call Recording Settings
router.get('/recording/settings',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getRecordingSettings
);

router.put('/recording/settings',
  authenticateToken,
  rateLimit('webrtc', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['settings']),
  WebRTCController.updateRecordingSettings
);

// Call Permissions and Access Control
router.get('/permissions',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getCallPermissions
);

router.post('/permissions/request',
  authenticateToken,
  rateLimit('webrtc', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['permission', 'reason']),
  WebRTCController.requestCallPermission
);

router.put('/permissions/:permissionId',
  authenticateToken,
  rateLimit('webrtc', 10, 300000), // 10 requests per 5 minutes
  validateRequest(['status', 'reason']),
  WebRTCController.updateCallPermission
);

// Call Analytics and Reporting
router.get('/analytics/overview',
  authenticateToken,
  rateLimit('webrtc', 20, 300000), // 20 requests per 5 minutes
  WebRTCController.getCallAnalyticsOverview
);

router.get('/analytics/calls',
  authenticateToken,
  rateLimit('webrtc', 20, 300000), // 20 requests per 5 minutes
  WebRTCController.getCallAnalytics
);

router.get('/analytics/quality',
  authenticateToken,
  rateLimit('webrtc', 20, 300000), // 20 requests per 5 minutes
  WebRTCController.getQualityAnalytics
);

router.get('/analytics/recordings',
  authenticateToken,
  rateLimit('webrtc', 20, 300000), // 20 requests per 5 minutes
  WebRTCController.getRecordingAnalytics
);

// Call Troubleshooting and Support
router.post('/troubleshoot',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  validateRequest(['issue', 'description']),
  WebRTCController.reportCallIssue
);

router.get('/troubleshoot/status/:issueId',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getTroubleshootStatus
);

router.post('/support/request',
  authenticateToken,
  rateLimit('webrtc', 3, 600000), // 3 requests per 10 minutes
  validateRequest(['type', 'description']),
  WebRTCController.requestSupport
);

// Call Integration and Webhooks
router.post('/webhooks/register',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  validateRequest(['url', 'events']),
  WebRTCController.registerWebhook
);

router.get('/webhooks',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  WebRTCController.getWebhooks
);

router.delete('/webhooks/:webhookId',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  WebRTCController.deleteWebhook
);

router.post('/webhooks/:webhookId/test',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  WebRTCController.testWebhook
);

// Call Backup and Recovery
router.post('/backup/create',
  authenticateToken,
  rateLimit('webrtc', 2, 900000), // 2 requests per 15 minutes
  validateRequest(['type', 'data']),
  WebRTCController.createCallBackup
);

router.get('/backup/list',
  authenticateToken,
  rateLimit('webrtc', 20, 60000), // 20 requests per minute
  WebRTCController.getCallBackups
);

router.get('/backup/:backupId',
  authenticateToken,
  rateLimit('webrtc', 10, 300000), // 10 requests per 5 minutes
  WebRTCController.getCallBackup
);

router.post('/backup/:backupId/restore',
  authenticateToken,
  rateLimit('webrtc', 2, 900000), // 2 requests per 15 minutes
  WebRTCController.restoreCallBackup
);

router.delete('/backup/:backupId',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  WebRTCController.deleteCallBackup
);

// Call Health and Monitoring
router.get('/health/status',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getHealthStatus
);

router.get('/health/metrics',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getHealthMetrics
);

router.get('/health/logs',
  authenticateToken,
  rateLimit('webrtc', 20, 300000), // 20 requests per 5 minutes
  WebRTCController.getHealthLogs
);

// Call Configuration and Environment
router.get('/config',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getWebRTCConfig
);

router.get('/config/ice-servers',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getIceServers
);

router.get('/config/capabilities',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getCapabilities
);

// Call Testing and Diagnostics
router.post('/test/connection',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  WebRTCController.testConnection
);

router.post('/test/quality',
  authenticateToken,
  rateLimit('webrtc', 5, 300000), // 5 requests per 5 minutes
  WebRTCController.testQuality
);

router.get('/test/results/:testId',
  authenticateToken,
  rateLimit('webrtc', 30, 60000), // 30 requests per minute
  WebRTCController.getTestResults
);

// Call Export and Data Management
router.get('/export/calls',
  authenticateToken,
  rateLimit('webrtc', 3, 600000), // 3 requests per 10 minutes
  WebRTCController.exportCalls
);

router.get('/export/recordings',
  authenticateToken,
  rateLimit('webrtc', 3, 600000), // 3 requests per 10 minutes
  WebRTCController.exportRecordings
);

router.get('/export/analytics',
  authenticateToken,
  rateLimit('webrtc', 3, 600000), // 3 requests per 10 minutes
  WebRTCController.exportAnalytics
);

module.exports = router;