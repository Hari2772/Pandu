const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

// Import services and middleware
const SocketService = require('./services/SocketService');
const WebRTCService = require('./services/WebRTCService');
const ChatService = require('./services/ChatService');
const FeatureFlagService = require('./services/FeatureFlagService');
const redisManager = require('./config/redis');
const logger = require('./utils/logger');
const constants = require('./utils/constants');

// Import routes
const userRoutes = require('./routes/user');
const chatRoutes = require('./routes/chat');
const webrtcRoutes = require('./routes/webrtc');
const featureRoutes = require('./routes/features');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const { securityMiddleware } = require('./middleware/security');

class NearChatServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.port = process.env.PORT || 3000;
    this.isProduction = process.env.NODE_ENV === 'production';
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeServices();
    this.initializeErrorHandling();
  }

  async initializeMiddleware() {
    try {
      // Security middleware
      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "ws:"],
            mediaSrc: ["'self'", "blob:"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
          }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
      }));

      // CORS configuration
      this.app.use(cors({
        origin: process.env.ALLOWED_ORIGINS ? 
          process.env.ALLOWED_ORIGINS.split(',') : 
          ['http://localhost:3000', 'http://localhost:3001'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
      }));

      // Rate limiting
      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: this.isProduction ? 100 : 1000, // Limit each IP to 100 requests per windowMs in production
        message: {
          error: 'Too many requests from this IP, please try again later.',
          retryAfter: 15 * 60
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.path.startsWith('/health') || req.path.startsWith('/metrics')
      });

      this.app.use(limiter);

      // Speed limiting for API endpoints
      const speedLimiter = slowDown({
        windowMs: 15 * 60 * 1000, // 15 minutes
        delayAfter: this.isProduction ? 50 : 500, // Allow 50 requests per 15 minutes, then...
        delayMs: 500 // Begin adding 500ms of delay per request above 50
      });

      this.app.use('/api/', speedLimiter);

      // Compression
      this.app.use(compression({
        filter: (req, res) => {
          if (req.headers['x-no-compression']) {
            return false;
          }
          return compression.filter(req, res);
        },
        level: 6
      }));

      // Body parsing
      this.app.use(express.json({ 
        limit: '10mb',
        verify: (req, res, buf) => {
          req.rawBody = buf;
        }
      }));
      this.app.use(express.urlencoded({ 
        extended: true, 
        limit: '10mb' 
      }));

      // Static files
      this.app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
      this.app.use('/public', express.static(path.join(__dirname, '../public')));

      // Logging
      if (this.isProduction) {
        this.app.use(morgan('combined', {
          stream: {
            write: (message) => logger.info(message.trim())
          }
        }));
      } else {
        this.app.use(morgan('dev'));
      }

      // Custom middleware
      this.app.use(requestLogger);
      this.app.use(securityMiddleware);

      // Health check endpoint
      this.app.get('/health', (req, res) => {
        res.status(200).json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: process.env.NODE_ENV,
          version: process.env.APP_VERSION || '1.0.0'
        });
      });

      // Metrics endpoint for monitoring
      this.app.get('/metrics', (req, res) => {
        res.status(200).json({
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          uptime: process.uptime(),
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version
        });
      });

      logger.info('Middleware initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize middleware:', error);
      throw error;
    }
  }

  initializeRoutes() {
    try {
      // API versioning
      const apiVersion = process.env.API_VERSION || 'v1';
      const apiPrefix = `/api/${apiVersion}`;

      // Mount routes
      this.app.use(`${apiPrefix}/users`, userRoutes);
      this.app.use(`${apiPrefix}/chat`, chatRoutes);
      this.app.use(`${apiPrefix}/webrtc`, webrtcRoutes);
      this.app.use(`${apiPrefix}/features`, featureRoutes);
      this.app.use(`${apiPrefix}/analytics`, analyticsRoutes);
      this.app.use(`${apiPrefix}/admin`, adminRoutes);

      // Feature flag endpoint
      this.app.get(`${apiPrefix}/features/:featureName/check`, async (req, res) => {
        try {
          const { featureName } = req.params;
          const { userId, context } = req.query;
          
          if (!userId) {
            return res.status(400).json({
              success: false,
              message: 'User ID is required'
            });
          }

          const isEnabled = await FeatureFlagService.isFeatureEnabled(
            featureName, 
            userId, 
            JSON.parse(context || '{}')
          );

          res.json({
            success: true,
            data: {
              featureName,
              isEnabled,
              timestamp: new Date()
            }
          });

        } catch (error) {
          logger.error('Feature flag check error:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to check feature flag'
          });
        }
      });

      // WebRTC configuration endpoint
      this.app.get(`${apiPrefix}/webrtc/config`, (req, res) => {
        res.json({
          success: true,
          data: {
            iceServers: WebRTCService.getIceServers(),
            maxBitrate: process.env.MAX_BITRATE || 2500000,
            maxFramerate: process.env.MAX_FRAMERATE || 30,
            enableVP9: process.env.ENABLE_VP9 === 'true',
            enableH264: process.env.ENABLE_H264 === 'true',
            enableOpus: process.env.ENABLE_OPUS === 'true'
          }
        });
      });

      // Chat service status
      this.app.get(`${apiPrefix}/chat/status`, (req, res) => {
        res.json({
          success: true,
          data: ChatService.getHealthStatus()
        });
      });

      // Feature flag service status
      this.app.get(`${apiPrefix}/features/status`, async (req, res) => {
        try {
          const stats = await FeatureFlagService.getFeatureFlagStats();
          res.json({
            success: true,
            data: stats
          });
        } catch (error) {
          logger.error('Feature flag stats error:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to get feature flag stats'
          });
        }
      });

      // 404 handler for undefined routes
      this.app.use('*', (req, res) => {
        res.status(404).json({
          success: false,
          message: 'Route not found',
          path: req.originalUrl,
          method: req.method
        });
      });

      logger.info('Routes initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize routes:', error);
      throw error;
    }
  }

  async initializeServices() {
    try {
      // Initialize Redis
      await redisManager.connect();
      logger.info('Redis connection established');

      // Initialize Socket.IO
      SocketService.initialize(this.server);
      logger.info('Socket.IO service initialized');

      // Initialize WebRTC service
      logger.info('WebRTC service initialized');

      // Initialize Chat service
      logger.info('Chat service initialized');

      // Initialize Feature Flag service
      logger.info('Feature Flag service initialized');

      // Setup periodic cleanup tasks
      this.setupCleanupTasks();

      logger.info('All services initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize services:', error);
      throw error;
    }
  }

  setupCleanupTasks() {
    try {
      // Cleanup expired sessions every 5 minutes
      setInterval(() => {
        WebRTCService.cleanupExpiredSessions();
        ChatService.cleanupInactiveChats();
      }, 5 * 60 * 1000);

      // Health check every minute
      setInterval(() => {
        this.performHealthCheck();
      }, 60 * 1000);

      // Memory cleanup every 10 minutes
      setInterval(() => {
        if (global.gc) {
          global.gc();
          logger.debug('Garbage collection performed');
        }
      }, 10 * 60 * 1000);

      logger.info('Cleanup tasks scheduled');

    } catch (error) {
      logger.error('Failed to setup cleanup tasks:', error);
    }
  }

  async performHealthCheck() {
    try {
      // Check Redis connection
      const redisHealth = redisManager.isConnected();
      
      // Check Socket.IO health
      const socketHealth = SocketService.getHealthStatus();
      
      // Check WebRTC health
      const webrtcHealth = WebRTCService.getHealthStatus();
      
      // Check Chat service health
      const chatHealth = ChatService.getHealthStatus();
      
      // Check Feature Flag service health
      const featureHealth = FeatureFlagService.getHealthStatus();

      const overallHealth = {
        timestamp: new Date(),
        redis: redisHealth,
        socket: socketHealth,
        webrtc: webrtcHealth,
        chat: chatHealth,
        features: featureHealth,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      };

      // Log health status
      if (!redisHealth || !socketHealth || !webrtcHealth || !chatHealth || !featureHealth) {
        logger.warn('Health check failed:', overallHealth);
      } else {
        logger.debug('Health check passed:', overallHealth);
      }

      // Store health metrics in Redis for monitoring
      await redisManager.getClient().setex(
        'health:status',
        300, // 5 minutes TTL
        JSON.stringify(overallHealth)
      );

    } catch (error) {
      logger.error('Health check failed:', error);
    }
  }

  initializeErrorHandling() {
    try {
      // Global error handler
      this.app.use(errorHandler);

      // Unhandled promise rejection handler
      process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      });

      // Uncaught exception handler
      process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        process.exit(1);
      });

      // Graceful shutdown handler
      process.on('SIGTERM', () => {
        logger.info('SIGTERM received, shutting down gracefully');
        this.gracefulShutdown();
      });

      process.on('SIGINT', () => {
        logger.info('SIGINT received, shutting down gracefully');
        this.gracefulShutdown();
      });

      logger.info('Error handling initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize error handling:', error);
      throw error;
    }
  }

  async gracefulShutdown() {
    try {
      logger.info('Starting graceful shutdown...');

      // Close HTTP server
      this.server.close(() => {
        logger.info('HTTP server closed');
      });

      // Close Socket.IO connections
      if (SocketService.io) {
        SocketService.io.close(() => {
          logger.info('Socket.IO server closed');
        });
      }

      // Close Redis connections
      await redisManager.disconnect();
      logger.info('Redis connections closed');

      // Exit process
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  async start() {
    try {
      // Start server
      this.server.listen(this.port, () => {
        logger.info(`🚀 NearChat Server started successfully!`);
        logger.info(`📍 Server running on port ${this.port}`);
        logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🔗 Health check: http://localhost:${this.port}/health`);
        logger.info(`📊 Metrics: http://localhost:${this.port}/metrics`);
        logger.info(`📡 Socket.IO: ws://localhost:${this.port}`);
        logger.info(`⚡ WebRTC: Ready for video calls and screen sharing`);
        logger.info(`💬 Chat: Real-time messaging system active`);
        logger.info(`🚩 Feature Flags: A/B testing and rollouts enabled`);
        logger.info(`📈 Analytics: Comprehensive tracking system active`);
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.syscall !== 'listen') {
          throw error;
        }

        switch (error.code) {
          case 'EACCES':
            logger.error(`Port ${this.port} requires elevated privileges`);
            process.exit(1);
            break;
          case 'EADDRINUSE':
            logger.error(`Port ${this.port} is already in use`);
            process.exit(1);
            break;
          default:
            throw error;
        }
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }
}

// Create and start server
const server = new NearChatServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
server.start().catch((error) => {
  logger.error('Failed to start NearChat server:', error);
  process.exit(1);
});

module.exports = server;