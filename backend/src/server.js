const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const session = require('express-session');
const RedisStore = require('connect-redis').default;

// Import services and middleware
const SocketService = require('./services/SocketService');
const WebRTCService = require('./services/WebRTCService');
const FeatureFlagService = require('./services/FeatureFlagService');
const redisManager = require('./config/redis');
const logger = require('./utils/logger');

// Import routes
const routes = require('./routes');

// Import database connection
const connectDB = require('./config/database');

class NearChatServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.port = process.env.PORT || 3000;
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  async initialize() {
    try {
      // Connect to database
      await connectDB();
      logger.info('Database connected successfully');

      // Connect to Redis
      await redisManager.connect();
      logger.info('Redis connected successfully');

      // Initialize services
      await this.initializeServices();

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup Socket.IO
      this.setupSocketIO();

      // Setup error handling
      this.setupErrorHandling();

      // Start server
      await this.startServer();

    } catch (error) {
      logger.error('Server initialization failed:', error);
      process.exit(1);
    }
  }

  async initializeServices() {
    try {
      // Initialize feature flag service
      await FeatureFlagService.initialize();
      logger.info('Feature flag service initialized');

      // Initialize WebRTC service
      WebRTCService.setSocketService(SocketService);
      logger.info('WebRTC service initialized');

    } catch (error) {
      logger.error('Service initialization failed:', error);
      throw error;
    }
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "ws:"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key']
    }));

    // Compression middleware
    this.app.use(compression());

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Session middleware with Redis store
    this.app.use(session({
      store: new RedisStore({ client: redisManager.getClient() }),
      secret: process.env.SESSION_SECRET || 'your-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: this.isProduction,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: this.isProduction ? 'strict' : 'lax'
      }
    }));

    // Logging middleware
    if (this.isProduction) {
      this.app.use(morgan('combined', {
        stream: {
          write: (message) => logger.info(message.trim())
        }
      }));
    } else {
      this.app.use(morgan('dev'));
    }

    // Global rate limiting
    const globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        success: false,
        message: 'Too many requests from this IP, please try again later'
      },
      standardHeaders: true,
      legacyHeaders: false,
      store: new (require('rate-limit-redis'))({
        sendCommand: (...args) => redisManager.getClient().call(...args)
      })
    });

    this.app.use('/api/', globalLimiter);

    // Speed limiting for large requests
    const speedLimiter = slowDown({
      windowMs: 15 * 60 * 1000, // 15 minutes
      delayAfter: 100, // allow 100 requests per 15 minutes, then...
      delayMs: 500 // begin adding 500ms of delay per request above 100
    });

    this.app.use('/api/', speedLimiter);

    // Request logging for analytics
    this.app.use((req, res, next) => {
      req.startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - req.startTime;
        logger.info(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
        
        // Track API usage analytics
        if (req.user) {
          this.trackAPIUsage(req, res, duration);
        }
      });
      
      next();
    });

    // Health check endpoint (before authentication)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: 'connected',
          redis: redisManager.isConnected ? 'connected' : 'disconnected',
          socket: 'initialized'
        }
      });
    });
  }

  setupRoutes() {
    // API routes
    this.app.use('/api/v1', routes);

    // Static file serving (for admin panel)
    this.app.use('/admin', express.static('public/admin'));

    // WebSocket endpoint info
    this.app.get('/ws-info', (req, res) => {
      res.json({
        websocket: true,
        endpoint: '/socket.io',
        transports: ['websocket', 'polling'],
        cors: {
          origin: process.env.FRONTEND_URL || "http://localhost:3000",
          credentials: true
        }
      });
    });
  }

  setupSocketIO() {
    try {
      // Initialize Socket.IO service
      const io = SocketService.initialize(this.server);
      
      // Set up WebRTC service with Socket.IO
      WebRTCService.setSocketService(SocketService);

      // Socket.IO connection logging
      io.engine.on('connection_error', (err) => {
        logger.error('Socket.IO connection error:', err);
      });

      logger.info('Socket.IO service setup completed');

    } catch (error) {
      logger.error('Socket.IO setup failed:', error);
      throw error;
    }
  }

  setupErrorHandling() {
    // 404 handler for undefined routes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error('Unhandled error:', error);

      // Don't leak error details in production
      const errorMessage = this.isProduction ? 'Internal server error' : error.message;
      const errorStack = this.isProduction ? undefined : error.stack;

      res.status(error.status || 500).json({
        success: false,
        message: errorMessage,
        ...(errorStack && { stack: errorStack }),
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method
      });
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  async startServer() {
    try {
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, () => {
          logger.info(`NearChat server running on port ${this.port}`);
          logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
          logger.info(`Health check: http://localhost:${this.port}/health`);
          logger.info(`WebSocket info: http://localhost:${this.port}/ws-info`);
          resolve();
        });

        this.server.on('error', reject);
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }

  async gracefulShutdown() {
    logger.info('Received shutdown signal, starting graceful shutdown...');

    try {
      // Close HTTP server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
        logger.info('HTTP server closed');
      }

      // Close Socket.IO connections
      if (SocketService.io) {
        SocketService.io.close();
        logger.info('Socket.IO connections closed');
      }

      // Close Redis connections
      if (redisManager.isConnected) {
        await redisManager.disconnect();
        logger.info('Redis connections closed');
      }

      // Close database connection
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        logger.info('Database connection closed');
      }

      logger.info('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  async trackAPIUsage(req, res, duration) {
    try {
      const Analytics = require('./models/Analytics');
      
      await Analytics.create({
        eventType: 'api_request',
        eventName: 'API Request',
        eventCategory: 'system',
        userId: req.user.id,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          userAgent: req.headers['user-agent'],
          ip: req.ip
        },
        performance: {
          responseTime: duration
        }
      });

    } catch (error) {
      logger.debug('Failed to track API usage:', error.message);
    }
  }
}

// Create and start server instance
const server = new NearChatServer();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
server.initialize().catch((error) => {
  logger.error('Failed to start NearChat server:', error);
  process.exit(1);
});

module.exports = server;