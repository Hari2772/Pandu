const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { authenticateToken } = require('../middleware/auth');
const { validateProfileUpdate, validateLocationUpdate } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/upload');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Get user profile
router.get('/profile',
  rateLimiter('profile', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  UserController.getProfile
);

// Update user profile
router.put('/profile',
  rateLimiter('profile', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  validateProfileUpdate,
  UserController.updateProfile
);

// Update user location
router.put('/location',
  rateLimiter('location', 60, 15 * 60 * 1000), // 60 requests per 15 minutes
  validateLocationUpdate,
  UserController.updateLocation
);

// Upload profile picture
router.post('/profile/picture',
  rateLimiter('upload', 10, 15 * 60 * 1000), // 10 uploads per 15 minutes
  upload.single('profilePicture'),
  UserController.uploadProfilePicture
);

// Change password
router.put('/password',
  rateLimiter('password', 5, 15 * 60 * 1000), // 5 requests per 15 minutes
  UserController.changePassword
);

// Logout
router.post('/logout',
  rateLimiter('logout', 10, 15 * 60 * 1000), // 10 requests per 15 minutes
  UserController.logout
);

// Delete account
router.delete('/account',
  rateLimiter('delete', 1, 24 * 60 * 60 * 1000), // 1 request per day
  UserController.deleteAccount
);

// Get user statistics
router.get('/stats',
  rateLimiter('stats', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  UserController.getUserStats
);

module.exports = router;