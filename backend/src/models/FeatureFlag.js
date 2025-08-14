const mongoose = require('mongoose');
const constants = require('../utils/constants');

const featureFlagSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 1,
    maxlength: 100,
    match: /^[a-zA-Z0-9_]+$/
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  category: {
    type: String,
    enum: ['core', 'communication', 'social', 'media', 'location', 'admin', 'experimental', 'monetization', 'security', 'performance'],
    default: 'core'
  },
  tags: [String],

  // Feature Status
  isEnabled: {
    type: Boolean,
    default: false,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeprecated: {
    type: Boolean,
    default: false
  },
  deprecationDate: Date,
  deprecationReason: String,

  // Rollout Configuration
  rollout: {
    percentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    strategy: {
      type: String,
      enum: ['percentage', 'gradual', 'canary', 'a/b', 'custom'],
      default: 'percentage'
    },
    isGlobal: {
      type: Boolean,
      default: false
    },
    targetUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      type: {
        type: String,
        enum: ['include', 'exclude'],
        default: 'include'
      },
      addedAt: {
        type: Date,
        default: Date.now
      },
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    targetGroups: [{
      groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
      },
      type: {
        type: String,
        enum: ['include', 'exclude'],
        default: 'include'
      },
      addedAt: {
        type: Date,
        default: Date.now
      },
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    targetCriteria: {
      userRoles: [String],
      userTiers: [Number],
      userLocations: [{
        coordinates: [Number],
        radius: Number
      }],
      userProperties: {
        isVerified: Boolean,
        isPremium: Boolean,
        accountAge: {
          min: Number,
          max: Number
        },
        lastSeen: {
          min: Date,
          max: Date
        }
      },
      deviceTypes: [String], // 'ios', 'android', 'web'
      appVersions: [String],
      platforms: [String]
    }
  },

  // Scheduling
  schedule: {
    startDate: Date,
    endDate: Date,
    isScheduled: {
      type: Boolean,
      default: false
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    recurrence: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly'],
      default: 'none'
    },
    recurrenceConfig: mongoose.Schema.Types.Mixed
  },

  // Dependencies & Conflicts
  dependencies: [{
    featureName: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['required', 'optional', 'conflicts'],
      default: 'required'
    },
    message: String
  }],
  conflicts: [String], // Array of feature names that conflict

  // Configuration & Settings
  config: {
    defaultValue: mongoose.Schema.Types.Mixed,
    options: [mongoose.Schema.Types.Mixed],
    validation: {
      type: String,
      enum: ['none', 'json', 'schema'],
      default: 'none'
    },
    schema: mongoose.Schema.Types.Mixed, // JSON schema for validation
    isConfigurable: {
      type: Boolean,
      default: false
    },
    requiresRestart: {
      type: Boolean,
      default: false
    }
  },

  // Monitoring & Analytics
  monitoring: {
    isMonitored: {
      type: Boolean,
      default: true
    },
    metrics: [{
      name: String,
      type: {
        type: String,
        enum: ['counter', 'gauge', 'histogram', 'summary'],
        default: 'counter'
      },
      description: String,
      unit: String
    }],
    alerts: [{
      condition: String,
      threshold: Number,
      severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
      },
      message: String,
      isActive: {
        type: Boolean,
        default: true
      }
    }]
  },

  // Access Control
  access: {
    isAdminOnly: {
      type: Boolean,
      default: false
    },
    requiredRoles: [String],
    allowedUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      permissions: [String], // 'view', 'edit', 'delete', 'deploy'
      grantedAt: {
        type: Date,
        default: Date.now
      },
      grantedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    isPublic: {
      type: Boolean,
      default: false
    }
  },

  // Deployment & Versioning
  deployment: {
    version: {
      type: String,
      default: '1.0.0'
    },
    environment: {
      type: String,
      enum: ['development', 'staging', 'production'],
      default: 'development'
    },
    isDeployed: {
      type: Boolean,
      default: false
    },
    deployedAt: Date,
    deployedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deploymentNotes: String,
    rollbackVersion: String,
    rollbackReason: String,
    rollbackAt: Date,
    rollbackBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // History & Audit
  history: [{
    action: {
      type: String,
      enum: ['created', 'enabled', 'disabled', 'updated', 'deployed', 'rolled_back', 'deprecated'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changes: mongoose.Schema.Types.Mixed,
    reason: String,
    metadata: mongoose.Schema.Types.Mixed
  }],

  // Status
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  estimatedImpact: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  clientFeatureId: String // For client-side identification
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
featureFlagSchema.index({ name: 1 }, { unique: true });
featureFlagSchema.index({ isEnabled: 1 });
featureFlagSchema.index({ isActive: 1 });
featureFlagSchema.index({ category: 1 });
featureFlagSchema.index({ tags: 1 });
featureFlagSchema.index({ 'rollout.isGlobal': 1 });
featureFlagSchema.index({ 'rollout.targetUsers.userId': 1 });
featureFlagSchema.index({ 'rollout.targetGroups.groupId': 1 });
featureFlagSchema.index({ 'access.isAdminOnly': 1 });
featureFlagSchema.index({ 'deployment.environment': 1 });
featureFlagSchema.index({ 'deployment.isDeployed': 1 });
featureFlagSchema.index({ priority: 1 });
featureFlagSchema.index({ createdAt: -1 });
featureFlagSchema.index({ 'schedule.startDate': 1 });
featureFlagSchema.index({ 'schedule.endDate': 1 });

// Virtuals
featureFlagSchema.virtual('isScheduled').get(function() {
  return this.schedule.isScheduled && this.schedule.startDate && this.schedule.endDate;
});

featureFlagSchema.virtual('isActiveNow').get(function() {
  if (!this.isEnabled || !this.isActive) return false;
  
  if (this.isScheduled) {
    const now = new Date();
    return now >= this.schedule.startDate && now <= this.schedule.endDate;
  }
  
  return true;
});

featureFlagSchema.virtual('timeUntilStart').get(function() {
  if (!this.schedule.startDate) return null;
  const now = new Date();
  const timeLeft = this.schedule.startDate - now;
  return Math.max(0, timeLeft);
});

featureFlagSchema.virtual('timeUntilEnd').get(function() {
  if (!this.schedule.endDate) return null;
  const now = new Date();
  const timeLeft = this.schedule.endDate - now;
  return Math.max(0, timeLeft);
});

featureFlagSchema.virtual('isExpired').get(function() {
  if (!this.schedule.endDate) return false;
  return new Date() > this.schedule.endDate;
});

featureFlagSchema.virtual('canBeDeployed').get(function() {
  return this.isEnabled && this.isActive && !this.isDeprecated && !this.isDeleted;
});

// Methods
featureFlagSchema.methods.enable = function(userId, reason = '') {
  this.isEnabled = true;
  this.addHistory('enabled', userId, { reason });
  
  return this;
};

featureFlagSchema.methods.disable = function(userId, reason = '') {
  this.isEnabled = false;
  this.addHistory('disabled', userId, { reason });
  
  return this;
};

featureFlagSchema.methods.updateRollout = function(percentage, userId, reason = '') {
  const oldPercentage = this.rollout.percentage;
  this.rollout.percentage = percentage;
  
  this.addHistory('updated', userId, {
    field: 'rollout.percentage',
    oldValue: oldPercentage,
    newValue: percentage,
    reason
  });
  
  return this;
};

featureFlagSchema.methods.addTargetUser = function(userId, type, addedBy) {
  const existingTarget = this.rollout.targetUsers.find(t => t.userId.equals(userId));
  
  if (existingTarget) {
    existingTarget.type = type;
    existingTarget.addedBy = addedBy;
    existingTarget.addedAt = new Date();
  } else {
    this.rollout.targetUsers.push({
      userId,
      type,
      addedBy,
      addedAt: new Date()
    });
  }
  
  return this;
};

featureFlagSchema.methods.removeTargetUser = function(userId) {
  this.rollout.targetUsers = this.rollout.targetUsers.filter(t => !t.userId.equals(userId));
  return this;
};

featureFlagSchema.methods.addTargetGroup = function(groupId, type, addedBy) {
  const existingTarget = this.rollout.targetGroups.find(t => t.groupId.equals(groupId));
  
  if (existingTarget) {
    existingTarget.type = type;
    existingTarget.addedBy = addedBy;
    existingTarget.addedAt = new Date();
  } else {
    this.rollout.targetGroups.push({
      groupId,
      type,
      addedBy,
      addedAt: new Date()
    });
  }
  
  return this;
};

featureFlagSchema.methods.removeTargetGroup = function(groupId) {
  this.rollout.targetGroups = this.rollout.targetGroups.filter(t => !t.groupId.equals(groupId));
  return this;
};

featureFlagSchema.methods.deploy = function(userId, notes = '') {
  this.deployment.isDeployed = true;
  this.deployment.deployedAt = new Date();
  this.deployment.deployedBy = userId;
  this.deployment.deploymentNotes = notes;
  
  this.addHistory('deployed', userId, { notes });
  
  return this;
};

featureFlagSchema.methods.rollback = function(userId, reason = '') {
  this.deployment.isDeployed = false;
  this.deployment.rollbackVersion = this.deployment.version;
  this.deployment.rollbackReason = reason;
  this.deployment.rollbackAt = new Date();
  this.deployment.rollbackBy = userId;
  
  this.addHistory('rolled_back', userId, { reason });
  
  return this;
};

featureFlagSchema.methods.deprecate = function(userId, reason = '', deprecationDate = null) {
  this.isDeprecated = true;
  this.deprecationReason = reason;
  this.deprecationDate = deprecationDate || new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 days default
  
  this.addHistory('deprecated', userId, { reason, deprecationDate: this.deprecationDate });
  
  return this;
};

featureFlagSchema.methods.addHistory = function(action, userId, metadata = {}) {
  this.history.push({
    action,
    timestamp: new Date(),
    userId,
    changes: metadata,
    reason: metadata.reason || '',
    metadata
  });
  
  return this;
};

featureFlagSchema.methods.isUserEligible = function(user, deviceInfo = {}) {
  if (!this.isActiveNow) return false;
  
  // Check if user is explicitly included/excluded
  const userTarget = this.rollout.targetUsers.find(t => t.userId.equals(user._id));
  if (userTarget) {
    return userTarget.type === 'include';
  }
  
  // Check if user's group is explicitly included/excluded
  if (user.groups && user.groups.length > 0) {
    for (const groupId of user.groups) {
      const groupTarget = this.rollout.targetGroups.find(t => t.groupId.equals(groupId));
      if (groupTarget) {
        return groupTarget.type === 'include';
      }
    }
  }
  
  // Check global rollout percentage
  if (this.rollout.isGlobal) {
    const hash = this.hashUserId(user._id.toString());
    return hash % 100 < this.rollout.percentage;
  }
  
  // Check target criteria
  if (this.rollout.targetCriteria) {
    return this.checkTargetCriteria(user, deviceInfo);
  }
  
  return false;
};

featureFlagSchema.methods.checkTargetCriteria = function(user, deviceInfo) {
  const criteria = this.rollout.targetCriteria;
  
  // Check user roles
  if (criteria.userRoles && criteria.userRoles.length > 0) {
    if (!criteria.userRoles.includes(user.role)) return false;
  }
  
  // Check user tiers
  if (criteria.userTiers && criteria.userTiers.length > 0) {
    if (!criteria.userTiers.includes(user.tier)) return false;
  }
  
  // Check user properties
  if (criteria.userProperties) {
    const props = criteria.userProperties;
    
    if (props.isVerified !== undefined && props.isVerified !== user.isEmailVerified) return false;
    if (props.isPremium !== undefined && props.isPremium !== user.isPremium) return false;
    
    if (props.accountAge) {
      const accountAge = Date.now() - user.createdAt.getTime();
      const ageInDays = accountAge / (1000 * 60 * 60 * 24);
      
      if (props.accountAge.min && ageInDays < props.accountAge.min) return false;
      if (props.accountAge.max && ageInDays > props.accountAge.max) return false;
    }
    
    if (props.lastSeen) {
      if (props.lastSeen.min && user.lastSeen < props.lastSeen.min) return false;
      if (props.lastSeen.max && user.lastSeen > props.lastSeen.max) return false;
    }
  }
  
  // Check device types
  if (criteria.deviceTypes && criteria.deviceTypes.length > 0) {
    if (!criteria.deviceTypes.includes(deviceInfo.type)) return false;
  }
  
  // Check app versions
  if (criteria.appVersions && criteria.appVersions.length > 0) {
    if (!criteria.appVersions.includes(deviceInfo.appVersion)) return false;
  }
  
  // Check platforms
  if (criteria.platforms && criteria.platforms.length > 0) {
    if (!criteria.platforms.includes(deviceInfo.platform)) return false;
  }
  
  return true;
};

featureFlagSchema.methods.hashUserId = function(userId) {
  let hash = 0;
  const str = userId.toString();
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash);
};

// Static methods
featureFlagSchema.statics.findEnabled = function() {
  return this.find({
    isEnabled: true,
    isActive: true,
    isDeleted: false
  });
};

featureFlagSchema.statics.findByCategory = function(category) {
  return this.find({
    category,
    isActive: true,
    isDeleted: false
  });
};

featureFlagSchema.statics.findByUser = function(userId) {
  return this.find({
    'rollout.targetUsers.userId': userId,
    isActive: true,
    isDeleted: false
  });
};

featureFlagSchema.statics.findByGroup = function(groupId) {
  return this.find({
    'rollout.targetGroups.groupId': groupId,
    isActive: true,
    isDeleted: false
  });
};

featureFlagSchema.statics.getFeatureStats = function() {
  return this.aggregate([
    {
      $match: {
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalFeatures: { $sum: 1 },
        enabledFeatures: {
          $sum: { $cond: ['$isEnabled', 1, 0] }
        },
        activeFeatures: {
          $sum: { $cond: ['$isActive', 1, 0] }
        },
        deprecatedFeatures: {
          $sum: { $cond: ['$isDeprecated', 1, 0] }
        },
        deployedFeatures: {
          $sum: { $cond: ['$deployment.isDeployed', 1, 0] }
        }
      }
    }
  ]);
};

// Pre-save middleware
featureFlagSchema.pre('save', function(next) {
  // Set client feature ID if not exists
  if (!this.clientFeatureId) {
    this.clientFeatureId = this.name;
  }
  
  // Validate dependencies
  if (this.dependencies && this.dependencies.length > 0) {
    for (const dep of this.dependencies) {
      if (dep.type === 'conflicts') {
        this.conflicts.push(dep.featureName);
      }
    }
  }
  
  next();
});

// Pre-find middleware
featureFlagSchema.pre('find', function() {
  this.where({ isDeleted: false });
});

featureFlagSchema.pre('findOne', function() {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model('FeatureFlag', featureFlagSchema);