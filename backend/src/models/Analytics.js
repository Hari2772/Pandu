const mongoose = require('mongoose');
const constants = require('../utils/constants');

const analyticsSchema = new mongoose.Schema({
  // Event Information
  eventType: {
    type: String,
    required: true,
    enum: [
      'user_registration', 'user_login', 'user_logout', 'user_profile_update',
      'message_sent', 'message_received', 'message_read', 'message_deleted',
      'call_initiated', 'call_answered', 'call_ended', 'call_failed',
      'recording_started', 'recording_stopped', 'recording_viewed',
      'screen_share_started', 'screen_share_stopped',
      'story_created', 'story_viewed', 'story_reacted',
      'friend_request_sent', 'friend_request_accepted', 'friend_request_rejected',
      'group_created', 'group_joined', 'group_left',
      'location_updated', 'tier_changed', 'nearby_user_discovered',
      'feature_enabled', 'feature_disabled', 'feature_used',
      'file_uploaded', 'file_downloaded', 'file_shared',
      'notification_sent', 'notification_received', 'notification_opened',
      'payment_made', 'subscription_started', 'subscription_cancelled',
      'error_occurred', 'performance_metric', 'security_event',
      'admin_action', 'system_event', 'custom_event'
    ]
  },
  eventName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  eventCategory: {
    type: String,
    enum: ['user', 'communication', 'media', 'social', 'location', 'system', 'security', 'business', 'performance'],
    required: true
  },

  // User Context
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  deviceId: String,
  platform: {
    type: String,
    enum: ['ios', 'android', 'web', 'desktop'],
    required: true
  },
  appVersion: String,
  osVersion: String,
  deviceModel: String,

  // Event Details
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  duration: Number, // For events that have duration (calls, recordings, etc.)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  tags: [String],

  // Location Context
  location: {
    coordinates: {
      type: [Number],
      validate: {
        validator: function(v) {
          return !v || (v.length === 2 && 
                 v[0] >= -180 && v[0] <= 180 && 
                 v[1] >= -90 && v[1] <= 90);
        },
        message: 'Invalid coordinates'
      }
    },
    address: String,
    placeName: String,
    city: String,
    country: String,
    tier: Number
  },

  // Performance Metrics
  performance: {
    responseTime: Number, // milliseconds
    loadTime: Number, // milliseconds
    memoryUsage: Number, // bytes
    cpuUsage: Number, // percentage
    networkLatency: Number, // milliseconds
    bandwidth: Number, // bytes per second
    errorRate: Number, // percentage
    successRate: Number // percentage
  },

  // Error Information
  error: {
    code: String,
    message: String,
    stack: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    isResolved: {
      type: Boolean,
      default: false
    },
    resolvedAt: Date,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Business Metrics
  business: {
    revenue: Number,
    currency: {
      type: String,
      default: 'USD'
    },
    conversionRate: Number,
    customerLifetimeValue: Number,
    churnRate: Number,
    acquisitionCost: Number,
    retentionRate: Number
  },

  // Security Events
  security: {
    threatLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low'
    },
    ipAddress: String,
    userAgent: String,
    isSuspicious: {
      type: Boolean,
      default: false
    },
    riskScore: Number,
    mitigationAction: String
  },

  // Network Information
  network: {
    connectionType: String, // 'wifi', '4g', '5g', 'ethernet'
    isp: String,
    country: String,
    city: String,
    bandwidth: Number,
    latency: Number,
    packetLoss: Number
  },

  // User Behavior
  behavior: {
    sessionDuration: Number, // seconds
    pageViews: Number,
    actionsPerSession: Number,
    timeOnPage: Number,
    bounceRate: Number,
    returnRate: Number,
    engagementScore: Number
  },

  // Feature Usage
  featureUsage: {
    featureName: String,
    featureVersion: String,
    usageCount: Number,
    lastUsed: Date,
    isEnabled: Boolean,
    userPreference: mongoose.Schema.Types.Mixed
  },

  // A/B Testing
  abTesting: {
    experimentId: String,
    variant: String,
    group: String,
    isControl: Boolean,
    conversion: Boolean,
    conversionValue: Number
  },

  // Status
  isProcessed: {
    type: Boolean,
    default: false
  },
  processedAt: Date,
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: Date,
  retentionDays: {
    type: Number,
    default: 365
  },

  // Metadata
  source: {
    type: String,
    enum: ['client', 'server', 'third_party', 'system'],
    default: 'client'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  batchId: String, // For batch processing
  correlationId: String, // For tracing related events
  parentEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Analytics'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
analyticsSchema.index({ eventType: 1 });
analyticsSchema.index({ eventCategory: 1 });
analyticsSchema.index({ userId: 1 });
analyticsSchema.index({ sessionId: 1 });
analyticsSchema.index({ timestamp: -1 });
analyticsSchema.index({ platform: 1 });
analyticsSchema.index({ 'location.coordinates': '2dsphere' });
analyticsSchema.index({ 'location.tier': 1 });
analyticsSchema.index({ 'error.severity': 1 });
analyticsSchema.index({ 'security.threatLevel': 1 });
analyticsSchema.index({ 'abTesting.experimentId': 1 });
analyticsSchema.index({ isProcessed: 1 });
analyticsSchema.index({ isArchived: 1 });
analyticsSchema.index({ source: 1 });
analyticsSchema.index({ priority: 1 });
analyticsSchema.index({ batchId: 1 });
analyticsSchema.index({ correlationId: 1 });

// TTL index for automatic cleanup
analyticsSchema.index({ timestamp: 1 }, { expireAfterSeconds: 0 });

// Virtuals
analyticsSchema.virtual('isError').get(function() {
  return this.error && this.error.code;
});

analyticsSchema.virtual('isSecurityEvent').get(function() {
  return this.eventCategory === 'security';
});

analyticsSchema.virtual('isPerformanceEvent').get(function() {
  return this.eventCategory === 'performance';
});

analyticsSchema.virtual('isBusinessEvent').get(function() {
  return this.eventCategory === 'business';
});

analyticsSchema.virtual('ageInDays').get(function() {
  const now = new Date();
  const age = now - this.timestamp;
  return Math.floor(age / (1000 * 60 * 60 * 24));
});

analyticsSchema.virtual('isExpired').get(function() {
  const now = new Date();
  const expiryDate = new Date(this.timestamp.getTime() + (this.retentionDays * 24 * 60 * 60 * 1000));
  return now > expiryDate;
});

// Methods
analyticsSchema.methods.markAsProcessed = function() {
  this.isProcessed = true;
  this.processedAt = new Date();
  return this;
};

analyticsSchema.methods.markAsArchived = function() {
  this.isArchived = true;
  this.archivedAt = new Date();
  return this;
};

analyticsSchema.methods.addMetadata = function(key, value) {
  this.metadata[key] = value;
  return this;
};

analyticsSchema.methods.addTag = function(tag) {
  if (!this.tags.includes(tag)) {
    this.tags.push(tag);
  }
  return this;
};

analyticsSchema.methods.setError = function(code, message, stack = null, severity = 'medium') {
  this.error = {
    code,
    message,
    stack,
    severity,
    isResolved: false
  };
  
  this.eventCategory = 'security';
  this.priority = severity === 'critical' ? 'urgent' : 'high';
  
  return this;
};

analyticsSchema.methods.resolveError = function(resolvedBy) {
  if (this.error) {
    this.error.isResolved = true;
    this.error.resolvedAt = new Date();
    this.error.resolvedBy = resolvedBy;
  }
  
  return this;
};

analyticsSchema.methods.setPerformanceMetrics = function(metrics) {
  this.performance = { ...this.performance, ...metrics };
  return this;
};

analyticsSchema.methods.setSecurityEvent = function(threatLevel, isSuspicious = false, riskScore = 0) {
  this.security.threatLevel = threatLevel;
  this.security.isSuspicious = isSuspicious;
  this.security.riskScore = riskScore;
  
  this.eventCategory = 'security';
  this.priority = threatLevel === 'critical' ? 'urgent' : 'high';
  
  return this;
};

analyticsSchema.methods.setBusinessMetrics = function(metrics) {
  this.business = { ...this.business, ...metrics };
  this.eventCategory = 'business';
  return this;
};

analyticsSchema.methods.setABTesting = function(experimentId, variant, group, isControl = false) {
  this.abTesting = {
    experimentId,
    variant,
    group,
    isControl
  };
  return this;
};

analyticsSchema.methods.setConversion = function(conversion, value = 0) {
  if (this.abTesting) {
    this.abTesting.conversion = conversion;
    this.abTesting.conversionValue = value;
  }
  return this;
};

// Static methods
analyticsSchema.statics.findByUser = function(userId, options = {}) {
  const { eventType, eventCategory, startDate, endDate, page = 1, limit = 50 } = options;
  
  let query = { userId };
  
  if (eventType) query.eventType = eventType;
  if (eventCategory) query.eventCategory = eventCategory;
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = startDate;
    if (endDate) query.timestamp.$lte = endDate;
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

analyticsSchema.statics.findByEventType = function(eventType, options = {}) {
  const { startDate, endDate, platform, page = 1, limit = 50 } = options;
  
  let query = { eventType };
  
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = startDate;
    if (endDate) query.timestamp.$lte = endDate;
  }
  if (platform) query.platform = platform;
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

analyticsSchema.statics.findBySession = function(sessionId) {
  return this.find({ sessionId }).sort({ timestamp: 1 });
};

analyticsSchema.statics.getEventStats = function(options = {}) {
  const { startDate, endDate, eventType, platform } = options;
  
  let match = {};
  
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = startDate;
    if (endDate) match.timestamp.$lte = endDate;
  }
  if (eventType) match.eventType = eventType;
  if (platform) match.platform = platform;
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        platforms: { $addToSet: '$platform' },
        averageDuration: { $avg: '$duration' },
        totalDuration: { $sum: '$duration' }
      }
    },
    {
      $project: {
        eventType: '$_id',
        count: 1,
        uniqueUserCount: { $size: '$uniqueUsers' },
        platforms: 1,
        averageDuration: 1,
        totalDuration: 1
      }
    },
    { $sort: { count: -1 } }
  ]);
};

analyticsSchema.statics.getUserStats = function(userId, period = '30d') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        timestamp: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        eventTypes: { $addToSet: '$eventType' },
        platforms: { $addToSet: '$platform' },
        totalDuration: { $sum: '$duration' },
        averageResponseTime: { $avg: '$performance.responseTime' },
        errorCount: {
          $sum: { $cond: [{ $ne: ['$error.code', null] }, 1, 0] }
        },
        securityEvents: {
          $sum: { $cond: [{ $eq: ['$eventCategory', 'security'] }, 1, 0] }
        }
      }
    }
  ]);
};

analyticsSchema.statics.getPerformanceMetrics = function(options = {}) {
  const { startDate, endDate, platform, metric } = options;
  
  let match = {
    eventCategory: 'performance',
    'performance.responseTime': { $exists: true }
  };
  
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = startDate;
    if (endDate) match.timestamp.$lte = endDate;
  }
  if (platform) match.platform = platform;
  if (metric) match[`performance.${metric}`] = { $exists: true };
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          platform: '$platform',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
        },
        avgResponseTime: { $avg: '$performance.responseTime' },
        avgLoadTime: { $avg: '$performance.loadTime' },
        avgMemoryUsage: { $avg: '$performance.memoryUsage' },
        avgCpuUsage: { $avg: '$performance.cpuUsage' },
        avgNetworkLatency: { $avg: '$performance.networkLatency' },
        errorRate: {
          $avg: { $cond: [{ $ne: ['$error.code', null] }, 1, 0] }
        },
        eventCount: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);
};

analyticsSchema.statics.getSecurityEvents = function(options = {}) {
  const { startDate, endDate, threatLevel, isResolved } = options;
  
  let match = { eventCategory: 'security' };
  
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = startDate;
    if (endDate) match.timestamp.$lte = endDate;
  }
  if (threatLevel) match['security.threatLevel'] = threatLevel;
  if (isResolved !== undefined) match['error.isResolved'] = isResolved;
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          threatLevel: '$security.threatLevel',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
        },
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        avgRiskScore: { $avg: '$security.riskScore' },
        suspiciousCount: {
          $sum: { $cond: ['$security.isSuspicious', 1, 0] }
        }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);
};

analyticsSchema.statics.getBusinessMetrics = function(options = {}) {
  const { startDate, endDate, metric } = options;
  
  let match = { eventCategory: 'business' };
  
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = startDate;
    if (endDate) match.timestamp.$lte = endDate;
  }
  if (metric) match[`business.${metric}`] = { $exists: true };
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
        },
        totalRevenue: { $sum: '$business.revenue' },
        avgConversionRate: { $avg: '$business.conversionRate' },
        avgCustomerLifetimeValue: { $avg: '$business.customerLifetimeValue' },
        avgChurnRate: { $avg: '$business.churnRate' },
        avgAcquisitionCost: { $avg: '$business.acquisitionCost' },
        avgRetentionRate: { $avg: '$business.retentionRate' },
        eventCount: { $sum: 1 }
      }
    },
    { $sort: { '_id.date': 1 } }
  ]);
};

// Pre-save middleware
analyticsSchema.pre('save', function(next) {
  // Set TTL for automatic cleanup
  if (this.retentionDays) {
    const expiryDate = new Date(this.timestamp.getTime() + (this.retentionDays * 24 * 60 * 60 * 1000));
    this.expireAt = expiryDate;
  }
  
  // Set priority based on event category and error severity
  if (this.eventCategory === 'security' && this.error && this.error.severity === 'critical') {
    this.priority = 'urgent';
  } else if (this.eventCategory === 'security' || (this.error && this.error.severity === 'high')) {
    this.priority = 'high';
  }
  
  next();
});

// Pre-find middleware
analyticsSchema.pre('find', function() {
  this.where({ isArchived: false });
});

analyticsSchema.pre('findOne', function() {
  this.where({ isArchived: false });
});

module.exports = mongoose.model('Analytics', analyticsSchema);