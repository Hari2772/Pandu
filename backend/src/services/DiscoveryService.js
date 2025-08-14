const User = require('../models/User');
const TierData = require('../models/TierData');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class DiscoveryService {
  constructor() {
    this.tierCache = new Map(); // tier -> tier data
    this.locationCache = new Map(); // coordinates -> nearby users
    this.userTierCache = new Map(); // userId -> tier info
  }

  // Update user location and tier
  async updateUserLocation(userId, coordinates, accuracy, address, placeName) {
    try {
      // Validate coordinates
      if (!coordinates || coordinates.length !== 2) {
        throw new Error('Invalid coordinates');
      }

      const [longitude, latitude] = coordinates;
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error('Coordinates out of range');
      }

      // Update user location
      await User.findByIdAndUpdate(userId, {
        'location.coordinates': coordinates,
        'location.accuracy': accuracy,
        'location.lastUpdated': new Date(),
        'location.address': address,
        'location.placeName': placeName
      });

      // Calculate tier based on location
      const tier = await this.calculateUserTier(coordinates, userId);

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          'location.coordinates': coordinates,
          'location.accuracy': accuracy,
          'location.lastUpdated': new Date(),
          'location.address': address,
          'location.placeName': placeName,
          tier,
          tierName: constants.TIER_NAMES[tier],
          tierDistance: constants.TIER_DISTANCES[tier],
          lastUpdate: new Date()
        },
        { upsert: true }
      );

      // Update cache
      this.userTierCache.set(userId.toString(), {
        tier,
        tierName: constants.TIER_NAMES[tier],
        coordinates,
        lastUpdate: new Date()
      });

      // Clear location cache for this area
      this.clearLocationCache(coordinates);

      // Notify nearby users of location update
      await this.notifyNearbyUsers(userId, coordinates, tier);

      logger.info(`User ${userId} location updated to tier ${tier}`);
      return { tier, tierName: constants.TIER_NAMES[tier] };

    } catch (error) {
      logger.error('Update user location error:', error);
      throw error;
    }
  }

  // Calculate user tier based on location
  async calculateUserTier(coordinates, userId) {
    try {
      // Get user's current tier
      const currentTierData = await TierData.findOne({ userId });
      const currentTier = currentTierData ? currentTierData.tier : 5;

      // Find nearby users in different tiers
      const nearbyUsers = await TierData.find({
        userId: { $ne: userId },
        isActive: true,
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: constants.TIER_DISTANCES[6] // Max tier distance
          }
        }
      }).sort({ 'location.lastUpdated': -1 });

      // Calculate tier based on nearby user density
      let tier = 5; // Default tier
      const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

      nearbyUsers.forEach(user => {
        if (user.tier && user.tier >= 1 && user.tier <= 6) {
          tierCounts[user.tier]++;
        }
      });

      // Tier calculation logic
      const totalNearby = Object.values(tierCounts).reduce((a, b) => a + b, 0);
      
      if (totalNearby === 0) {
        tier = 5; // No nearby users, default tier
      } else if (totalNearby >= 50) {
        tier = 1; // Very high density
      } else if (totalNearby >= 30) {
        tier = 2; // High density
      } else if (totalNearby >= 20) {
        tier = 3; // Medium-high density
      } else if (totalNearby >= 10) {
        tier = 4; // Medium density
      } else if (totalNearby >= 5) {
        tier = 5; // Low-medium density
      } else {
        tier = 6; // Low density
      }

      // Consider user's current tier for stability
      if (Math.abs(tier - currentTier) <= 1) {
        tier = currentTier; // Keep current tier if change is small
      }

      return tier;

    } catch (error) {
      logger.error('Calculate user tier error:', error);
      return 5; // Default tier on error
    }
  }

  // Discover nearby users
  async discoverNearbyUsers(userId, options = {}) {
    try {
      const {
        tier = null,
        radius = null,
        limit = 50,
        includeOffline = false,
        minTier = 1,
        maxTier = 6
      } = options;

      // Get user's location and tier
      const user = await User.findById(userId);
      if (!user || !user.location || !user.location.coordinates) {
        throw new Error('User location not available');
      }

      const userTier = user.tier || 5;
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
      if (tier !== null) {
        query.tier = tier;
      } else {
        query.tier = { $gte: minTier, $lte: maxTier };
      }

      // Filter by online status
      if (!includeOffline) {
        query.isOnline = true;
      }

      // Get nearby users
      const nearbyUsers = await TierData.find(query)
        .populate('userId', 'username displayName profilePicture bio isOnline lastSeen')
        .limit(limit)
        .sort({ 'location.lastUpdated': -1 });

      // Calculate distances and format response
      const usersWithDistance = nearbyUsers.map(userData => {
        const distance = this.calculateDistance(
          user.location.coordinates,
          userData.location.coordinates
        );

        return {
          id: userData.userId._id,
          username: userData.userId.username,
          displayName: userData.userId.displayName,
          profilePicture: userData.userId.profilePicture,
          bio: userData.userId.bio,
          tier: userData.tier,
          tierName: userData.tierName,
          distance: Math.round(distance),
          coordinates: userData.location.coordinates,
          isOnline: userData.userId.isOnline,
          lastSeen: userData.userId.lastSeen,
          lastLocationUpdate: userData.location.lastUpdated
        };
      });

      // Sort by distance
      usersWithDistance.sort((a, b) => a.distance - b.distance);

      // Cache results
      this.cacheLocationResults(user.location.coordinates, usersWithDistance);

      logger.info(`Discovered ${usersWithDistance.length} nearby users for user ${userId}`);
      return usersWithDistance;

    } catch (error) {
      logger.error('Discover nearby users error:', error);
      throw error;
    }
  }

  // Get users by tier
  async getUsersByTier(tier, options = {}) {
    try {
      const { page = 1, limit = 50, includeOffline = false } = options;

      if (tier < 1 || tier > 6) {
        throw new Error('Invalid tier number');
      }

      // Build query
      let query = {
        tier,
        isActive: true
      };

      if (!includeOffline) {
        query.isOnline = true;
      }

      // Get users
      const users = await TierData.find(query)
        .populate('userId', 'username displayName profilePicture bio isOnline lastSeen')
        .sort({ lastUpdate: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      // Format response
      const formattedUsers = users.map(userData => ({
        id: userData.userId._id,
        username: userData.userId.username,
        displayName: userData.userId.displayName,
        profilePicture: userData.userId.profilePicture,
        bio: userData.userId.bio,
        tier: userData.tier,
        tierName: userData.tierName,
        coordinates: userData.location.coordinates,
        isOnline: userData.userId.isOnline,
        lastSeen: userData.userId.lastSeen,
        lastLocationUpdate: userData.location.lastUpdated
      }));

      // Get total count
      const total = await TierData.countDocuments(query);

      return {
        users: formattedUsers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      logger.error('Get users by tier error:', error);
      throw error;
    }
  }

  // Get tier statistics
  async getTierStatistics() {
    try {
      const stats = await TierData.aggregate([
        { $match: { isActive: true } },
        {
          $group: {
            _id: '$tier',
            count: { $sum: 1 },
            onlineCount: {
              $sum: { $cond: ['$isOnline', 1, 0] }
            },
            avgLastUpdate: { $avg: '$lastUpdate' }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Format statistics
      const tierStats = {};
      for (let i = 1; i <= 6; i++) {
        const tierData = stats.find(s => s._id === i);
        tierStats[i] = {
          tier: i,
          tierName: constants.TIER_NAMES[i],
          totalUsers: tierData ? tierData.count : 0,
          onlineUsers: tierData ? tierData.onlineCount : 0,
          avgLastUpdate: tierData ? tierData.avgLastUpdate : null,
          tierDistance: constants.TIER_DISTANCES[i]
        };
      }

      return tierStats;

    } catch (error) {
      logger.error('Get tier statistics error:', error);
      throw error;
    }
  }

  // Get user's tier information
  async getUserTierInfo(userId) {
    try {
      // Check cache first
      if (this.userTierCache.has(userId.toString())) {
        const cached = this.userTierCache.get(userId.toString());
        if (Date.now() - cached.lastUpdate.getTime() < 300000) { // 5 minutes
          return cached;
        }
      }

      // Get from database
      const tierData = await TierData.findOne({ userId });
      if (!tierData) {
        throw new Error('User tier data not found');
      }

      const tierInfo = {
        tier: tierData.tier,
        tierName: tierData.tierName,
        tierDistance: tierData.tierDistance,
        coordinates: tierData.location.coordinates,
        lastUpdate: tierData.lastUpdate
      };

      // Update cache
      this.userTierCache.set(userId.toString(), tierInfo);

      return tierInfo;

    } catch (error) {
      logger.error('Get user tier info error:', error);
      throw error;
    }
  }

  // Update user tier manually (admin function)
  async updateUserTier(userId, newTier, reason = '') {
    try {
      if (newTier < 1 || newTier > 6) {
        throw new Error('Invalid tier number');
      }

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          tier: newTier,
          tierName: constants.TIER_NAMES[newTier],
          tierDistance: constants.TIER_DISTANCES[newTier],
          tierUpdateReason: reason,
          tierUpdatedAt: new Date(),
          lastUpdate: new Date()
        }
      );

      // Update user model
      await User.findByIdAndUpdate(userId, {
        tier: newTier
      });

      // Update cache
      this.userTierCache.set(userId.toString(), {
        tier: newTier,
        tierName: constants.TIER_NAMES[newTier],
        tierDistance: constants.TIER_DISTANCES[newTier],
        lastUpdate: new Date()
      });

      logger.info(`User ${userId} tier updated to ${newTier} by admin`);
      return { tier: newTier, tierName: constants.TIER_NAMES[newTier] };

    } catch (error) {
      logger.error('Update user tier error:', error);
      throw error;
    }
  }

  // Get nearby users count by tier
  async getNearbyUsersCount(userId, radius = null) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.location || !user.location.coordinates) {
        return { total: 0, byTier: {} };
      }

      const searchRadius = radius || constants.TIER_DISTANCES[user.tier || 5];

      const counts = await TierData.aggregate([
        {
          $match: {
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
          }
        },
        {
          $group: {
            _id: '$tier',
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Format response
      const byTier = {};
      let total = 0;

      for (let i = 1; i <= 6; i++) {
        const tierData = counts.find(c => c._id === i);
        byTier[i] = tierData ? tierData.count : 0;
        total += byTier[i];
      }

      return { total, byTier };

    } catch (error) {
      logger.error('Get nearby users count error:', error);
      return { total: 0, byTier: {} };
    }
  }

  // Helper methods
  calculateDistance(coords1, coords2) {
    try {
      const [lon1, lat1] = coords1;
      const [lon2, lat2] = coords2;

      const R = 6371; // Earth's radius in kilometers
      const dLat = this.toRadians(lat2 - lat1);
      const dLon = this.toRadians(lon2 - lon1);

      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      return distance;
    } catch (error) {
      logger.error('Calculate distance error:', error);
      return 0;
    }
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  cacheLocationResults(coordinates, results) {
    try {
      const key = `${Math.round(coordinates[0] * 100) / 100},${Math.round(coordinates[1] * 100) / 100}`;
      this.locationCache.set(key, {
        results,
        timestamp: Date.now()
      });

      // Limit cache size
      if (this.locationCache.size > 1000) {
        const firstKey = this.locationCache.keys().next().value;
        this.locationCache.delete(firstKey);
      }
    } catch (error) {
      logger.error('Cache location results error:', error);
    }
  }

  clearLocationCache(coordinates) {
    try {
      const key = `${Math.round(coordinates[0] * 100) / 100},${Math.round(coordinates[1] * 100) / 100}`;
      this.locationCache.delete(key);
    } catch (error) {
      logger.error('Clear location cache error:', error);
    }
  }

  async notifyNearbyUsers(userId, coordinates, tier) {
    try {
      // Find users in nearby tiers
      const nearbyUsers = await TierData.find({
        userId: { $ne: userId },
        isActive: true,
        isOnline: true,
        $or: [
          { tier: tier },
          { tier: tier - 1 },
          { tier: tier + 1 }
        ].filter(t => t >= 1 && t <= 6),
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: constants.TIER_DISTANCES[Math.max(tier, 6)]
          }
        }
      }).limit(20);

      // Store notifications in Redis for real-time delivery
      for (const user of nearbyUsers) {
        await redisManager.getClient().lpush(
          `notifications:${user.userId}`,
          JSON.stringify({
            type: 'nearby_user_update',
            userId,
            coordinates,
            tier,
            timestamp: new Date()
          })
        );
      }

    } catch (error) {
      logger.error('Notify nearby users error:', error);
    }
  }

  // Get service statistics
  getServiceStats() {
    return {
      tierCacheSize: this.tierCache.size,
      locationCacheSize: this.locationCache.size,
      userTierCacheSize: this.userTierCache.size
    };
  }

  // Clean up expired cache data
  async cleanupExpiredCache() {
    try {
      const now = Date.now();
      const expiryTime = 30 * 60 * 1000; // 30 minutes

      // Clean up location cache
      for (const [key, data] of this.locationCache.entries()) {
        if (now - data.timestamp > expiryTime) {
          this.locationCache.delete(key);
        }
      }

      // Clean up user tier cache
      for (const [key, data] of this.userTierCache.entries()) {
        if (now - data.lastUpdate.getTime() > expiryTime) {
          this.userTierCache.delete(key);
        }
      }

      logger.info('Discovery service cache cleanup completed');

    } catch (error) {
      logger.error('Discovery service cache cleanup error:', error);
    }
  }
}

module.exports = DiscoveryService;