const logger = require('../utils/logger');

/**
 * Custom error class for API errors
 */
class APIError extends Error {
  constructor(message, statusCode = 500, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error class
 */
class ValidationError extends APIError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * Authentication error class
 */
class AuthenticationError extends APIError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization error class
 */
class AuthorizationError extends APIError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Not found error class
 */
class NotFoundError extends APIError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/**
 * Rate limit error class
 */
class RateLimitError extends APIError {
  constructor(message = 'Rate limit exceeded', retryAfter = null) {
    super(message, 429, 'RATE_LIMIT_ERROR');
    this.retryAfter = retryAfter;
  }
}

/**
 * Database error class
 */
class DatabaseError extends APIError {
  constructor(message = 'Database operation failed', details = null) {
    super(message, 500, 'DATABASE_ERROR', details);
  }
}

/**
 * Main error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log the error
  logger.logError(err, {
    url: req.url,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new NotFoundError();
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field} already exists`;
    error = new ValidationError(message);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new ValidationError(message, err.errors);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AuthenticationError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AuthenticationError('Token expired');
  }

  // Rate limit errors
  if (err.statusCode === 429) {
    error = new RateLimitError(err.message, err.retryAfter);
  }

  // Database connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    error = new DatabaseError('Database connection failed');
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new ValidationError('File too large');
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error = new ValidationError('Unexpected file field');
  }

  // Socket.IO errors
  if (err.type === 'TransportError') {
    error = new APIError('Connection error', 503, 'TRANSPORT_ERROR');
  }

  // Default error
  if (!error.statusCode) {
    error.statusCode = 500;
    error.message = 'Internal server error';
    error.code = 'INTERNAL_ERROR';
  }

  // Set response headers
  if (error.retryAfter) {
    res.set('Retry-After', error.retryAfter);
  }

  // Send error response
  res.status(error.statusCode).json({
    success: false,
    message: error.message,
    code: error.code,
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
      details: error.details
    }),
    ...(error.retryAfter && { retryAfter: error.retryAfter })
  });
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 handler for undefined routes
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError('Route');
  next(error);
};

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = (server) => {
  return (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };
};

/**
 * Unhandled promise rejection handler
 */
const unhandledRejectionHandler = (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
};

/**
 * Uncaught exception handler
 */
const uncaughtExceptionHandler = (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
};

/**
 * Memory leak detection
 */
const memoryLeakDetector = () => {
  const memUsage = process.memoryUsage();
  const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  if (heapUsedPercent > 90) {
    logger.error('Memory usage is critically high', {
      heapUsedPercent,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    });
  }
};

/**
 * Request timeout handler
 */
const timeoutHandler = (timeoutMs = 30000) => {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        const error = new APIError('Request timeout', 408, 'TIMEOUT_ERROR');
        next(error);
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

/**
 * Validation error formatter
 */
const formatValidationErrors = (errors) => {
  const formatted = {};
  
  for (const field in errors) {
    const error = errors[field];
    formatted[field] = {
      message: error.message,
      value: error.value,
      kind: error.kind
    };
  }
  
  return formatted;
};

/**
 * Error response formatter
 */
const formatErrorResponse = (error, includeStack = false) => {
  const response = {
    success: false,
    message: error.message,
    code: error.code || 'UNKNOWN_ERROR'
  };

  if (error.details) {
    response.details = error.details;
  }

  if (includeStack && error.stack) {
    response.stack = error.stack;
  }

  return response;
};

/**
 * Health check error handler
 */
const healthCheckErrorHandler = (err, req, res, next) => {
  if (req.path === '/health') {
    return res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
  next(err);
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  gracefulShutdown,
  unhandledRejectionHandler,
  uncaughtExceptionHandler,
  memoryLeakDetector,
  timeoutHandler,
  formatValidationErrors,
  formatErrorResponse,
  healthCheckErrorHandler,
  APIError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  DatabaseError
};