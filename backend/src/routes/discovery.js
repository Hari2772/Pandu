const express = require('express');
const router = express.Router();
const DiscoveryController = require('../controllers/DiscoveryController');
const { authenticateToken } = require('../middleware/auth');
const { validateLocationUpdate } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Update user location
router.put('/location',
  rateLimiter('location_update', 60, 15 * 60 * 1000), // 60 requests per 15 minutes
  validateLocationUpdate,
  DiscoveryController.updateLocation
);

// Discover nearby users
router.get('/nearby',
  rateLimiter('discovery', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  DiscoveryController.discoverNearbyUsers
);

// Get users by tier
router.get('/tier/:tier',
  rateLimiter('discovery', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  DiscoveryController.getUsersByTier
);

// Get tier statistics
router.get('/tier-stats',
  rateLimiter('discovery', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  DiscoveryController.getTierStatistics
);

// Get user's tier information
router.get('/my-tier',
  rateLimiter('discovery', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  DiscoveryController.getUserTierInfo
);

// Get nearby users count by tier
router.get('/nearby-count',
  rateLimiter('discovery', 100, 15 * 60 * 1000), // 100 requests per 15 minutes
  DiscoveryController.getNearbyUsersCount
);

// Search users by location
router.get('/search',
  rateLimiter('discovery', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  DiscoveryController.searchUsersByLocation
);

// Get popular locations
router.get('/popular-locations',
  rateLimiter('discovery', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  DiscoveryController.getPopularLocations
);

// Get users in specific area
router.post('/area',
  rateLimiter('discovery', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  DiscoveryController.getUsersInArea
);

// Get discovery recommendations
router.get('/recommendations',
  rateLimiter('discovery', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  DiscoveryController.getDiscoveryRecommendations
);

// Get user discovery history
router.get('/history',
  rateLimiter('discovery', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  DiscoveryController.getDiscoveryHistory
);

// Clear discovery history
router.delete('/history',
  rateLimiter('discovery', 10, 15 * 60 * 1000), // 10 requests per 15 minutes
  DiscoveryController.clearDiscoveryHistory
);

// Get discovery preferences
router.get('/preferences',
  rateLimiter('discovery', 50, 15 * 60 * 1000), // 50 requests per 15 minutes
  DiscoveryController.getDiscoveryPreferences
);

// Update discovery preferences
router.put('/preferences',
  rateLimiter('discovery', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  DiscoveryController.updateDiscoveryPreferences
);

// Block user from discovery
router.post('/block/:userId',
  rateLimiter('discovery', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  DiscoveryController.blockUserFromDiscovery
);

// Unblock user from discovery
router.delete('/block/:userId',
  rateLimiter('discovery', 20, 15 * 60 * 1000), // 20 requests per 15 minutes
  DiscoveryController.unblockUserFromDiscovery
);

// Get blocked users
router.get('/blocked',
  rateLimiter('discovery', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  DiscoveryController.getBlockedUsers
);

// Report user
router.post('/report/:userId',
  rateLimiter('discovery', 5, 15 * 60 * 1000), // 5 requests per 15 minutes
  DiscoveryController.reportUser
);

// Get discovery analytics
router.get('/analytics',
  rateLimiter('discovery', 30, 15 * 60 * 1000), // 30 requests per 15 minutes
  DiscoveryController.getDiscoveryAnalytics
);

module.exports = router;