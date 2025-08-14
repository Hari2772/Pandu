const User = require('../models/User');
const TierData = require('../models/TierData');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class DiscoveryService {
  constructor() {
    this.nearbyUsersCache = new Map(); // userId -> nearby users cache
    this.tierUpdates = new Map(); // tier -> last update timestamp
    this.discoveryStats = new Map(); // userId -> discovery stats
  }

  // Update user location and tier
  async updateUserLocation(userId, coordinates, accuracy, address, placeName) {
    try {
      // Update user location
      await User.findByIdAndUpdate(userId, {
        'location.coordinates': coordinates,
        'location.accuracy': accuracy,
        'location.lastUpdated': new Date(),
        'location.address': address,
        'location.placeName': placeName
      });

      // Update tier data
      const tierData = await TierData.findOne({ userId });
      if (tierData) {
        tierData.updateLocation(coordinates, accuracy, address, placeName);
        await tierData.save();
      }

      // Clear nearby users cache for this user
      this.nearbyUsersCache.delete(userId);

      // Update discovery stats
      this.updateDiscoveryStats(userId, 'location_update');

      logger.info(`Location updated for user ${userId}`);

      return true;
    } catch (error) {
      logger.error('Update user location error:', error);
      throw error;
    }
  }

  // Get nearby users based on tier
  async getNearbyUsers(userId, options = {}) {
    try {
      const {
        tier = null,
        radius = null,
        limit = 50,
        includeOffline = false,
        excludeFriends = false,
        excludeBlocked = false,
        minAge = null,
        maxAge = null,
        interests = [],
        gender = null
      } = options;

      // Get user's current tier and location
      const user = await User.findById(userId);
      if (!user || !user.location || !user.location.coordinates) {
        return [];
      }

      const userTier = tier || user.tier || 5;
      const searchRadius = radius || constants.TIER_DISTANCES[userTier];

      // Build query
      let query = {
        userId: { $ne: userId },
        isActive: true,
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: user.location.coordinates
            },
            $maxDistance: searchRadius
          }
        }
      };

      // Filter by tier if specified
      if (tier) {
        query.tier = tier;
      }

      // Filter by online status
      if (!includeOffline) {
        query.isOnline = true;
      }

      // Get nearby users
      let nearbyUsers = await TierData.find(query)
        .populate('userId', 'username displayName profilePicture bio dateOfBirth gender interests')
        .limit(limit)
        .sort({ 'location.lastUpdated': -1 });

      // Apply additional filters
      if (excludeFriends || excludeBlocked || minAge || maxAge || interests.length > 0 || gender) {
        const userIds = nearbyUsers.map(u => u.userId._id);
        const userDetails = await User.find({
          _id: { $in: userIds }
        }).select('friends blockedUsers dateOfBirth interests gender');

        nearbyUsers = nearbyUsers.filter(tierData => {
          const userDetail = userDetails.find(u => u._id.toString() === tierData.userId._id.toString());
          if (!userDetail) return false;

          // Exclude friends
          if (excludeFriends && userDetail.friends.some(f => f.userId.toString() === userId)) {
            return false;
          }

          // Exclude blocked users
          if (excludeBlocked && userDetail.blockedUsers.some(b => b.userId.toString() === userId)) {
            return false;
          }

          // Filter by age
          if (minAge || maxAge) {
            const age = this.calculateAge(userDetail.dateOfBirth);
            if (minAge && age < minAge) return false;
            if (maxAge && age > maxAge) return false;
          }

          // Filter by interests
          if (interests.length > 0) {
            const userInterests = userDetail.interests || [];
            const hasCommonInterest = interests.some(interest => 
              userInterests.includes(interest)
            );
            if (!hasCommonInterest) return false;
          }

          // Filter by gender
          if (gender && userDetail.gender !== gender) {
            return false;
          }

          return true;
        });
      }

      // Calculate distances and enrich data
      const enrichedUsers = nearbyUsers.map(tierData => {
        const distance = this.calculateDistance(
          user.location.coordinates,
          tierData.location.coordinates
        );

        return {
          id: tierData.userId._id,
          username: tierData.userId.username,
          displayName: tierData.userId.displayName,
          profilePicture: tierData.userId.profilePicture,
          bio: tierData.userId.bio,
          tier: tierData.tier,
          tierName: tierData.tierName,
          distance: Math.round(distance),
          isOnline: tierData.isOnline,
          lastSeen: tierData.lastSeen,
          lastUpdate: tierData.lastUpdate,
          interests: tierData.userId.interests || [],
          age: tierData.userId.dateOfBirth ? this.calculateAge(tierData.userId.dateOfBirth) : null
        };
      });

      // Sort by distance
      enrichedUsers.sort((a, b) => a.distance - b.distance);

      // Cache results
      this.nearbyUsersCache.set(userId, {
        users: enrichedUsers,
        timestamp: new Date(),
        options
      });

      // Update discovery stats
      this.updateDiscoveryStats(userId, 'discovery_request', enrichedUsers.length);

      return enrichedUsers;
    } catch (error) {
      logger.error('Get nearby users error:', error);
      throw error;
    }
  }

  // Get users by tier
  async getUsersByTier(tier, options = {}) {
    try {
      const { page = 1, limit = 50, includeOffline = false, sortBy = 'lastUpdate' } = options;

      let query = {
        tier,
        isActive: true
      };

      if (!includeOffline) {
        query.isOnline = true;
      }

      const users = await TierData.find(query)
        .populate('userId', 'username displayName profilePicture bio')
        .sort({ [sortBy]: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      return users.map(tierData => ({
        id: tierData.userId._id,
        username: tierData.userId.username,
        displayName: tierData.userId.displayName,
        profilePicture: tierData.userId.profilePicture,
        bio: tierData.userId.bio,
        tier: tierData.tier,
        tierName: tierData.tierName,
        isOnline: tierData.isOnline,
        lastSeen: tierData.lastSeen,
        lastUpdate: tierData.lastUpdate
      }));
    } catch (error) {
      logger.error('Get users by tier error:', error);
      throw error;
    }
  }

  // Get tier statistics
  async getTierStatistics() {
    try {
      const stats = await TierData.aggregate([
        {
          $group: {
            _id: '$tier',
            userCount: { $sum: 1 },
            onlineCount: {
              $sum: { $cond: ['$isOnline', 1, 0] }
            },
            avgDistance: { $avg: '$tierDistance' }
          }
        },
        {
          $project: {
            tier: '$_id',
            userCount: 1,
            onlineCount: 1,
            avgDistance: { $round: ['$avgDistance', 2] },
            tierName: {
              $switch: {
                branches: [
                  { case: { $eq: ['$_id', 1] }, then: 'Immediate' },
                  { case: { $eq: ['$_id', 2] }, then: 'Very Close' },
                  { case: { $eq: ['$_id', 3] }, then: 'Close' },
                  { case: { $eq: ['$_id', 4] }, then: 'Nearby' },
                  { case: { $eq: ['$_id', 5] }, then: 'Regional' },
                  { case: { $eq: ['$_id', 6] }, then: 'Extended' }
                ],
                default: 'Unknown'
              }
            }
          }
        },
        { $sort: { tier: 1 } }
      ]);

      return stats;
    } catch (error) {
      logger.error('Get tier statistics error:', error);
      throw error;
    }
  }

  // Get user discovery stats
  async getUserDiscoveryStats(userId) {
    try {
      const stats = this.discoveryStats.get(userId) || {
        totalRequests: 0,
        totalUsersFound: 0,
        lastRequest: null,
        favoriteTiers: new Map(),
        averageDistance: 0
      };

      // Get recent discovery history from Redis
      const recentDiscoveries = await redisManager.getClient().lrange(
        `discovery:${userId}:history`,
        0, 9
      );

      const history = recentDiscoveries.map(discovery => JSON.parse(discovery));

      return {
        ...stats,
        history,
        lastRequest: stats.lastRequest ? new Date(stats.lastRequest) : null
      };
    } catch (error) {
      logger.error('Get user discovery stats error:', error);
      return {};
    }
  }

  // Get popular locations
  async getPopularLocations(options = {}) {
    try {
      const { limit = 20, radius = 10000 } = options;

      const locations = await TierData.aggregate([
        {
          $match: {
            'location.coordinates': { $exists: true },
            isActive: true
          }
        },
        {
          $group: {
            _id: {
              city: '$location.city',
              coordinates: '$location.coordinates'
            },
            userCount: { $sum: 1 },
            onlineCount: {
              $sum: { $cond: ['$isOnline', 1, 0] }
            },
            tiers: { $addToSet: '$tier' }
          }
        },
        {
          $project: {
            city: '$_id.city',
            coordinates: '$_id.coordinates',
            userCount: 1,
            onlineCount: 1,
            tierCount: { $size: '$tiers' },
            avgTier: { $avg: '$tiers' }
          }
        },
        { $sort: { userCount: -1 } },
        { $limit: limit }
      ]);

      return locations;
    } catch (error) {
      logger.error('Get popular locations error:', error);
      throw error;
    }
  }

  // Get users in specific area
  async getUsersInArea(coordinates, radius, options = {}) {
    try {
      const { limit = 100, includeOffline = false, minTier = 1, maxTier = 6 } = options;

      let query = {
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: radius
          }
        },
        tier: { $gte: minTier, $lte: maxTier },
        isActive: true
      };

      if (!includeOffline) {
        query.isOnline = true;
      }

      const users = await TierData.find(query)
        .populate('userId', 'username displayName profilePicture bio')
        .limit(limit)
        .sort({ 'location.lastUpdated': -1 });

      return users.map(tierData => {
        const distance = this.calculateDistance(coordinates, tierData.location.coordinates);
        
        return {
          id: tierData.userId._id,
          username: tierData.userId.username,
          displayName: tierData.userId.displayName,
          profilePicture: tierData.userId.profilePicture,
          bio: tierData.userId.bio,
          tier: tierData.tier,
          tierName: tierData.tierName,
          distance: Math.round(distance),
          isOnline: tierData.isOnline,
          lastSeen: tierData.lastSeen,
          coordinates: tierData.location.coordinates
        };
      });
    } catch (error) {
      logger.error('Get users in area error:', error);
      throw error;
    }
  }

  // Get discovery recommendations
  async getDiscoveryRecommendations(userId, options = {}) {
    try {
      const { limit = 20, excludeRecent = true } = options;

      // Get user's recent discoveries
      let excludeUserIds = [userId];
      if (excludeRecent) {
        const recentDiscoveries = await redisManager.getClient().lrange(
          `discovery:${userId}:recent`,
          0, 49
        );
        excludeUserIds.push(...recentDiscoveries.map(id => id.toString()));
      }

      // Get user's current location and preferences
      const user = await User.findById(userId);
      if (!user || !user.location) {
        return [];
      }

      // Get recommendations based on location and interests
      const recommendations = await TierData.aggregate([
        {
          $match: {
            userId: { $nin: excludeUserIds.map(id => require('mongoose').Types.ObjectId(id)) },
            isActive: true,
            isOnline: true,
            'location.coordinates': { $exists: true }
          }
        },
        {
          $addFields: {
            distance: {
              $geoNear: {
                near: user.location.coordinates,
                distanceField: 'distance',
                spherical: true
              }
            }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'userDetails'
          }
        },
        {
          $unwind: '$userDetails'
        },
        {
          $addFields: {
            interestMatch: {
              $size: {
                $setIntersection: [
                  user.interests || [],
                  '$userDetails.interests'
                ]
              }
          }
        },
        {
          $sort: {
            interestMatch: -1,
            distance: 1
          }
        },
        { $limit: limit }
      ]);

      return recommendations.map(rec => ({
        id: rec.userId,
        username: rec.userDetails.username,
        displayName: rec.userDetails.displayName,
        profilePicture: rec.userDetails.profilePicture,
        bio: rec.userDetails.bio,
        tier: rec.tier,
        tierName: rec.tierName,
        distance: Math.round(rec.distance),
        interestMatch: rec.interestMatch,
        interests: rec.userDetails.interests || []
      }));
    } catch (error) {
      logger.error('Get discovery recommendations error:', error);
      throw error;
    }
  }

  // Update discovery stats
  updateDiscoveryStats(userId, action, data = null) {
    try {
      if (!this.discoveryStats.has(userId)) {
        this.discoveryStats.set(userId, {
          totalRequests: 0,
          totalUsersFound: 0,
          lastRequest: null,
          favoriteTiers: new Map(),
          averageDistance: 0
        });
      }

      const stats = this.discoveryStats.get(userId);

      switch (action) {
        case 'discovery_request':
          stats.totalRequests++;
          stats.lastRequest = new Date();
          if (data) {
            stats.totalUsersFound += data;
            // Update average distance if available
            // This would require more complex calculation
          }
          break;

        case 'location_update':
          stats.lastRequest = new Date();
          break;

        case 'tier_change':
          if (data) {
            const currentCount = stats.favoriteTiers.get(data) || 0;
            stats.favoriteTiers.set(data, currentCount + 1);
          }
          break;
      }

      this.discoveryStats.set(userId, stats);
    } catch (error) {
      logger.error('Update discovery stats error:', error);
    }
  }

  // Calculate distance between two coordinates
  calculateDistance(coord1, coord2) {
    try {
      const R = 6371; // Earth's radius in kilometers
      const dLat = this.deg2rad(coord2[1] - coord1[1]);
      const dLon = this.deg2rad(coord2[0] - coord1[0]);
      
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(this.deg2rad(coord1[1])) * Math.cos(this.deg2rad(coord2[1])) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c; // Distance in kilometers
      
      return distance * 1000; // Convert to meters
    } catch (error) {
      logger.error('Calculate distance error:', error);
      return 0;
    }
  }

  // Convert degrees to radians
  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  // Calculate age from date of birth
  calculateAge(dateOfBirth) {
    try {
      if (!dateOfBirth) return null;
      
      const today = new Date();
      const birthDate = new Date(dateOfBirth);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      return age;
    } catch (error) {
      logger.error('Calculate age error:', error);
      return null;
    }
  }

  // Cleanup old cache entries
  cleanupCache() {
    try {
      const now = Date.now();
      const cacheTimeout = 5 * 60 * 1000; // 5 minutes

      for (const [userId, cache] of this.nearbyUsersCache.entries()) {
        if (now - cache.timestamp > cacheTimeout) {
          this.nearbyUsersCache.delete(userId);
        }
      }

      // Cleanup old discovery stats
      const statsTimeout = 24 * 60 * 60 * 1000; // 24 hours
      for (const [userId, stats] of this.discoveryStats.entries()) {
        if (stats.lastRequest && (now - stats.lastRequest) > statsTimeout) {
          this.discoveryStats.delete(userId);
        }
      }
    } catch (error) {
      logger.error('Cleanup cache error:', error);
    }
  }

  // Get service health status
  getHealthStatus() {
    return {
      nearbyUsersCacheSize: this.nearbyUsersCache.size,
      discoveryStatsSize: this.discoveryStats.size,
      tierUpdatesSize: this.tierUpdates.size,
      timestamp: new Date()
    };
  }
}

module.exports = DiscoveryService;