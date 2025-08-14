const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const userRoutes = require('./user');
const chatRoutes = require('./chat');
const messageRoutes = require('./message');
const callRoutes = require('./call');
const discoveryRoutes = require('./discovery');
const groupRoutes = require('./group');
const storyRoutes = require('./story');
const adminRoutes = require('./admin');
const analyticsRoutes = require('./analytics');

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API version info
router.get('/version', (req, res) => {
  res.json({
    version: process.env.APP_VERSION || '1.0.0',
    apiVersion: 'v1',
    buildDate: process.env.BUILD_DATE || new Date().toISOString()
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/chats', chatRoutes);
router.use('/messages', messageRoutes);
router.use('/calls', callRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/groups', groupRoutes);
router.use('/stories', storyRoutes);
router.use('/admin', adminRoutes);
router.use('/analytics', analyticsRoutes);

// 404 handler for undefined routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

module.exports = router;