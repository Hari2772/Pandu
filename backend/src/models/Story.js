const mongoose = require('mongoose');
const constants = require('../utils/constants');

const storySchema = new mongoose.Schema({
  // Basic Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: Object.values(constants.STORY_TYPES),
    required: true
  },
  content: {
    type: String,
    trim: true,
    maxlength: 1000,
    required: function() {
      return this.type === 'text';
    }
  },

  // Media Content
  media: {
    url: {
      type: String,
      required: function() {
        return ['image', 'video', 'audio'].includes(this.type);
      }
    },
    thumbnail: String,
    filename: String,
    mimeType: String,
    size: Number,
    duration: {
      type: Number,
      min: 0,
      max: constants.MAX_STORY_DURATION,
      required: function() {
        return ['video', 'audio'].includes(this.type);
      }
    },
    dimensions: {
      width: Number,
      height: Number
    },
    metadata: mongoose.Schema.Types.Mixed
  },

  // Story Properties
  caption: {
    type: String,
    trim: true,
    maxlength: 200
  },
  background: {
    color: String,
    gradient: {
      start: String,
      end: String,
      direction: {
        type: String,
        enum: ['to-right', 'to-left', 'to-top', 'to-bottom', 'to-top-right', 'to-top-left', 'to-bottom-right', 'to-bottom-left'],
        default: 'to-right'
      }
    },
    image: String
  },
  font: {
    family: {
      type: String,
      default: 'Arial'
    },
    size: {
      type: Number,
      default: 16,
      min: 8,
      max: 72
    },
    color: {
      type: String,
      default: '#000000'
    },
    weight: {
      type: String,
      enum: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
      default: 'normal'
    },
    style: {
      type: String,
      enum: ['normal', 'italic'],
      default: 'normal'
    }
  },
  effects: {
    filters: [String], // 'blur', 'brightness', 'contrast', 'saturation', etc.
    animations: [String], // 'fade-in', 'slide-up', 'bounce', etc.
    stickers: [{
      id: String,
      position: {
        x: Number,
        y: Number
      },
      scale: {
        type: Number,
        default: 1.0,
        min: 0.1,
        max: 3.0
      },
      rotation: {
        type: Number,
        default: 0,
        min: -180,
        max: 180
      }
    }],
    textEffects: [{
      type: String, // 'shadow', 'outline', 'glow', etc.
      color: String,
      intensity: Number
    }]
  },

  // Privacy & Visibility
  privacy: {
    level: {
      type: String,
      enum: Object.values(constants.PRIVACY_LEVELS),
      default: 'public'
    },
    isPublic: {
      type: Boolean,
      default: true
    },
    visibleTo: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      type: {
        type: String,
        enum: ['include', 'exclude'],
        default: 'include'
      }
    }],
    hideFrom: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }],
    allowReplies: {
      type: Boolean,
      default: true
    },
    allowReactions: {
      type: Boolean,
      default: true
    }
  },

  // Location & Context
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
    isLocationPublic: {
      type: Boolean,
      default: false
    }
  },
  tags: [String],
  category: String,
  mood: {
    type: String,
    enum: ['happy', 'sad', 'excited', 'calm', 'energetic', 'romantic', 'funny', 'serious', 'mysterious', 'other']
  },

  // Engagement & Interactions
  views: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    },
    deviceId: String,
    platform: String,
    viewDuration: Number, // How long they viewed the story
    isReplayed: {
      type: Boolean,
      default: false
    },
    replayCount: {
      type: Number,
      default: 0
    }
  }],
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  replies: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: {
      type: String,
      required: true,
      maxlength: 500
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    isPrivate: {
      type: Boolean,
      default: false
    }
  }],
  shares: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    },
    platform: String, // 'internal', 'whatsapp', 'telegram', etc.
    isPublic: {
      type: Boolean,
      default: false
    }
  }],

  // Story Lifecycle
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // TTL index for automatic deletion
  },
  isExpired: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: Date,
  isHighlighted: {
    type: Boolean,
    default: false
  },
  highlightExpiresAt: Date,

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Analytics
  stats: {
    totalViews: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    totalReactions: { type: Number, default: 0 },
    totalReplies: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    averageViewDuration: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 }
  },

  // Metadata
  clientStoryId: String, // For client-side deduplication
  deviceId: String,
  platform: String,
  appVersion: String,
  language: String,
  timezone: String,
  ipAddress: String,
  userAgent: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
storySchema.index({ userId: 1 });
storySchema.index({ createdAt: -1 });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
storySchema.index({ type: 1 });
storySchema.index({ 'privacy.level': 1 });
storySchema.index({ 'privacy.isPublic': 1 });
storySchema.index({ 'location.coordinates': '2dsphere' });
storySchema.index({ tags: 1 });
storySchema.index({ category: 1 });
storySchema.index({ mood: 1 });
storySchema.index({ isHighlighted: 1 });
storySchema.index({ 'views.userId': 1 });
storySchema.index({ 'reactions.userId': 1 });
storySchema.index({ 'replies.userId': 1 });
storySchema.index({ 'shares.userId': 1 });

// Virtuals
storySchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

storySchema.virtual('timeUntilExpiry').get(function() {
  const now = new Date();
  const timeLeft = this.expiresAt - now;
  return Math.max(0, timeLeft);
});

storySchema.virtual('viewCount').get(function() {
  return this.views.length;
});

storySchema.virtual('reactionCount').get(function() {
  return this.reactions.length;
});

storySchema.virtual('replyCount').get(function() {
  return this.replies.length;
});

storySchema.virtual('shareCount').get(function() {
  return this.shares.length;
});

storySchema.virtual('reactionCounts').get(function() {
  const counts = {};
  this.reactions.forEach(reaction => {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  });
  return counts;
});

storySchema.virtual('hasReactions').get(function() {
  return this.reactions.length > 0;
});

storySchema.virtual('hasReplies').get(function() {
  return this.replies.length > 0;
});

storySchema.virtual('isHighlighted').get(function() {
  return this.isHighlighted && (!this.highlightExpiresAt || this.highlightExpiresAt > new Date());
});

// Methods
storySchema.methods.addView = function(userId, deviceId, platform, viewDuration = 0) {
  const existingView = this.views.find(v => v.userId.equals(userId));
  
  if (existingView) {
    existingView.viewedAt = new Date();
    existingView.deviceId = deviceId;
    existingView.platform = platform;
    existingView.viewDuration = viewDuration;
  } else {
    this.views.push({
      userId,
      deviceId,
      platform,
      viewDuration
    });
  }
  
  this.stats.totalViews = this.views.length;
  this.stats.uniqueViews = this.views.length;
  
  return this;
};

storySchema.methods.addReaction = function(userId, emoji) {
  const existingReaction = this.reactions.find(r => 
    r.userId.equals(userId) && r.emoji === emoji
  );
  
  if (existingReaction) {
    // Remove existing reaction
    this.reactions = this.reactions.filter(r => 
      !(r.userId.equals(userId) && r.emoji === emoji)
    );
  } else {
    // Add new reaction
    this.reactions.push({ userId, emoji });
  }
  
  this.stats.totalReactions = this.reactions.length;
  
  return this;
};

storySchema.methods.addReply = function(userId, content, isPrivate = false) {
  this.replies.push({
    userId,
    content,
    isPrivate
  });
  
  this.stats.totalReplies = this.replies.length;
  
  return this;
};

storySchema.methods.addShare = function(userId, platform, isPublic = false) {
  this.shares.push({
    userId,
    platform,
    isPublic
  });
  
  this.stats.totalShares = this.shares.length;
  
  return this;
};

storySchema.methods.markAsHighlighted = function(duration = 7 * 24 * 60 * 60 * 1000) { // 7 days default
  this.isHighlighted = true;
  this.highlightExpiresAt = new Date(Date.now() + duration);
  
  return this;
};

storySchema.methods.removeHighlight = function() {
  this.isHighlighted = false;
  this.highlightExpiresAt = null;
  
  return this;
};

storySchema.methods.archive = function() {
  this.isArchived = true;
  this.archivedAt = new Date();
  
  return this;
};

storySchema.methods.unarchive = function() {
  this.isArchived = false;
  this.archivedAt = null;
  
  return this;
};

storySchema.methods.softDelete = function(deletedBy) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  
  return this;
};

storySchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  
  return this;
};

storySchema.methods.updateEngagementScore = function() {
  const viewWeight = 1;
  const reactionWeight = 3;
  const replyWeight = 5;
  const shareWeight = 4;
  
  const score = (this.stats.totalViews * viewWeight) +
                (this.stats.totalReactions * reactionWeight) +
                (this.stats.totalReplies * replyWeight) +
                (this.stats.totalShares * shareWeight);
  
  this.stats.engagementScore = score;
  
  return this;
};

// Static methods
storySchema.statics.findByUser = function(userId, options = {}) {
  const { type, page = 1, limit = 20, includeExpired = false } = options;
  
  let query = {
    userId,
    isActive: true,
    isDeleted: false
  };
  
  if (!includeExpired) {
    query.expiresAt = { $gt: new Date() };
  }
  
  if (type) query.type = type;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture')
    .populate('views.userId', 'username displayName profilePicture')
    .populate('reactions.userId', 'username displayName profilePicture');
};

storySchema.statics.findPublicStories = function(options = {}) {
  const { type, category, mood, location, page = 1, limit = 20 } = options;
  
  let query = {
    'privacy.isPublic': true,
    isActive: true,
    isDeleted: false,
    expiresAt: { $gt: new Date() }
  };
  
  if (type) query.type = type;
  if (category) query.category = category;
  if (mood) query.mood = mood;
  
  if (location) {
    query['location.coordinates'] = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: location.coordinates
        },
        $maxDistance: location.radius || 50000 // 50km default
      }
    };
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture');
};

storySchema.statics.findHighlightedStories = function(userId, options = {}) {
  const { page = 1, limit = 20 } = options;
  
  const query = {
    userId,
    isHighlighted: true,
    isActive: true,
    isDeleted: false,
    $or: [
      { highlightExpiresAt: { $gt: new Date() } },
      { highlightExpiresAt: null }
    ]
  };
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture');
};

storySchema.statics.getStoryStats = function(userId, period = '30d') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  return this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate },
        isActive: true,
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalStories: { $sum: 1 },
        totalViews: { $sum: '$stats.totalViews' },
        totalReactions: { $sum: '$stats.totalReactions' },
        totalReplies: { $sum: '$stats.totalReplies' },
        totalShares: { $sum: '$stats.totalShares' },
        averageEngagementScore: { $avg: '$stats.engagementScore' }
      }
    }
  ]);
};

// Pre-save middleware
storySchema.pre('save', function(next) {
  // Set expiry time if not set (24 hours from creation)
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000));
  }
  
  // Update engagement score
  this.updateEngagementScore();
  
  next();
});

// Pre-find middleware
storySchema.pre('find', function() {
  this.where({ isDeleted: false });
});

storySchema.pre('findOne', function() {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model('Story', storySchema);