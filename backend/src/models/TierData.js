const mongoose = require('mongoose');
const constants = require('../utils/constants');

const tierDataSchema = new mongoose.Schema({
  // User Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  username: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    required: true
  },
  profilePicture: String,

  // Location Data
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function(v) {
          return v.length === 2 && 
                 v[0] >= -180 && v[0] <= 180 && 
                 v[1] >= -90 && v[1] <= 90;
        },
        message: 'Invalid coordinates'
      }
    },
    accuracy: {
      type: Number,
      min: 0,
      max: 10000
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    address: String,
    placeName: String,
    city: String,
    country: String
  },

  // Tier Information
  tier: {
    type: Number,
    min: 0,
    max: 5,
    required: true
  },
  tierName: {
    type: String,
    enum: constants.TIER_NAMES,
    required: true
  },
  tierDistance: {
    type: Number,
    min: 0,
    required: true
  },
  tierColor: String,
  tierIcon: String,

  // Proximity Data
  nearbyUsers: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    displayName: String,
    profilePicture: String,
    distance: {
      type: Number,
      min: 0,
      required: true
    },
    tier: Number,
    isOnline: Boolean,
    lastSeen: Date,
    isFriend: Boolean,
    isBlocked: Boolean
  }],
  tierCounts: {
    ultraClose: { type: Number, default: 0 },
    veryClose: { type: Number, default: 0 },
    close: { type: Number, default: 0 },
    nearby: { type: Number, default: 0 },
    far: { type: Number, default: 0 },
    veryFar: { type: Number, default: 0 }
  },
  totalNearbyUsers: {
    type: Number,
    default: 0
  },

  // Activity Status
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  activityStatus: {
    type: String,
    enum: ['online', 'away', 'busy', 'offline'],
    default: 'offline'
  },

  // Privacy Settings
  privacy: {
    isLocationPublic: {
      type: Boolean,
      default: true
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    showDistance: {
      type: Boolean,
      default: true
    },
    showTier: {
      type: Boolean,
      default: true
    },
    allowDiscovery: {
      type: Boolean,
      default: true
    }
  },

  // Discovery Preferences
  discovery: {
    isDiscoverable: {
      type: Boolean,
      default: true
    },
    discoveryRadius: {
      type: Number,
      min: 50,
      max: 50000,
      default: 1000
    },
    preferredTiers: [Number],
    blockedUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      blockedAt: {
        type: Date,
        default: Date.now
      },
      reason: String
    }],
    favoriteUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },

  // Interaction History
  interactions: {
    lastInteractionAt: Date,
    totalInteractions: { type: Number, default: 0 },
    interactionTypes: {
      message: { type: Number, default: 0 },
      call: { type: Number, default: 0 },
      story: { type: Number, default: 0 },
      friendRequest: { type: Number, default: 0 }
    },
    recentInteractions: [{
      type: {
        type: String,
        enum: ['message', 'call', 'story', 'friend_request', 'location_share'],
        required: true
      },
      targetUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      metadata: mongoose.Schema.Types.Mixed
    }]
  },

  // Analytics & Metrics
  analytics: {
    discoveryCount: { type: Number, default: 0 },
    profileViews: { type: Number, default: 0 },
    friendRequests: { type: Number, default: 0 },
    messagesReceived: { type: Number, default: 0 },
    callsReceived: { type: Number, default: 0 },
    averageResponseTime: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 },
    popularityScore: { type: Number, default: 0 }
  },

  // Real-time Updates
  lastUpdate: {
    type: Date,
    default: Date.now
  },
  updateFrequency: {
    type: Number,
    default: 3000, // milliseconds
    min: 1000,
    max: 60000
  },
  isUpdating: {
    type: Boolean,
    default: false
  },
  lastTierChange: {
    type: Date,
    default: Date.now
  },
  tierChangeCount: {
    type: Number,
    default: 0
  },

  // Metadata
  deviceInfo: {
    deviceId: String,
    platform: String,
    appVersion: String,
    osVersion: String,
    deviceModel: String
  },
  sessionInfo: {
    sessionId: String,
    loginTime: Date,
    lastActivity: Date,
    ipAddress: String,
    userAgent: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
tierDataSchema.index({ userId: 1 });
tierDataSchema.index({ tier: 1 });
tierDataSchema.index({ 'location.coordinates': '2dsphere' });
tierDataSchema.index({ isOnline: 1 });
tierDataSchema.index({ isActive: 1 });
tierDataSchema.index({ lastSeen: -1 });
tierDataSchema.index({ lastUpdate: -1 });
tierDataSchema.index({ 'privacy.isLocationPublic': 1 });
tierDataSchema.index({ 'discovery.isDiscoverable': 1 });
tierDataSchema.index({ 'discovery.discoveryRadius': 1 });
tierDataSchema.index({ 'nearbyUsers.userId': 1 });
tierDataSchema.index({ 'discovery.blockedUsers.userId': 1 });
tierDataSchema.index({ 'discovery.favoriteUsers.userId': 1 });

// Virtuals
tierDataSchema.virtual('isLocationVisible').get(function() {
  return this.privacy.isLocationPublic && this.isActive;
});

tierDataSchema.virtual('isDiscoverableNow').get(function() {
  return this.discovery.isDiscoverable && this.isActive && this.isOnline;
});

tierDataSchema.virtual('nearbyUserCount').get(function() {
  return this.nearbyUsers.length;
});

tierDataSchema.virtual('friendCount').get(function() {
  return this.nearbyUsers.filter(u => u.isFriend).length;
});

tierDataSchema.virtual('onlineUserCount').get(function() {
  return this.nearbyUsers.filter(u => u.isOnline).length;
});

tierDataSchema.virtual('tierDescription').get(function() {
  return `${this.tierName} (${this.tierDistance}m)`;
});

// Methods
tierDataSchema.methods.updateLocation = function(coordinates, accuracy, address = null, placeName = null) {
  this.location.coordinates = coordinates;
  this.location.accuracy = accuracy;
  this.location.lastUpdated = new Date();
  this.lastUpdate = new Date();
  
  if (address) this.location.address = address;
  if (placeName) this.location.placeName = placeName;
  
  return this;
};

tierDataSchema.methods.updateTier = function(newTier, distance) {
  if (this.tier !== newTier) {
    this.tier = newTier;
    this.tierName = constants.TIER_NAMES[newTier];
    this.tierDistance = distance;
    this.lastTierChange = new Date();
    this.tierChangeCount += 1;
  }
  
  return this;
};

tierDataSchema.methods.addNearbyUser = function(userData) {
  const existingUser = this.nearbyUsers.find(u => u.userId.equals(userData.userId));
  
  if (existingUser) {
    Object.assign(existingUser, userData);
  } else {
    this.nearbyUsers.push(userData);
  }
  
  this.updateTierCounts();
  
  return this;
};

tierDataSchema.methods.removeNearbyUser = function(userId) {
  this.nearbyUsers = this.nearbyUsers.filter(u => !u.userId.equals(userId));
  this.updateTierCounts();
  
  return this;
};

tierDataSchema.methods.updateTierCounts = function() {
  this.tierCounts = {
    ultraClose: this.nearbyUsers.filter(u => u.tier === 0).length,
    veryClose: this.nearbyUsers.filter(u => u.tier === 1).length,
    close: this.nearbyUsers.filter(u => u.tier === 2).length,
    nearby: this.nearbyUsers.filter(u => u.tier === 3).length,
    far: this.nearbyUsers.filter(u => u.tier === 4).length,
    veryFar: this.nearbyUsers.filter(u => u.tier === 5).length
  };
  
  this.totalNearbyUsers = this.nearbyUsers.length;
  
  return this;
};

tierDataSchema.methods.setOnlineStatus = function(status, isOnline = true) {
  this.isOnline = isOnline;
  this.activityStatus = status;
  this.lastSeen = new Date();
  this.lastUpdate = new Date();
  
  return this;
};

tierDataSchema.methods.addInteraction = function(type, targetUserId, metadata = {}) {
  this.interactions.totalInteractions += 1;
  this.interactions.interactionTypes[type] += 1;
  this.interactions.lastInteractionAt = new Date();
  
  this.interactions.recentInteractions.unshift({
    type,
    targetUserId,
    timestamp: new Date(),
    metadata
  });
  
  // Keep only last 50 interactions
  if (this.interactions.recentInteractions.length > 50) {
    this.interactions.recentInteractions = this.interactions.recentInteractions.slice(0, 50);
  }
  
  return this;
};

tierDataSchema.methods.blockUser = function(userId, reason = '') {
  const existingBlock = this.discovery.blockedUsers.find(b => b.userId.equals(userId));
  
  if (!existingBlock) {
    this.discovery.blockedUsers.push({
      userId,
      blockedAt: new Date(),
      reason
    });
    
    // Remove from nearby users
    this.removeNearbyUser(userId);
  }
  
  return this;
};

tierDataSchema.methods.unblockUser = function(userId) {
  this.discovery.blockedUsers = this.discovery.blockedUsers.filter(b => !b.userId.equals(userId));
  return this;
};

tierDataSchema.methods.addFavoriteUser = function(userId) {
  const existingFavorite = this.discovery.favoriteUsers.find(f => f.userId.equals(userId));
  
  if (!existingFavorite) {
    this.discovery.favoriteUsers.push({
      userId,
      addedAt: new Date()
    });
  }
  
  return this;
};

tierDataSchema.methods.removeFavoriteUser = function(userId) {
  this.discovery.favoriteUsers = this.discovery.favoriteUsers.filter(f => !f.userId.equals(userId));
  return this;
};

tierDataSchema.methods.updateAnalytics = function() {
  // Calculate engagement score based on interactions
  const interactionWeight = 1;
  const messageWeight = 2;
  const callWeight = 3;
  const storyWeight = 1;
  
  this.analytics.engagementScore = (
    this.interactions.totalInteractions * interactionWeight +
    this.interactions.interactionTypes.message * messageWeight +
    this.interactions.interactionTypes.call * callWeight +
    this.interactions.interactionTypes.story * storyWeight
  );
  
  // Calculate popularity score based on profile views and friend requests
  this.analytics.popularityScore = (
    this.analytics.profileViews * 0.5 +
    this.analytics.friendRequests * 2 +
    this.analytics.discoveryCount * 0.3
  );
  
  return this;
};

tierDataSchema.methods.getNearbyUsersByTier = function(tier) {
  return this.nearbyUsers.filter(u => u.tier === tier);
};

tierDataSchema.methods.getOnlineUsers = function() {
  return this.nearbyUsers.filter(u => u.isOnline);
};

tierDataSchema.methods.getFriends = function() {
  return this.nearbyUsers.filter(u => u.isFriend);
};

tierDataSchema.methods.getUsersInRadius = function(radius) {
  return this.nearbyUsers.filter(u => u.distance <= radius);
};

// Static methods
tierDataSchema.statics.findByTier = function(tier, options = {}) {
  const { page = 1, limit = 50, isOnline = null } = options;
  
  let query = {
    tier,
    isActive: true
  };
  
  if (isOnline !== null) {
    query.isOnline = isOnline;
  }
  
  return this.find(query)
    .sort({ lastUpdate: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture');
};

tierDataSchema.statics.findNearbyUsers = async function(userId, radius = 1000, options = {}) {
  const { page = 1, limit = 50, excludeBlocked = true } = options;
  
  const user = await this.findOne({ userId });
  if (!user || !user.location.coordinates) return [];
  
  let query = {
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: user.location.coordinates
        },
        $maxDistance: radius
      }
    },
    userId: { $ne: userId },
    isActive: true,
    'privacy.isLocationPublic': true
  };
  
  if (excludeBlocked) {
    query['discovery.blockedUsers.userId'] = { $ne: userId };
  }
  
  return this.find(query)
    .sort({ 'location.coordinates': 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture');
};

tierDataSchema.statics.getTierStatistics = function() {
  return this.aggregate([
    {
      $match: {
        isActive: true
      }
    },
    {
      $group: {
        _id: '$tier',
        tierName: { $first: '$tierName' },
        userCount: { $sum: 1 },
        onlineCount: {
          $sum: { $cond: ['$isOnline', 1, 0] }
        },
        averageDistance: { $avg: '$tierDistance' },
        totalInteractions: { $sum: '$interactions.totalInteractions' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
};

tierDataSchema.statics.getUserTierHistory = function(userId, period = '7d') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        lastTierChange: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$tier',
        tierName: { $first: '$tierName' },
        changeCount: { $sum: 1 },
        lastChange: { $max: '$lastTierChange' },
        averageDistance: { $avg: '$tierDistance' }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
};

// Pre-save middleware
tierDataSchema.pre('save', function(next) {
  // Update tier counts
  this.updateTierCounts();
  
  // Update analytics
  this.updateAnalytics();
  
  // Set last update
  this.lastUpdate = new Date();
  
  next();
});

// Pre-find middleware
tierDataSchema.pre('find', function() {
  this.where({ isActive: true });
});

tierDataSchema.pre('findOne', function() {
  this.where({ isActive: true });
});

module.exports = mongoose.model('TierData', tierDataSchema);