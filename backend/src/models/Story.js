const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  // Story creator
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Story content
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'location'],
    required: true
  },
  
  content: {
    text: {
      type: String,
      maxlength: [500, 'Story text cannot exceed 500 characters']
    },
    mediaUrl: {
      type: String,
      validate: {
        validator: function(v) {
          if (this.type === 'image' || this.type === 'video' || this.type === 'audio') {
            return v && v.length > 0;
          }
          return true;
        },
        message: 'Media URL is required for media stories'
      }
    },
    mediaType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav']
    },
    mediaDuration: {
      type: Number, // Duration in seconds for video/audio
      min: [0, 'Duration cannot be negative']
    },
    thumbnailUrl: {
      type: String // For video stories
    }
  },
  
  // Location information
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      index: '2dsphere'
    },
    address: {
      type: String,
      maxlength: [200, 'Address cannot exceed 200 characters']
    },
    placeName: {
      type: String,
      maxlength: [100, 'Place name cannot exceed 100 characters']
    }
  },
  
  // Story visibility
  visibility: {
    type: String,
    enum: ['public', 'friends', 'nearby', 'private'],
    default: 'nearby'
  },
  
  // Visibility radius (in meters)
  visibilityRadius: {
    type: Number,
    default: 50000, // 50km default
    min: [1000, 'Visibility radius must be at least 1km'],
    max: [1000000, 'Visibility radius cannot exceed 1000km']
  },
  
  // Story settings
  settings: {
    allowReplies: {
      type: Boolean,
      default: true
    },
    allowReactions: {
      type: Boolean,
      default: true
    },
    allowScreenshots: {
      type: Boolean,
      default: false
    },
    allowSharing: {
      type: Boolean,
      default: true
    }
  },
  
  // Engagement metrics
  engagement: {
    views: {
      type: Number,
      default: 0
    },
    uniqueViews: {
      type: Number,
      default: 0
    },
    reactions: {
      like: { type: Number, default: 0 },
      love: { type: Number, default: 0 },
      laugh: { type: Number, default: 0 },
      wow: { type: Number, default: 0 },
      sad: { type: Number, default: 0 },
      angry: { type: Number, default: 0 }
    },
    replies: {
      type: Number,
      default: 0
    },
    shares: {
      type: Number,
      default: 0
    }
  },
  
  // View tracking
  viewedBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    },
    viewDuration: {
      type: Number, // Duration viewed in seconds
      default: 0
    }
  }],
  
  // Reactions tracking
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['like', 'love', 'laugh', 'wow', 'sad', 'angry']
    },
    reactedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Replies tracking
  replies: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: {
      type: String,
      maxlength: [200, 'Reply cannot exceed 200 characters']
    },
    repliedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Story status
  status: {
    type: String,
    enum: ['active', 'expired', 'deleted', 'reported'],
    default: 'active'
  },
  
  // Expiry information
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  
  // Live broadcast information
  isLiveBroadcast: {
    type: Boolean,
    default: false
  },
  
  broadcastInfo: {
    title: {
      type: String,
      maxlength: [100, 'Broadcast title cannot exceed 100 characters']
    },
    description: {
      type: String,
      maxlength: [500, 'Broadcast description cannot exceed 500 characters']
    },
    streamUrl: {
      type: String
    },
    viewerCount: {
      type: Number,
      default: 0
    },
    startedAt: {
      type: Date
    },
    endedAt: {
      type: Date
    },
    isMonetized: {
      type: Boolean,
      default: false
    },
    adFrequency: {
      type: Number, // Minutes between ads
      default: 5
    },
    lastAdTime: {
      type: Date
    }
  },
  
  // Tags and categories
  tags: [{
    type: String,
    maxlength: [20, 'Tag cannot exceed 20 characters']
  }],
  
  category: {
    type: String,
    enum: ['general', 'event', 'news', 'entertainment', 'sports', 'food', 'travel', 'business', 'education', 'other'],
    default: 'general'
  },
  
  // Metadata
  metadata: {
    deviceInfo: {
      type: String
    },
    appVersion: {
      type: String
    },
    locationAccuracy: {
      type: Number // Accuracy in meters
    },
    weather: {
      temperature: Number,
      condition: String,
      humidity: Number
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal performance
storySchema.index({ location: '2dsphere' });
storySchema.index({ 'location.coordinates': '2dsphere', createdAt: -1, userId: 1 });
storySchema.index({ userId: 1, createdAt: -1 });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
storySchema.index({ status: 1, expiresAt: 1 });
storySchema.index({ visibility: 1, createdAt: -1 });
storySchema.index({ category: 1, createdAt: -1 });
storySchema.index({ tags: 1 });
storySchema.index({ isLiveBroadcast: 1, status: 1 });

// Compound indexes for complex queries
storySchema.index({ 
  'location.coordinates': '2dsphere',
  visibility: 1,
  status: 1,
  expiresAt: 1
});

storySchema.index({
  userId: 1,
  type: 1,
  createdAt: -1
});

// Text search index
storySchema.index({
  'content.text': 'text',
  tags: 'text'
}, {
  weights: {
    'content.text': 10,
    tags: 5
  }
});

// Virtual for total reactions count
storySchema.virtual('totalReactions').get(function() {
  if (!this.engagement || !this.engagement.reactions) return 0;
  return Object.values(this.engagement.reactions).reduce((sum, count) => sum + count, 0);
});

// Virtual for story age
storySchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Virtual for time until expiry
storySchema.virtual('timeUntilExpiry').get(function() {
  return this.expiresAt.getTime() - Date.now();
});

// Virtual for is expired
storySchema.virtual('isExpired').get(function() {
  return Date.now() > this.expiresAt.getTime();
});

// Pre-save middleware
storySchema.pre('save', function(next) {
  // Set expiry time if not set (24 hours from creation)
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  
  // Update status if expired
  if (this.isExpired && this.status === 'active') {
    this.status = 'expired';
  }
  
  // Update engagement metrics
  if (this.isModified('viewedBy')) {
    this.engagement.uniqueViews = this.viewedBy.length;
  }
  
  if (this.isModified('reactions')) {
    // Reset reaction counts
    this.engagement.reactions = {
      like: 0, love: 0, laugh: 0, wow: 0, sad: 0, angry: 0
    };
    
    // Count reactions
    this.reactions.forEach(reaction => {
      if (this.engagement.reactions[reaction.type] !== undefined) {
        this.engagement.reactions[reaction.type]++;
      }
    });
  }
  
  if (this.isModified('replies')) {
    this.engagement.replies = this.replies.length;
  }
  
  next();
});

// Instance methods
storySchema.methods.addView = async function(userId, viewDuration = 0) {
  const existingView = this.viewedBy.find(view => 
    view.userId.toString() === userId.toString()
  );
  
  if (existingView) {
    existingView.viewedAt = new Date();
    existingView.viewDuration = viewDuration;
  } else {
    this.viewedBy.push({
      userId,
      viewedAt: new Date(),
      viewDuration
    });
  }
  
  this.engagement.views++;
  return this.save();
};

storySchema.methods.addReaction = async function(userId, reactionType) {
  const validReactions = ['like', 'love', 'laugh', 'wow', 'sad', 'angry'];
  
  if (!validReactions.includes(reactionType)) {
    throw new Error('Invalid reaction type');
  }
  
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(reaction => 
    reaction.userId.toString() !== userId.toString()
  );
  
  // Add new reaction
  this.reactions.push({
    userId,
    type: reactionType,
    reactedAt: new Date()
  });
  
  return this.save();
};

storySchema.methods.removeReaction = async function(userId) {
  this.reactions = this.reactions.filter(reaction => 
    reaction.userId.toString() !== userId.toString()
  );
  return this.save();
};

storySchema.methods.addReply = async function(userId, content) {
  if (!this.settings.allowReplies) {
    throw new Error('Replies are not allowed for this story');
  }
  
  this.replies.push({
    userId,
    content,
    repliedAt: new Date()
  });
  
  return this.save();
};

storySchema.methods.startLiveBroadcast = async function(broadcastInfo) {
  this.isLiveBroadcast = true;
  this.broadcastInfo = {
    ...this.broadcastInfo,
    ...broadcastInfo,
    startedAt: new Date(),
    viewerCount: 0
  };
  
  return this.save();
};

storySchema.methods.endLiveBroadcast = async function() {
  this.isLiveBroadcast = false;
  this.broadcastInfo.endedAt = new Date();
  
  return this.save();
};

storySchema.methods.updateViewerCount = async function(count) {
  if (this.isLiveBroadcast) {
    this.broadcastInfo.viewerCount = count;
    return this.save();
  }
  throw new Error('Story is not a live broadcast');
};

// Static methods
storySchema.statics.findNearbyStories = async function(longitude, latitude, maxDistance = 50000, userId = null) {
  const query = {
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    status: 'active',
    expiresAt: { $gt: new Date() }
  };
  
  // Add visibility filters
  query.$or = [
    { visibility: 'public' },
    { visibility: 'nearby' }
  ];
  
  // Add friends visibility if user is provided
  if (userId) {
    const user = await mongoose.model('User').findById(userId).populate('friends.userId');
    const friendIds = user.friends
      .filter(friend => friend.status === 'accepted')
      .map(friend => friend.userId._id);
    
    query.$or.push({
      $and: [
        { visibility: 'friends' },
        { userId: { $in: friendIds } }
      ]
    });
  }
  
  return this.find(query)
    .populate('userId', 'username displayName profilePicture')
    .sort({ createdAt: -1 })
    .limit(50);
};

storySchema.statics.findUserStories = async function(userId, limit = 20) {
  return this.find({
    userId,
    status: { $in: ['active', 'expired'] }
  })
  .populate('userId', 'username displayName profilePicture')
  .sort({ createdAt: -1 })
  .limit(limit);
};

storySchema.statics.findLiveBroadcasts = async function(longitude, latitude, maxDistance = 60000) {
  return this.find({
    isLiveBroadcast: true,
    status: 'active',
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    }
  })
  .populate('userId', 'username displayName profilePicture')
  .sort({ 'broadcastInfo.startedAt': -1 });
};

storySchema.statics.cleanupExpiredStories = async function() {
  const result = await this.updateMany(
    {
      expiresAt: { $lt: new Date() },
      status: 'active'
    },
    {
      $set: { status: 'expired' }
    }
  );
  
  return result.modifiedCount;
};

storySchema.statics.getStoryStats = async function(userId, days = 7) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const stats = await this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalStories: { $sum: 1 },
        totalViews: { $sum: '$engagement.views' },
        totalReactions: { $sum: '$engagement.reactions.like' },
        totalReplies: { $sum: '$engagement.replies' }
      }
    }
  ]);
  
  return stats[0] || {
    totalStories: 0,
    totalViews: 0,
    totalReactions: 0,
    totalReplies: 0
  };
};

module.exports = mongoose.model('Story', storySchema);