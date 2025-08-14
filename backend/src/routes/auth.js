const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { validateRegistration, validateLogin } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// User registration
router.post('/register', 
  rateLimiter('auth', 5, 15 * 60 * 1000), // 5 requests per 15 minutes
  validateRegistration,
  UserController.register
);

// User login
router.post('/login',
  rateLimiter('auth', 10, 15 * 60 * 1000), // 10 requests per 15 minutes
  validateLogin,
  UserController.login
);

// Google OAuth login
router.post('/google',
  rateLimiter('auth', 10, 15 * 60 * 1000),
  UserController.googleLogin
);

// Forgot password
router.post('/forgot-password',
  rateLimiter('auth', 3, 60 * 60 * 1000), // 3 requests per hour
  UserController.forgotPassword
);

// Reset password
router.post('/reset-password',
  rateLimiter('auth', 3, 60 * 60 * 1000),
  UserController.resetPassword
);

// Verify email
router.post('/verify-email',
  rateLimiter('auth', 5, 60 * 60 * 1000), // 5 requests per hour
  UserController.verifyEmail
);

// Resend verification email
router.post('/resend-verification',
  rateLimiter('auth', 3, 60 * 60 * 1000),
  UserController.resendVerificationEmail
);

module.exports = router;