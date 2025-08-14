const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const userRoutes = require('./user');
const chatRoutes = require('./chat');
const messageRoutes = require('./message');
const callRoutes = require('./call');
const storyRoutes = require('./story');
const groupRoutes = require('./group');
const discoveryRoutes = require('./discovery');
const adminRoutes = require('./admin');
const analyticsRoutes = require('./analytics');
const featureRoutes = require('./features');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0'
  });
});

// API version info
router.get('/version', (req, res) => {
  res.json({
    version: process.env.APP_VERSION || '1.0.0',
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
    commitHash: process.env.COMMIT_HASH || 'unknown'
  });
});

// API documentation
router.get('/docs', (req, res) => {
  res.json({
    message: 'NearChat API Documentation',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth/*',
      users: '/api/users/*',
      chats: '/api/chats/*',
      messages: '/api/messages/*',
      calls: '/api/calls/*',
      stories: '/api/stories/*',
      groups: '/api/groups/*',
      discovery: '/api/discovery/*',
      admin: '/api/admin/*',
      analytics: '/api/analytics/*',
      features: '/api/features/*'
    },
    websocket: {
      endpoint: '/socket.io/',
      events: [
        'auth:authenticate',
        'message:send',
        'call:initiate',
        'location:update',
        'story:create'
      ]
    }
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/chats', chatRoutes);
router.use('/messages', messageRoutes);
router.use('/calls', callRoutes);
router.use('/stories', storyRoutes);
router.use('/groups', groupRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/admin', adminRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/features', featureRoutes);

// 404 handler for undefined routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      '/api/health',
      '/api/version',
      '/api/docs',
      '/api/auth/*',
      '/api/users/*',
      '/api/chats/*',
      '/api/messages/*',
      '/api/calls/*',
      '/api/stories/*',
      '/api/groups/*',
      '/api/discovery/*',
      '/api/admin/*',
      '/api/analytics/*',
      '/api/features/*'
    ]
  });
});

module.exports = router;