const FeatureFlag = require('../models/FeatureFlag');
const User = require('../models/User');
const Analytics = require('../models/Analytics');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class FeatureFlagService {
  constructor() {
    this.featureCache = new Map(); // featureName -> featureData
    this.userFeatureCache = new Map(); // userId -> Map of featureName -> enabled
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.lastCacheUpdate = 0;
  }

  // Feature Flag Management
  async createFeatureFlag(featureData) {
    try {
      const {
        name,
        description,
        type = 'boolean',
        defaultValue = false,
        rolloutPercentage = 0,
        targetUsers = [],
        targetTiers = [],
        targetPlatforms = [],
        targetRegions = [],
        conditions = {},
        metadata = {}
      } = featureData;

      // Validate feature name uniqueness
      const existingFeature = await FeatureFlag.findOne({ name });
      if (existingFeature) {
        throw new Error('Feature flag with this name already exists');
      }

      // Create feature flag
      const featureFlag = new FeatureFlag({
        name,
        description,
        type,
        defaultValue,
        rolloutPercentage,
        targetUsers,
        targetTiers,
        targetPlatforms,
        targetRegions,
        conditions,
        metadata,
        status: 'draft',
        createdBy: featureData.createdBy,
        version: 1
      });

      await featureFlag.save();

      // Clear cache
      this.clearCache();

      // Track analytics
      await Analytics.create({
        eventType: 'feature_enabled',
        eventName: 'Feature Flag Created',
        eventCategory: 'system',
        userId: featureData.createdBy,
        platform: 'service',
        metadata: {
          featureName: name,
          featureType: type,
          rolloutPercentage,
          targetUserCount: targetUsers.length,
          targetTierCount: targetTiers.length
        }
      });

      logger.info(`Feature flag created: ${name} (${featureFlag._id})`);
      return featureFlag;

    } catch (error) {
      logger.error('Create feature flag error:', error);
      throw error;
    }
  }

  async updateFeatureFlag(featureId, updateData) {
    try {
      const featureFlag = await FeatureFlag.findById(featureId);
      if (!featureFlag) {
        throw new Error('Feature flag not found');
      }

      // Increment version
      updateData.version = featureFlag.version + 1;
      updateData.updatedAt = new Date();

      // Update feature flag
      const updatedFeature = await FeatureFlag.findByIdAndUpdate(
        featureId,
        updateData,
        { new: true, runValidators: true }
      );

      // Clear cache
      this.clearCache();

      // Track analytics
      await Analytics.create({
        eventType: 'feature_enabled',
        eventName: 'Feature Flag Updated',
        eventCategory: 'system',
        userId: updateData.updatedBy || 'system',
        platform: 'service',
        metadata: {
          featureId,
          featureName: featureFlag.name,
          updatedFields: Object.keys(updateData),
          previousVersion: featureFlag.version,
          newVersion: updatedFeature.version
        }
      });

      logger.info(`Feature flag updated: ${featureFlag.name} (${featureId})`);
      return updatedFeature;

    } catch (error) {
      logger.error('Update feature flag error:', error);
      throw error;
    }
  }

  async deleteFeatureFlag(featureId, deletedBy) {
    try {
      const featureFlag = await FeatureFlag.findById(featureId);
      if (!featureFlag) {
        throw new Error('Feature flag not found');
      }

      // Soft delete
      featureFlag.isDeleted = true;
      featureFlag.deletedAt = new Date();
      featureFlag.deletedBy = deletedBy;
      featureFlag.status = 'deleted';
      await featureFlag.save();

      // Clear cache
      this.clearCache();

      // Track analytics
      await Analytics.create({
        eventType: 'feature_disabled',
        eventName: 'Feature Flag Deleted',
        eventCategory: 'system',
        userId: deletedBy,
        platform: 'service',
        metadata: {
          featureId,
          featureName: featureFlag.name,
          featureType: featureFlag.type
        }
      });

      logger.info(`Feature flag deleted: ${featureFlag.name} (${featureId})`);
      return featureFlag;

    } catch (error) {
      logger.error('Delete feature flag error:', error);
      throw error;
    }
  }

  async activateFeatureFlag(featureId, activatedBy) {
    try {
      const featureFlag = await FeatureFlag.findById(featureId);
      if (!featureFlag) {
        throw new Error('Feature flag not found');
      }

      if (featureFlag.status === 'active') {
        throw new Error('Feature flag is already active');
      }

      // Activate feature flag
      featureFlag.status = 'active';
      featureFlag.activatedAt = new Date();
      featureFlag.activatedBy = activatedBy;
      await featureFlag.save();

      // Clear cache
      this.clearCache();

      // Track analytics
      await Analytics.create({
        eventType: 'feature_enabled',
        eventName: 'Feature Flag Activated',
        eventCategory: 'system',
        userId: activatedBy,
        platform: 'service',
        metadata: {
          featureId,
          featureName: featureFlag.name,
          rolloutPercentage: featureFlag.rolloutPercentage,
          targetUserCount: featureFlag.targetUsers.length
        }
      });

      logger.info(`Feature flag activated: ${featureFlag.name} (${featureId})`);
      return featureFlag;

    } catch (error) {
      logger.error('Activate feature flag error:', error);
      throw error;
    }
  }

  async deactivateFeatureFlag(featureId, deactivatedBy) {
    try {
      const featureFlag = await FeatureFlag.findById(featureId);
      if (!featureFlag) {
        throw new Error('Feature flag not found');
      }

      if (featureFlag.status !== 'active') {
        throw new Error('Feature flag is not active');
      }

      // Deactivate feature flag
      featureFlag.status = 'inactive';
      featureFlag.deactivatedAt = new Date();
      featureFlag.deactivatedBy = deactivatedBy;
      await featureFlag.save();

      // Clear cache
      this.clearCache();

      // Track analytics
      await Analytics.create({
        eventType: 'feature_disabled',
        eventName: 'Feature Flag Deactivated',
        eventCategory: 'system',
        userId: deactivatedBy,
        platform: 'service',
        metadata: {
          featureId,
          featureName: featureFlag.name,
          activationDuration: featureFlag.activatedAt ? 
            (new Date() - featureFlag.activatedAt) / (1000 * 60 * 60 * 24) : 0
        }
      });

      logger.info(`Feature flag deactivated: ${featureFlag.name} (${featureId})`);
      return featureFlag;

    } catch (error) {
      logger.error('Deactivate feature flag error:', error);
      throw error;
    }
  }

  // Feature Access Control
  async isFeatureEnabled(featureName, userId, context = {}) {
    try {
      // Check cache first
      const cachedResult = this.getCachedFeatureAccess(featureName, userId);
      if (cachedResult !== null) {
        return cachedResult;
      }

      // Get feature flag
      const featureFlag = await this.getFeatureFlag(featureName);
      if (!featureFlag || featureFlag.status !== 'active') {
        return featureFlag?.defaultValue || false;
      }

      // Check if user is explicitly targeted
      if (featureFlag.targetUsers.includes(userId.toString())) {
        const result = true;
        this.cacheFeatureAccess(featureName, userId, result);
        return result;
      }

      // Check user context
      const user = await User.findById(userId).select('tier platform region');
      if (!user) {
        return featureFlag.defaultValue;
      }

      // Check tier-based access
      if (featureFlag.targetTiers.length > 0 && 
          !featureFlag.targetTiers.includes(user.tier)) {
        const result = false;
        this.cacheFeatureAccess(featureName, userId, result);
        return result;
      }

      // Check platform-based access
      if (featureFlag.targetPlatforms.length > 0 && 
          !featureFlag.targetPlatforms.includes(context.platform || user.platform)) {
        const result = false;
        this.cacheFeatureAccess(featureName, userId, result);
        return result;
      }

      // Check region-based access
      if (featureFlag.targetRegions.length > 0 && 
          !featureFlag.targetRegions.includes(context.region || user.region)) {
        const result = false;
        this.cacheFeatureAccess(featureName, userId, result);
        return result;
      }

      // Check custom conditions
      if (featureFlag.conditions && Object.keys(featureFlag.conditions).length > 0) {
        const conditionsMet = await this.evaluateConditions(featureFlag.conditions, user, context);
        if (!conditionsMet) {
          const result = false;
          this.cacheFeatureAccess(featureName, userId, result);
          return result;
        }
      }

      // Check rollout percentage
      if (featureFlag.rolloutPercentage > 0) {
        const isInRollout = this.isUserInRollout(featureName, userId, featureFlag.rolloutPercentage);
        if (!isInRollout) {
          const result = false;
          this.cacheFeatureAccess(featureName, userId, result);
          return result;
        }
      }

      const result = true;
      this.cacheFeatureAccess(featureName, userId, result);

      // Track feature usage
      await this.trackFeatureUsage(featureName, userId, context, result);

      return result;

    } catch (error) {
      logger.error('Check feature enabled error:', error);
      return false;
    }
  }

  async getFeatureValue(featureName, userId, context = {}) {
    try {
      const isEnabled = await this.isFeatureEnabled(featureName, userId, context);
      if (!isEnabled) {
        return null;
      }

      const featureFlag = await this.getFeatureFlag(featureName);
      if (!featureFlag) {
        return null;
      }

      // Return appropriate value based on type
      switch (featureFlag.type) {
        case 'boolean':
          return true;
        case 'string':
          return featureFlag.metadata.value || '';
        case 'number':
          return featureFlag.metadata.value || 0;
        case 'json':
          return featureFlag.metadata.value || {};
        case 'percentage':
          return featureFlag.rolloutPercentage;
        default:
          return featureFlag.defaultValue;
      }

    } catch (error) {
      logger.error('Get feature value error:', error);
      return null;
    }
  }

  async getMultipleFeatures(featureNames, userId, context = {}) {
    try {
      const results = {};
      
      for (const featureName of featureNames) {
        results[featureName] = await this.isFeatureEnabled(featureName, userId, context);
      }

      return results;

    } catch (error) {
      logger.error('Get multiple features error:', error);
      return {};
    }
  }

  // A/B Testing
  async assignABTestVariant(featureName, userId, context = {}) {
    try {
      const featureFlag = await this.getFeatureFlag(featureName);
      if (!featureFlag || featureFlag.status !== 'active') {
        return null;
      }

      // Check if user is already assigned
      const existingAssignment = await this.getABTestAssignment(featureName, userId);
      if (existingAssignment) {
        return existingAssignment.variant;
      }

      // Determine variant based on user ID hash
      const variant = this.determineABTestVariant(featureName, userId, featureFlag.metadata.variants || ['A', 'B']);

      // Store assignment
      await this.storeABTestAssignment(featureName, userId, variant, context);

      // Track analytics
      await Analytics.create({
        eventType: 'feature_used',
        eventName: 'A/B Test Variant Assigned',
        eventCategory: 'system',
        userId,
        platform: context.platform || 'unknown',
        metadata: {
          featureName,
          variant,
          experimentId: featureFlag._id,
          isControl: variant === 'A'
        },
        abTesting: {
          experimentId: featureFlag._id.toString(),
          variant,
          group: 'test',
          isControl: variant === 'A'
        }
      });

      return variant;

    } catch (error) {
      logger.error('Assign A/B test variant error:', error);
      return null;
    }
  }

  async trackABTestConversion(featureName, userId, conversion, value = 0) {
    try {
      const assignment = await this.getABTestAssignment(featureName, userId);
      if (!assignment) {
        return false;
      }

      // Update conversion data
      assignment.conversion = conversion;
      assignment.conversionValue = value;
      assignment.conversionAt = new Date();
      await assignment.save();

      // Track analytics
      await Analytics.create({
        eventType: 'feature_used',
        eventName: 'A/B Test Conversion',
        eventCategory: 'system',
        userId,
        platform: 'service',
        metadata: {
          featureName,
          variant: assignment.variant,
          conversion,
          conversionValue: value
        },
        abTesting: {
          experimentId: assignment.featureName,
          variant: assignment.variant,
          group: 'test',
          isControl: assignment.variant === 'A',
          conversion,
          conversionValue: value
        }
      });

      return true;

    } catch (error) {
      logger.error('Track A/B test conversion error:', error);
      return false;
    }
  }

  // Utility Methods
  async getFeatureFlag(featureName) {
    try {
      // Check cache first
      if (this.featureCache.has(featureName)) {
        const cached = this.featureCache.get(featureName);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.data;
        }
      }

      // Fetch from database
      const featureFlag = await FeatureFlag.findOne({ 
        name: featureName, 
        status: { $in: ['active', 'inactive'] },
        isDeleted: false
      });

      // Cache result
      this.featureCache.set(featureName, {
        data: featureFlag,
        timestamp: Date.now()
      });

      return featureFlag;

    } catch (error) {
      logger.error('Get feature flag error:', error);
      return null;
    }
  }

  async evaluateConditions(conditions, user, context) {
    try {
      for (const [key, value] of Object.entries(conditions)) {
        switch (key) {
          case 'minTier':
            if (user.tier < value) return false;
            break;
          case 'maxTier':
            if (user.tier > value) return false;
            break;
          case 'userAge':
            if (user.dateOfBirth) {
              const age = this.calculateAge(user.dateOfBirth);
              if (age < value) return false;
            }
            break;
          case 'accountAge':
            if (user.createdAt) {
              const accountAge = (Date.now() - user.createdAt) / (1000 * 60 * 60 * 24);
              if (accountAge < value) return false;
            }
            break;
          case 'customField':
            if (user[value.field] !== value.value) return false;
            break;
          default:
            // Unknown condition, fail safe
            return false;
        }
      }
      return true;

    } catch (error) {
      logger.error('Evaluate conditions error:', error);
      return false;
    }
  }

  isUserInRollout(featureName, userId, rolloutPercentage) {
    try {
      // Use consistent hashing for rollout
      const hash = this.hashString(`${featureName}:${userId}`);
      const normalizedHash = hash % 100;
      return normalizedHash < rolloutPercentage;

    } catch (error) {
      logger.error('Check user in rollout error:', error);
      return false;
    }
  }

  determineABTestVariant(featureName, userId, variants) {
    try {
      const hash = this.hashString(`${featureName}:${userId}`);
      const variantIndex = hash % variants.length;
      return variants[variantIndex];

    } catch (error) {
      logger.error('Determine A/B test variant error:', error);
      return variants[0] || 'A';
    }
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  calculateAge(dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  }

  // Cache Management
  getCachedFeatureAccess(featureName, userId) {
    try {
      const userCache = this.userFeatureCache.get(userId.toString());
      if (userCache && userCache.has(featureName)) {
        const cached = userCache.get(featureName);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          return cached.enabled;
        }
      }
      return null;

    } catch (error) {
      logger.error('Get cached feature access error:', error);
      return null;
    }
  }

  cacheFeatureAccess(featureName, userId, enabled) {
    try {
      if (!this.userFeatureCache.has(userId.toString())) {
        this.userFeatureCache.set(userId.toString(), new Map());
      }

      const userCache = this.userFeatureCache.get(userId.toString());
      userCache.set(featureName, {
        enabled,
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Cache feature access error:', error);
    }
  }

  clearCache() {
    try {
      this.featureCache.clear();
      this.userFeatureCache.clear();
      this.lastCacheUpdate = Date.now();
    } catch (error) {
      logger.error('Clear cache error:', error);
    }
  }

  // Analytics and Tracking
  async trackFeatureUsage(featureName, userId, context, enabled) {
    try {
      await Analytics.create({
        eventType: 'feature_used',
        eventName: 'Feature Flag Checked',
        eventCategory: 'system',
        userId,
        platform: context.platform || 'unknown',
        metadata: {
          featureName,
          enabled,
          context
        }
      });

    } catch (error) {
      logger.error('Track feature usage error:', error);
    }
  }

  async getABTestAssignment(featureName, userId) {
    try {
      // This would typically be stored in a separate collection
      // For now, return null to indicate no assignment
      return null;
    } catch (error) {
      logger.error('Get A/B test assignment error:', error);
      return null;
    }
  }

  async storeABTestAssignment(featureName, userId, variant, context) {
    try {
      // This would typically be stored in a separate collection
      // For now, just log the assignment
      logger.info(`A/B test assignment stored: ${featureName} -> ${variant} for user ${userId}`);
    } catch (error) {
      logger.error('Store A/B test assignment error:', error);
    }
  }

  // Health Check and Statistics
  async getFeatureFlagStats() {
    try {
      const stats = await FeatureFlag.aggregate([
        { $match: { isDeleted: false } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            features: { $addToSet: '$name' }
          }
        }
      ]);

      const totalFeatures = await FeatureFlag.countDocuments({ isDeleted: false });
      const activeFeatures = await FeatureFlag.countDocuments({ status: 'active', isDeleted: false });

      return {
        totalFeatures,
        activeFeatures,
        byStatus: stats,
        cacheSize: this.featureCache.size,
        userCacheSize: this.userFeatureCache.size,
        lastCacheUpdate: this.lastCacheUpdate
      };

    } catch (error) {
      logger.error('Get feature flag stats error:', error);
      return {};
    }
  }

  getHealthStatus() {
    return {
      featureCacheSize: this.featureCache.size,
      userFeatureCacheSize: this.userFeatureCache.size,
      lastCacheUpdate: this.lastCacheUpdate,
      cacheExpiry: this.cacheExpiry,
      timestamp: new Date()
    };
  }
}

module.exports = new FeatureFlagService();