const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Redis = require('ioredis');
const cluster = require('cluster');
const os = require('os');
const path = require('path');
require('dotenv').config();

// Import configurations
const connectDB = require('./config/database');
const connectRedis = require('./config/redis');
const logger = require('./utils/logger');

// Import middleware
const authMiddleware = require('./middleware/authMiddleware');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const storyRoutes = require('./routes/storyRoutes');
const streakRoutes = require('./routes/streakRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Import socket handlers
const socketHandler = require('./socket/index');

// Import security middleware
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('express-xss-clean');
const hpp = require('hpp');

// Production clustering for horizontal scaling
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
  const numCPUs = os.cpus().length;
  logger.info(`Master ${process.pid} is running`);
  logger.info(`Forking for ${numCPUs} CPUs`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died`);
    logger.info('Starting a new worker');
    cluster.fork();
  });

  // Monitor cluster health
  cluster.on('online', (worker) => {
    logger.info(`Worker ${worker.process.pid} is online`);
  });

} else {
  // Worker process
  const app = express();
  const server = http.createServer(app);
  
  // Socket.IO with Redis adapter for horizontal scaling
  const io = socketIo(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e8, // 100MB
    allowRequest: (req, callback) => {
      // Rate limiting for socket connections
      const clientId = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      if (rateLimiter.isRateLimited(clientId, 'socket_connection')) {
        callback(null, false);
      } else {
        callback(null, true);
      }
    }
  });

  // Redis adapter for Socket.IO clustering
  const redisAdapter = require('socket.io-redis');
  const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  io.adapter(redisAdapter({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    key: 'nearchat_socket'
  }));

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  }));

  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));

  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(mongoSanitize());
  app.use(xss());
  app.use(hpp());

  // Rate limiting
  app.use(rateLimiter.globalLimiter);
  app.use('/api/auth', rateLimiter.authLimiter);
  app.use('/api/users', rateLimiter.userLimiter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      worker: cluster.worker ? cluster.worker.id : 'master'
    });
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', authMiddleware, userRoutes);
  app.use('/api/stories', authMiddleware, storyRoutes);
  app.use('/api/streaks', authMiddleware, streakRoutes);
  app.use('/api/admin', authMiddleware, adminRoutes);

  // Socket.IO connection handling
  socketHandler(io, redisClient);

  // Error handling middleware
  app.use(errorHandler);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      path: req.originalUrl
    });
  });

  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    server.close(() => {
      logger.info('HTTP server closed');
      
      // Close Redis connections
      redisClient.quit();
      
      // Close Socket.IO
      io.close(() => {
        logger.info('Socket.IO server closed');
        process.exit(0);
      });
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Unhandled promise rejection handler
  process.on('unhandledRejection', (err, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', err);
    process.exit(1);
  });

  // Uncaught exception handler
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  
  const startServer = async () => {
    try {
      // Connect to databases
      await connectDB();
      await connectRedis();
      
      server.listen(PORT, () => {
        logger.info(`Worker ${process.pid} started on port ${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV}`);
        
        // Log system information
        const memUsage = process.memoryUsage();
        logger.info(`Memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      });
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  };

  startServer();
}