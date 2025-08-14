const express = require('express');
const router = express.Router();
const DiscoveryService = require('../services/DiscoveryService');
const { authenticateToken } = require('../middleware/auth');
const { validateLocationData } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const discoveryService = new DiscoveryService();

// Apply rate limiting to discovery routes
router.use(rateLimiter('discovery', 50, 60)); // 50 requests per minute

// Get nearby users
router.get('/nearby', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      tier,
      radius,
      limit = 50,
      includeOffline = false,
      excludeFriends = false,
      excludeBlocked = false,
      minAge,
      maxAge,
      interests,
      gender
    } = req.query;

    const nearbyUsers = await discoveryService.getNearbyUsers(userId, {
      tier: tier ? parseInt(tier) : null,
      radius: radius ? parseInt(radius) : null,
      limit: parseInt(limit),
      includeOffline: includeOffline === 'true',
      excludeFriends: excludeFriends === 'true',
      excludeBlocked: excludeBlocked === 'true',
      minAge: minAge ? parseInt(minAge) : null,
      maxAge: maxAge ? parseInt(maxAge) : null,
      interests: interests ? interests.split(',') : [],
      gender: gender || null
    });

    res.json({
      success: true,
      data: {
        users: nearbyUsers,
        count: nearbyUsers.length,
        filters: {
          tier,
          radius,
          includeOffline,
          excludeFriends,
          excludeBlocked,
          minAge,
          maxAge,
          interests,
          gender
        }
      }
    });

  } catch (error) {
    logger.error('Get nearby users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get users by tier
router.get('/tier/:tier', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tier } = req.params;
    const { page = 1, limit = 50, includeOffline = false, sortBy = 'lastUpdate' } = req.query;

    if (tier < 1 || tier > 6) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tier. Must be between 1 and 6'
      });
    }

    const users = await discoveryService.getUsersByTier(parseInt(tier), {
      page: parseInt(page),
      limit: parseInt(limit),
      includeOffline: includeOffline === 'true',
      sortBy
    });

    res.json({
      success: true,
      data: {
        users,
        tier: parseInt(tier),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: users.length
        }
      }
    });

  } catch (error) {
    logger.error('Get users by tier error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users by tier',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get tier statistics
router.get('/tier-stats', authenticateToken, async (req, res) => {
  try {
    const stats = await discoveryService.getTierStatistics();

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    logger.error('Get tier statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tier statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update user location
router.put('/location', authenticateToken, validateLocationData, async (req, res) => {
  try {
    const userId = req.user.id;
    const { coordinates, accuracy, address, placeName } = req.body;

    if (!coordinates || coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Valid coordinates are required'
      });
    }

    await discoveryService.updateUserLocation(userId, coordinates, accuracy, address, placeName);

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        coordinates,
        accuracy,
        address,
        placeName,
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user discovery stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await discoveryService.getUserDiscoveryStats(userId);

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    logger.error('Get discovery stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get discovery statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get popular locations
router.get('/popular-locations', authenticateToken, async (req, res) => {
  try {
    const { limit = 20, radius = 10000 } = req.query;

    const locations = await discoveryService.getPopularLocations({
      limit: parseInt(limit),
      radius: parseInt(radius)
    });

    res.json({
      success: true,
      data: {
        locations,
        count: locations.length
      }
    });

  } catch (error) {
    logger.error('Get popular locations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get popular locations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get users in specific area
router.post('/area', authenticateToken, async (req, res) => {
  try {
    const { coordinates, radius, limit = 100, includeOffline = false, minTier = 1, maxTier = 6 } = req.body;

    if (!coordinates || coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Valid coordinates are required'
      });
    }

    if (!radius || radius <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid radius is required'
      });
    }

    const users = await discoveryService.getUsersInArea(coordinates, radius, {
      limit: parseInt(limit),
      includeOffline,
      minTier: parseInt(minTier),
      maxTier: parseInt(maxTier)
    });

    res.json({
      success: true,
      data: {
        users,
        count: users.length,
        area: {
          coordinates,
          radius,
          minTier: parseInt(minTier),
          maxTier: parseInt(maxTier)
        }
      }
    });

  } catch (error) {
    logger.error('Get users in area error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users in area',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get discovery recommendations
router.get('/recommendations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, excludeRecent = true } = req.query;

    const recommendations = await discoveryService.getDiscoveryRecommendations(userId, {
      limit: parseInt(limit),
      excludeRecent: excludeRecent === 'true'
    });

    res.json({
      success: true,
      data: {
        recommendations,
        count: recommendations.length
      }
    });

  } catch (error) {
    logger.error('Get recommendations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recommendations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search users by interests
router.get('/search/interests', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { interests, page = 1, limit = 50, tier } = req.query;

    if (!interests) {
      return res.status(400).json({
        success: false,
        message: 'Interests are required'
      });
    }

    const interestList = interests.split(',');
    const nearbyUsers = await discoveryService.getNearbyUsers(userId, {
      tier: tier ? parseInt(tier) : null,
      interests: interestList,
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: {
        users: nearbyUsers,
        count: nearbyUsers.length,
        searchCriteria: {
          interests: interestList,
          tier: tier ? parseInt(tier) : null
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: nearbyUsers.length
        }
      }
    });

  } catch (error) {
    logger.error('Search users by interests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users by interests',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search users by age range
router.get('/search/age', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { minAge, maxAge, page = 1, limit = 50, tier } = req.query;

    if (!minAge && !maxAge) {
      return res.status(400).json({
        success: false,
        message: 'At least one age parameter is required'
      });
    }

    const nearbyUsers = await discoveryService.getNearbyUsers(userId, {
      tier: tier ? parseInt(tier) : null,
      minAge: minAge ? parseInt(minAge) : null,
      maxAge: maxAge ? parseInt(maxAge) : null,
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: {
        users: nearbyUsers,
        count: nearbyUsers.length,
        searchCriteria: {
          minAge: minAge ? parseInt(minAge) : null,
          maxAge: maxAge ? parseInt(maxAge) : null,
          tier: tier ? parseInt(tier) : null
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: nearbyUsers.length
        }
      }
    });

  } catch (error) {
    logger.error('Search users by age error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users by age',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get discovery preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's discovery preferences from database
    const User = require('../models/User');
    const user = await User.findById(userId).select('discoveryPreferences');

    res.json({
      success: true,
      data: {
        preferences: user.discoveryPreferences || {}
      }
    });

  } catch (error) {
    logger.error('Get discovery preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get discovery preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update discovery preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Valid preferences object is required'
      });
    }

    // Update user's discovery preferences
    const User = require('../models/User');
    await User.findByIdAndUpdate(userId, {
      discoveryPreferences: preferences
    });

    res.json({
      success: true,
      message: 'Discovery preferences updated successfully',
      data: { preferences }
    });

  } catch (error) {
    logger.error('Update discovery preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update discovery preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get discovery history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    // Get discovery history from Redis
    const redisManager = require('../config/redis');
    const history = await redisManager.getClient().lrange(
      `discovery:${userId}:history`,
      (page - 1) * limit,
      page * limit - 1
    );

    const parsedHistory = history.map(item => JSON.parse(item));

    res.json({
      success: true,
      data: {
        history: parsedHistory,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parsedHistory.length
        }
      }
    });

  } catch (error) {
    logger.error('Get discovery history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get discovery history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Clear discovery history
router.delete('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Clear discovery history from Redis
    const redisManager = require('../config/redis');
    await redisManager.getClient().del(`discovery:${userId}:history`);

    res.json({
      success: true,
      message: 'Discovery history cleared successfully'
    });

  } catch (error) {
    logger.error('Clear discovery history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear discovery history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;