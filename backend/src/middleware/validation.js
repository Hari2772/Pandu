const Joi = require('joi');
const logger = require('../utils/logger');

// Common validation schemas
const commonSchemas = {
  // ObjectId validation
  objectId: Joi.string().hex().length(24).required(),
  
  // Email validation
  email: Joi.string().email().max(255).required(),
  
  // Username validation
  username: Joi.string().alphanum().min(3).max(30).required(),
  
  // Password validation
  password: Joi.string().min(8).max(128).required(),
  
  // Display name validation
  displayName: Joi.string().min(2).max(100).required(),
  
  // Phone number validation
  phoneNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).optional(),
  
  // Date validation
  date: Joi.date().iso().max('now').optional(),
  
  // Coordinates validation
  coordinates: Joi.array().items(Joi.number()).length(2).required(),
  
  // Pagination validation
  pagination: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20)
  }
};

// User validation schemas
const userSchemas = {
  // User registration
  register: Joi.object({
    email: commonSchemas.email,
    username: commonSchemas.username,
    displayName: commonSchemas.displayName,
    password: commonSchemas.password,
    phoneNumber: commonSchemas.phoneNumber,
    dateOfBirth: commonSchemas.date,
    interests: Joi.array().items(Joi.string()).max(20).optional(),
    gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say').optional()
  }),

  // User login
  login: Joi.object({
    email: Joi.string().required(),
    password: commonSchemas.password,
    deviceId: Joi.string().optional(),
    platform: Joi.string().valid('ios', 'android', 'web', 'desktop').optional(),
    appVersion: Joi.string().optional()
  }),

  // User profile update
  profileUpdate: Joi.object({
    username: commonSchemas.username.optional(),
    displayName: commonSchemas.displayName.optional(),
    bio: Joi.string().max(500).optional(),
    phoneNumber: commonSchemas.phoneNumber.optional(),
    dateOfBirth: commonSchemas.date.optional(),
    interests: Joi.array().items(Joi.string()).max(20).optional(),
    gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say').optional(),
    preferences: Joi.object().optional()
  }),

  // Password change
  passwordChange: Joi.object({
    currentPassword: commonSchemas.password,
    newPassword: commonSchemas.password
  }),

  // Password reset
  passwordReset: Joi.object({
    token: Joi.string().required(),
    newPassword: commonSchemas.password
  }),

  // Email verification
  emailVerification: Joi.object({
    token: Joi.string().required()
  })
};

// Chat validation schemas
const chatSchemas = {
  // Chat data
  chatData: Joi.object({
    type: Joi.string().valid('direct', 'group').required(),
    participants: Joi.array().items(commonSchemas.objectId).min(2).required(),
    name: Joi.string().max(100).optional(),
    description: Joi.string().max(500).optional(),
    isPrivate: Joi.boolean().optional(),
    avatar: Joi.string().uri().optional()
  }),

  // Message data
  messageData: Joi.object({
    content: Joi.string().max(5000).required(),
    messageType: Joi.string().valid('text', 'image', 'video', 'audio', 'file', 'location', 'system').default('text'),
    replyTo: commonSchemas.objectId.optional(),
    attachments: Joi.array().items(Joi.object({
      type: Joi.string().valid('image', 'video', 'audio', 'file').required(),
      url: Joi.string().uri().required(),
      filename: Joi.string().optional(),
      size: Joi.number().positive().optional(),
      mimeType: Joi.string().optional()
    })).max(10).optional(),
    metadata: Joi.object().optional()
  }),

  // Direct chat creation
  directChat: Joi.object({
    targetUserId: commonSchemas.objectId.required()
  }),

  // Group chat creation
  groupChat: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    description: Joi.string().max(500).optional(),
    participants: Joi.array().items(commonSchemas.objectId).min(1).required(),
    isPrivate: Joi.boolean().default(false),
    avatar: Joi.string().uri().optional()
  })
};

// Discovery validation schemas
const discoverySchemas = {
  // Location update
  locationUpdate: Joi.object({
    coordinates: commonSchemas.coordinates,
    accuracy: Joi.number().positive().max(1000).optional(),
    address: Joi.string().max(500).optional(),
    placeName: Joi.string().max(200).optional()
  }),

  // Discovery request
  discoveryRequest: Joi.object({
    tier: Joi.number().integer().min(1).max(6).optional(),
    radius: Joi.number().positive().max(50000).optional(),
    limit: Joi.number().integer().min(1).max(100).default(50),
    includeOffline: Joi.boolean().default(false),
    excludeFriends: Joi.boolean().default(false),
    excludeBlocked: Joi.boolean().default(false),
    minAge: Joi.number().integer().min(13).max(120).optional(),
    maxAge: Joi.number().integer().min(13).max(120).optional(),
    interests: Joi.array().items(Joi.string()).max(20).optional(),
    gender: Joi.string().valid('male', 'female', 'other').optional()
  }),

  // Area search
  areaSearch: Joi.object({
    coordinates: commonSchemas.coordinates,
    radius: Joi.number().positive().max(50000).required(),
    limit: Joi.number().integer().min(1).max(200).default(100),
    includeOffline: Joi.boolean().default(false),
    minTier: Joi.number().integer().min(1).max(6).default(1),
    maxTier: Joi.number().integer().min(1).max(6).default(6)
  })
};

// Call validation schemas
const callSchemas = {
  // Call initiation
  callInitiate: Joi.object({
    targetUserId: commonSchemas.objectId.required(),
    callType: Joi.string().valid('audio', 'video').default('audio'),
    chatId: commonSchemas.objectId.optional()
  }),

  // Call answer
  callAnswer: Joi.object({
    callId: commonSchemas.objectId.required(),
    answer: Joi.string().valid('accept', 'reject').required()
  }),

  // Call end
  callEnd: Joi.object({
    callId: commonSchemas.objectId.required()
  }),

  // WebRTC signaling
  webrtcSignal: Joi.object({
    targetUserId: commonSchemas.objectId.required(),
    signal: Joi.object().required(),
    callId: commonSchemas.objectId.required()
  })
};

// Group validation schemas
const groupSchemas = {
  // Group creation
  groupCreate: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    description: Joi.string().max(500).optional(),
    isPrivate: Joi.boolean().default(false),
    avatar: Joi.string().uri().optional(),
    settings: Joi.object({
      allowMemberInvites: Joi.boolean().default(true),
      requireAdminApproval: Joi.boolean().default(false),
      allowMemberEditing: Joi.boolean().default(false),
      allowMemberDeletion: Joi.boolean().default(false)
    }).optional()
  }),

  // Group update
  groupUpdate: Joi.object({
    name: Joi.string().min(2).max(100).optional(),
    description: Joi.string().max(500).optional(),
    isPrivate: Joi.boolean().optional(),
    avatar: Joi.string().uri().optional(),
    settings: Joi.object({
      allowMemberInvites: Joi.boolean().optional(),
      requireAdminApproval: Joi.boolean().optional(),
      allowMemberEditing: Joi.boolean().optional(),
      allowMemberDeletion: Joi.boolean().optional()
    }).optional()
  }),

  // Member management
  memberManagement: Joi.object({
    userId: commonSchemas.objectId.required(),
    role: Joi.string().valid('member', 'moderator', 'admin').default('member')
  })
};

// Story validation schemas
const storySchemas = {
  // Story creation
  storyCreate: Joi.object({
    content: Joi.string().max(1000).optional(),
    media: Joi.array().items(Joi.object({
      type: Joi.string().valid('image', 'video').required(),
      url: Joi.string().uri().required(),
      thumbnail: Joi.string().uri().optional()
    })).max(10).optional(),
    isPrivate: Joi.boolean().default(false),
    expiresIn: Joi.number().integer().min(1).max(24).default(24), // hours
    location: Joi.object({
      coordinates: commonSchemas.coordinates.optional(),
      placeName: Joi.string().max(200).optional()
    }).optional()
  })
};

// Admin validation schemas
const adminSchemas = {
  // User management
  userManagement: Joi.object({
    userId: commonSchemas.objectId.required(),
    action: Joi.string().valid('activate', 'deactivate', 'suspend', 'delete').required(),
    reason: Joi.string().max(500).optional(),
    duration: Joi.number().integer().positive().optional() // seconds
  }),

  // Feature flag
  featureFlag: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(500).optional(),
    isActive: Joi.boolean().default(false),
    userTiers: Joi.array().items(Joi.number().integer().min(1).max(6)).optional(),
    userRoles: Joi.array().items(Joi.string().valid('user', 'moderator', 'admin', 'superadmin')).optional(),
    rolloutPercentage: Joi.number().min(0).max(100).default(0),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
  })
};

// Validation middleware factory
const validateRequest = (schema, options = {}) => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        ...options
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type
        }));

        logger.warn('Validation failed:', {
          path: req.path,
          method: req.method,
          errors
        });

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors
        });
      }

      // Replace validated data
      req.body = value;
      next();

    } catch (error) {
      logger.error('Validation middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Validation error'
      });
    }
  };
};

// Query validation middleware
const validateQuery = (schema, options = {}) => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        ...options
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type
        }));

        return res.status(400).json({
          success: false,
          message: 'Query validation failed',
          errors
        });
      }

      // Replace validated query
      req.query = value;
      next();

    } catch (error) {
      logger.error('Query validation middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Query validation error'
      });
    }
  };
};

// Params validation middleware
const validateParams = (schema, options = {}) => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.params, {
        abortEarly: false,
        stripUnknown: true,
        ...options
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type
        }));

        return res.status(400).json({
          success: false,
          message: 'Parameter validation failed',
          errors
        });
      }

      // Replace validated params
      req.params = value;
      next();

    } catch (error) {
      logger.error('Params validation middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Parameter validation error'
      });
    }
  };
};

// Specific validation middlewares
const validateUserData = (req, res, next) => {
  return validateRequest(userSchemas.profileUpdate)(req, res, next);
};

const validateChatData = (req, res, next) => {
  return validateRequest(chatSchemas.chatData)(req, res, next);
};

const validateMessageData = (req, res, next) => {
  return validateRequest(chatSchemas.messageData)(req, res, next);
};

const validateLocationData = (req, res, next) => {
  return validateRequest(discoverySchemas.locationUpdate)(req, res, next);
};

const validateCallData = (req, res, next) => {
  return validateRequest(callSchemas.callInitiate)(req, res, next);
};

const validateGroupData = (req, res, next) => {
  return validateRequest(groupSchemas.groupCreate)(req, res, next);
};

const validateStoryData = (req, res, next) => {
  return validateRequest(storySchemas.storyCreate)(req, res, next);
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitize body
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
          // Remove HTML tags and trim whitespace
          req.body[key] = req.body[key].replace(/<[^>]*>/g, '').trim();
        }
      });
    }

    // Sanitize query
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (typeof req.query[key] === 'string') {
          req.query[key] = req.query[key].replace(/<[^>]*>/g, '').trim();
        }
      });
    }

    next();
  } catch (error) {
    logger.error('Sanitization middleware error:', error);
    next();
  }
};

// Export all validation functions and schemas
module.exports = {
  // Middleware functions
  validateRequest,
  validateQuery,
  validateParams,
  validateUserData,
  validateChatData,
  validateMessageData,
  validateLocationData,
  validateCallData,
  validateGroupData,
  validateStoryData,
  sanitizeInput,

  // Schemas
  schemas: {
    common: commonSchemas,
    user: userSchemas,
    chat: chatSchemas,
    discovery: discoverySchemas,
    call: callSchemas,
    group: groupSchemas,
    story: storySchemas,
    admin: adminSchemas
  }
};