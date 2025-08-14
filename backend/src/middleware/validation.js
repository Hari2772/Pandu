const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn(`Validation failed for ${req.method} ${req.path}:`, errors.array());
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

// Registration validation
const validateRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('username')
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username must be 3-30 characters and contain only letters, numbers, and underscores'),
  
  body('displayName')
    .isLength({ min: 2, max: 50 })
    .trim()
    .escape()
    .withMessage('Display name must be 2-50 characters'),
  
  body('password')
    .isLength({ min: 8, max: 128 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters and contain uppercase, lowercase, number, and special character'),
  
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .custom(value => {
      const age = (new Date() - new Date(value)) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 13) {
        throw new Error('You must be at least 13 years old');
      }
      if (age > 120) {
        throw new Error('Please provide a valid date of birth');
      }
      return true;
    })
    .withMessage('Invalid date of birth'),
  
  handleValidationErrors
];

// Login validation
const validateLogin = [
  body('email')
    .notEmpty()
    .withMessage('Email is required'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  
  body('deviceId')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Device ID must be a string with maximum 100 characters'),
  
  body('platform')
    .optional()
    .isIn(['ios', 'android', 'web', 'desktop'])
    .withMessage('Platform must be one of: ios, android, web, desktop'),
  
  body('appVersion')
    .optional()
    .isString()
    .isLength({ max: 20 })
    .withMessage('App version must be a string with maximum 20 characters'),
  
  handleValidationErrors
];

// Profile update validation
const validateProfileUpdate = [
  body('username')
    .optional()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username must be 3-30 characters and contain only letters, numbers, and underscores'),
  
  body('displayName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .trim()
    .escape()
    .withMessage('Display name must be 2-50 characters'),
  
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .trim()
    .escape()
    .withMessage('Bio must be maximum 500 characters'),
  
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .custom(value => {
      const age = (new Date() - new Date(value)) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 13) {
        throw new Error('You must be at least 13 years old');
      }
      if (age > 120) {
        throw new Error('Please provide a valid date of birth');
      }
      return true;
    })
    .withMessage('Invalid date of birth'),
  
  body('preferences')
    .optional()
    .isObject()
    .withMessage('Preferences must be an object'),
  
  body('preferences.language')
    .optional()
    .isIn(['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko'])
    .withMessage('Language must be a supported language code'),
  
  body('preferences.timezone')
    .optional()
    .isString()
    .withMessage('Timezone must be a string'),
  
  body('preferences.notifications')
    .optional()
    .isObject()
    .withMessage('Notification preferences must be an object'),
  
  body('preferences.privacy')
    .optional()
    .isObject()
    .withMessage('Privacy preferences must be an object'),
  
  handleValidationErrors
];

// Location update validation
const validateLocationUpdate = [
  body('coordinates')
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordinates must be an array with exactly 2 elements'),
  
  body('coordinates.*')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Coordinates must be valid longitude (-180 to 180) and latitude (-90 to 90)'),
  
  body('accuracy')
    .optional()
    .isFloat({ min: 0, max: 10000 })
    .withMessage('Accuracy must be a positive number up to 10,000 meters'),
  
  body('address')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .trim()
    .escape()
    .withMessage('Address must be a string with maximum 200 characters'),
  
  body('placeName')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .trim()
    .escape()
    .withMessage('Place name must be a string with maximum 100 characters'),
  
  handleValidationErrors
];

// Message validation
const validateMessage = [
  body('content')
    .notEmpty()
    .isLength({ max: 5000 })
    .trim()
    .escape()
    .withMessage('Message content is required and must be maximum 5,000 characters'),
  
  body('chatId')
    .isMongoId()
    .withMessage('Valid chat ID is required'),
  
  body('messageType')
    .optional()
    .isIn(['text', 'media', 'location', 'voice', 'sticker', 'file'])
    .withMessage('Message type must be one of: text, media, location, voice, sticker, file'),
  
  body('replyTo')
    .optional()
    .isMongoId()
    .withMessage('Reply message ID must be a valid MongoDB ID'),
  
  body('mediaUrl')
    .optional()
    .isURL()
    .withMessage('Media URL must be a valid URL'),
  
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  
  body('location.coordinates')
    .optional()
    .isArray({ min: 2, max: 2 })
    .withMessage('Location coordinates must be an array with exactly 2 elements'),
  
  handleValidationErrors
];

// Story validation
const validateStory = [
  body('content')
    .notEmpty()
    .isLength({ max: 1000 })
    .trim()
    .escape()
    .withMessage('Story content is required and must be maximum 1,000 characters'),
  
  body('mediaUrl')
    .optional()
    .isURL()
    .withMessage('Media URL must be a valid URL'),
  
  body('expiresIn')
    .optional()
    .isInt({ min: 1, max: 72 })
    .withMessage('Story expiration must be between 1 and 72 hours'),
  
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('Public flag must be a boolean'),
  
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  
  handleValidationErrors
];

// Group validation
const validateGroup = [
  body('name')
    .notEmpty()
    .isLength({ min: 2, max: 100 })
    .trim()
    .escape()
    .withMessage('Group name is required and must be 2-100 characters'),
  
  body('description')
    .optional()
    .isLength({ max: 500 })
    .trim()
    .escape()
    .withMessage('Group description must be maximum 500 characters'),
  
  body('isPrivate')
    .optional()
    .isBoolean()
    .withMessage('Private flag must be a boolean'),
  
  body('maxMembers')
    .optional()
    .isInt({ min: 2, max: 1000 })
    .withMessage('Maximum members must be between 2 and 1,000'),
  
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  
  handleValidationErrors
];

// Call validation
const validateCall = [
  body('targetUserId')
    .isMongoId()
    .withMessage('Valid target user ID is required'),
  
  body('callType')
    .optional()
    .isIn(['audio', 'video'])
    .withMessage('Call type must be audio or video'),
  
  body('isVideo')
    .optional()
    .isBoolean()
    .withMessage('Video flag must be a boolean'),
  
  body('isScreenShare')
    .optional()
    .isBoolean()
    .withMessage('Screen share flag must be a boolean'),
  
  handleValidationErrors
];

// Search validation
const validateSearch = [
  body('query')
    .notEmpty()
    .isLength({ min: 2, max: 100 })
    .trim()
    .escape()
    .withMessage('Search query is required and must be 2-100 characters'),
  
  body('type')
    .optional()
    .isIn(['users', 'messages', 'groups', 'stories'])
    .withMessage('Search type must be one of: users, messages, groups, stories'),
  
  body('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Search limit must be between 1 and 100'),
  
  body('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Search offset must be a non-negative integer'),
  
  handleValidationErrors
];

// Pagination validation
const validatePagination = [
  body('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  body('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  body('sortBy')
    .optional()
    .isString()
    .isLength({ max: 50 })
    .withMessage('Sort field must be a string with maximum 50 characters'),
  
  body('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),
  
  handleValidationErrors
];

// File upload validation
const validateFileUpload = [
  body('file')
    .notEmpty()
    .withMessage('File is required'),
  
  body('file.mimetype')
    .optional()
    .isIn(['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'audio/mpeg'])
    .withMessage('File type not supported'),
  
  body('file.size')
    .optional()
    .isInt({ max: 10 * 1024 * 1024 }) // 10MB
    .withMessage('File size must be less than 10MB'),
  
  handleValidationErrors
];

// Admin action validation
const validateAdminAction = [
  body('action')
    .notEmpty()
    .isIn(['ban', 'unban', 'warn', 'delete', 'moderate'])
    .withMessage('Valid admin action is required'),
  
  body('targetUserId')
    .isMongoId()
    .withMessage('Valid target user ID is required'),
  
  body('reason')
    .optional()
    .isLength({ max: 500 })
    .trim()
    .escape()
    .withMessage('Reason must be maximum 500 characters'),
  
  body('duration')
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('Duration must be between 1 and 365 days'),
  
  handleValidationErrors
];

// Feature flag validation
const validateFeatureFlag = [
  body('name')
    .notEmpty()
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Feature name must be 3-50 characters and contain only letters, numbers, and underscores'),
  
  body('description')
    .optional()
    .isLength({ max: 200 })
    .trim()
    .escape()
    .withMessage('Description must be maximum 200 characters'),
  
  body('isEnabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled flag must be a boolean'),
  
  body('rolloutPercentage')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Rollout percentage must be between 0 and 100'),
  
  body('dependencies')
    .optional()
    .isArray()
    .withMessage('Dependencies must be an array'),
  
  body('dependencies.*')
    .optional()
    .isString()
    .withMessage('Each dependency must be a string'),
  
  handleValidationErrors
];

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitize string fields
    if (req.body) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === 'string') {
          req.body[key] = req.body[key].trim();
        }
      });
    }
    
    // Sanitize query parameters
    if (req.query) {
      Object.keys(req.query).forEach(key => {
        if (typeof req.query[key] === 'string') {
          req.query[key] = req.query[key].trim();
        }
      });
    }
    
    next();
  } catch (error) {
    logger.error('Input sanitization error:', error);
    next();
  }
};

// Custom validation functions
const customValidators = {
  // Check if username is available
  isUsernameAvailable: async (username) => {
    const User = require('../models/User');
    const user = await User.findOne({ username });
    return !user;
  },
  
  // Check if email is available
  isEmailAvailable: async (email) => {
    const User = require('../models/User');
    const user = await User.findOne({ email });
    return !user;
  },
  
  // Validate MongoDB ObjectId
  isValidObjectId: (value) => {
    return /^[0-9a-fA-F]{24}$/.test(value);
  },
  
  // Validate coordinates
  isValidCoordinates: (coordinates) => {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      return false;
    }
    const [lng, lat] = coordinates;
    return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  }
};

module.exports = {
  handleValidationErrors,
  validateRegistration,
  validateLogin,
  validateProfileUpdate,
  validateLocationUpdate,
  validateMessage,
  validateStory,
  validateGroup,
  validateCall,
  validateSearch,
  validatePagination,
  validateFileUpload,
  validateAdminAction,
  validateFeatureFlag,
  sanitizeInput,
  customValidators
};