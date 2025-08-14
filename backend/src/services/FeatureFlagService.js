const FeatureFlag = require('../models/FeatureFlag');
const User = require('../models/User');
const Analytics = require('../models/Analytics');
const redisManager = require('../utils/redis');
const logger = require('../utils/logger');

class FeatureFlagService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.lastCacheUpdate = 0;
  }

  async initialize() {
    try {
      await this.refreshCache();
      this.setupPeriodicRefresh();
      logger.info('Feature flag service initialized');
    } catch (error) {
      logger.error('Feature flag service initialization failed:', error);
    }
  }

  setupPeriodicRefresh() {
    // Refresh cache every 5 minutes
    setInterval(async () => {
      await this.refreshCache();
    }, this.cacheExpiry);
  }

  async refreshCache() {
    try {
      const flags = await FeatureFlag.find({ isActive: true });
      
      this.cache.clear();
      flags.forEach(flag => {
        this.cache.set(flag.name, flag);
      });
      
      this.lastCacheUpdate = Date.now();
      logger.debug(`Feature flag cache refreshed with ${flags.length} flags`);
    } catch (error) {
      logger.error('Failed to refresh feature flag cache:', error);
    }
  }

  async isFeatureEnabled(featureName, userId = null, context = {}) {
    try {
      const flag = this.cache.get(featureName);
      
      if (!flag || !flag.isActive) {
        return false;
      }

      // Check if feature is globally disabled
      if (flag.globalStatus === 'disabled') {
        return false;
      }

      // Check if feature is globally enabled
      if (flag.globalStatus === 'enabled') {
        return true;
      }

      // Check user-specific overrides
      if (userId && flag.userOverrides) {
        const userOverride = flag.userOverrides.find(override => 
          override.userId.toString() === userId.toString()
        );
        
        if (userOverride) {
          return userOverride.isEnabled;
        }
      }

      // Check tier-based access
      if (userId && flag.tierAccess) {
        const user = await this.getUserTier(userId);
        if (user && flag.tierAccess.includes(user.tier)) {
          return true;
        }
      }

      // Check location-based access
      if (userId && flag.locationAccess && context.location) {
        const hasLocationAccess = await this.checkLocationAccess(
          userId, 
          context.location, 
          flag.locationAccess
        );
        if (hasLocationAccess) {
          return true;
        }
      }

      // Check time-based access
      if (flag.timeAccess) {
        const hasTimeAccess = this.checkTimeAccess(flag.timeAccess);
        if (!hasTimeAccess) {
          return false;
        }
      }

      // Check A/B testing
      if (flag.abTesting && flag.abTesting.isActive) {
        return await this.checkABTesting(featureName, userId, flag.abTesting);
      }

      // Check percentage rollout
      if (flag.percentageRollout && flag.percentageRollout > 0) {
        return await this.checkPercentageRollout(featureName, userId, flag.percentageRollout);
      }

      // Default to disabled
      return false;

    } catch (error) {
      logger.error(`Error checking feature flag ${featureName}:`, error);
      return false;
    }
  }

  async checkABTesting(featureName, userId, abTesting) {
    try {
      if (!userId) return false;

      // Generate consistent hash for user
      const hash = this.generateUserHash(userId, featureName);
      const variant = hash % 100;

      // Determine which variant the user gets
      let currentVariant = 'control';
      let cumulativePercentage = 0;

      for (const variantConfig of abTesting.variants) {
        cumulativePercentage += variantConfig.percentage;
        if (variant < cumulativePercentage) {
          currentVariant = variantConfig.name;
          break;
        }
      }

      // Track A/B testing exposure
      await this.trackABTesting(featureName, userId, currentVariant, abTesting.experimentId);

      // Check if this variant is enabled
      const variantConfig = abTesting.variants.find(v => v.name === currentVariant);
      return variantConfig ? variantConfig.isEnabled : false;

    } catch (error) {
      logger.error('A/B testing check failed:', error);
      return false;
    }
  }

  async checkPercentageRollout(featureName, userId, percentage) {
    try {
      if (!userId) return false;

      // Generate consistent hash for user
      const hash = this.generateUserHash(userId, featureName);
      const userPercentage = hash % 100;

      return userPercentage < percentage;

    } catch (error) {
      logger.error('Percentage rollout check failed:', error);
      return false;
    }
  }

  async checkLocationAccess(userId, location, locationAccess) {
    try {
      const user = await User.findById(userId).select('location tier');
      if (!user || !user.location.coordinates) {
        return false;
      }

      // Check if user is in allowed locations
      for (const allowedLocation of locationAccess) {
        if (allowedLocation.type === 'radius') {
          const distance = this.calculateDistance(
            user.location.coordinates,
            allowedLocation.coordinates
          );
          
          if (distance <= allowedLocation.radius) {
            return true;
          }
        } else if (allowedLocation.type === 'country') {
          if (user.location.country === allowedLocation.country) {
            return true;
          }
        } else if (allowedLocation.type === 'city') {
          if (user.location.city === allowedLocation.city) {
            return true;
          }
        }
      }

      return false;

    } catch (error) {
      logger.error('Location access check failed:', error);
      return false;
    }
  }

  checkTimeAccess(timeAccess) {
    try {
      const now = new Date();
      const currentTime = now.getTime();

      // Check if current time is within allowed window
      if (timeAccess.startTime && timeAccess.endTime) {
        const startTime = new Date(timeAccess.startTime).getTime();
        const endTime = new Date(timeAccess.endTime).getTime();
        
        if (currentTime < startTime || currentTime > endTime) {
          return false;
        }
      }

      // Check day of week restrictions
      if (timeAccess.daysOfWeek && timeAccess.daysOfWeek.length > 0) {
        const currentDay = now.getDay();
        if (!timeAccess.daysOfWeek.includes(currentDay)) {
          return false;
        }
      }

      // Check time of day restrictions
      if (timeAccess.timeOfDay) {
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTimeMinutes = currentHour * 60 + currentMinute;

        if (timeAccess.timeOfDay.start && timeAccess.timeOfDay.end) {
          const startMinutes = timeAccess.timeOfDay.start.hour * 60 + timeAccess.timeOfDay.start.minute;
          const endMinutes = timeAccess.timeOfDay.end.hour * 60 + timeAccess.timeOfDay.end.minute;
          
          if (currentTimeMinutes < startMinutes || currentTimeMinutes > endMinutes) {
            return false;
          }
        }
      }

      return true;

    } catch (error) {
      logger.error('Time access check failed:', error);
      return false;
    }
  }

  async getUserTier(userId) {
    try {
      // Try to get from cache first
      const cacheKey = `user_tier:${userId}`;
      const cachedTier = await redisManager.getClient().get(cacheKey);
      
      if (cachedTier) {
        return JSON.parse(cachedTier);
      }

      // Get from database
      const user = await User.findById(userId).select('tier');
      if (!user) return null;

      const tierData = { tier: user.tier };
      
      // Cache for 10 minutes
      await redisManager.getClient().setex(cacheKey, 600, JSON.stringify(tierData));
      
      return tierData;

    } catch (error) {
      logger.error('Failed to get user tier:', error);
      return null;
    }
  }

  generateUserHash(userId, featureName) {
    // Simple hash function for consistent user assignment
    let hash = 0;
    const str = `${userId}_${featureName}`;
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash);
  }

  calculateDistance(coords1, coords2) {
    const R = 6371; // Earth's radius in km
    const dLat = (coords2[1] - coords1[1]) * Math.PI / 180;
    const dLon = (coords2[0] - coords1[0]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(coords1[1] * Math.PI / 180) * Math.cos(coords2[1] * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  async trackABTesting(featureName, userId, variant, experimentId) {
    try {
      await Analytics.create({
        eventType: 'ab_testing_exposure',
        eventName: 'A/B Testing Exposure',
        eventCategory: 'system',
        userId: userId,
        platform: 'server',
        metadata: {
          featureName,
          variant,
          experimentId
        },
        abTesting: {
          experimentId,
          variant,
          group: 'test',
          isControl: variant === 'control'
        }
      });
    } catch (error) {
      logger.error('Failed to track A/B testing exposure:', error);
    }
  }

  async getFeatureFlagsForUser(userId, context = {}) {
    try {
      const flags = Array.from(this.cache.values());
      const userFlags = {};

      for (const flag of flags) {
        const isEnabled = await this.isFeatureEnabled(flag.name, userId, context);
        userFlags[flag.name] = {
          name: flag.name,
          isEnabled,
          description: flag.description,
          category: flag.category,
          version: flag.version,
          lastUpdated: flag.updatedAt
        };
      }

      return userFlags;

    } catch (error) {
      logger.error('Failed to get feature flags for user:', error);
      return {};
    }
  }

  async createFeatureFlag(flagData) {
    try {
      const flag = new FeatureFlag(flagData);
      await flag.save();
      
      // Refresh cache
      await this.refreshCache();
      
      logger.info(`Feature flag ${flag.name} created`);
      return flag;

    } catch (error) {
      logger.error('Failed to create feature flag:', error);
      throw error;
    }
  }

  async updateFeatureFlag(flagId, updateData) {
    try {
      const flag = await FeatureFlag.findByIdAndUpdate(
        flagId,
        updateData,
        { new: true, runValidators: true }
      );

      if (!flag) {
        throw new Error('Feature flag not found');
      }

      // Refresh cache
      await this.refreshCache();
      
      logger.info(`Feature flag ${flag.name} updated`);
      return flag;

    } catch (error) {
      logger.error('Failed to update feature flag:', error);
      throw error;
    }
  }

  async deleteFeatureFlag(flagId) {
    try {
      const flag = await FeatureFlag.findByIdAndDelete(flagId);
      
      if (!flag) {
        throw new Error('Feature flag not found');
      }

      // Refresh cache
      await this.refreshCache();
      
      logger.info(`Feature flag ${flag.name} deleted`);
      return flag;

    } catch (error) {
      logger.error('Failed to delete feature flag:', error);
      throw error;
    }
  }

  async getFeatureFlagStats(flagName) {
    try {
      const flag = this.cache.get(flagName);
      if (!flag) {
        throw new Error('Feature flag not found');
      }

      // Get usage statistics
      const stats = await Analytics.aggregate([
        {
          $match: {
            'metadata.featureName': flagName,
            eventType: { $in: ['feature_enabled', 'feature_disabled', 'feature_used'] }
          }
        },
        {
          $group: {
            _id: '$eventType',
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        }
      ]);

      // Get A/B testing results if applicable
      let abTestingResults = null;
      if (flag.abTesting && flag.abTesting.isActive) {
        abTestingResults = await Analytics.aggregate([
          {
            $match: {
              'abTesting.experimentId': flag.abTesting.experimentId,
              eventType: 'ab_testing_exposure'
            }
          },
          {
            $group: {
              _id: '$abTesting.variant',
              count: { $sum: 1 },
              uniqueUsers: { $addToSet: '$userId' }
            }
          }
        ]);
      }

      return {
        flagName,
        totalUsage: stats.reduce((sum, stat) => sum + stat.count, 0),
        uniqueUsers: new Set(stats.flatMap(stat => stat.uniqueUsers)).size,
        stats,
        abTestingResults
      };

    } catch (error) {
      logger.error('Failed to get feature flag stats:', error);
      throw error;
    }
  }

  async bulkUpdateFeatureFlags(updates) {
    try {
      const results = [];
      
      for (const update of updates) {
        try {
          const result = await this.updateFeatureFlag(update.flagId, update.data);
          results.push({ success: true, flag: result });
        } catch (error) {
          results.push({ success: false, flagId: update.flagId, error: error.message });
        }
      }

      // Refresh cache after all updates
      await this.refreshCache();
      
      return results;

    } catch (error) {
      logger.error('Bulk update feature flags failed:', error);
      throw error;
    }
  }

  getCacheStats() {
    return {
      totalFlags: this.cache.size,
      lastUpdate: this.lastCacheUpdate,
      cacheAge: Date.now() - this.lastCacheUpdate
    };
  }

  async clearCache() {
    this.cache.clear();
    this.lastCacheUpdate = 0;
    await this.refreshCache();
    logger.info('Feature flag cache cleared');
  }
}

module.exports = new FeatureFlagService();