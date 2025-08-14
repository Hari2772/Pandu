const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic information
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
  },
  
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  
  displayName: {
    type: String,
    required: [true, 'Display name is required'],
    trim: true,
    minlength: [2, 'Display name must be at least 2 characters'],
    maxlength: [50, 'Display name cannot exceed 50 characters']
  },
  
  bio: {
    type: String,
    maxlength: [200, 'Bio cannot exceed 200 characters'],
    default: ''
  },
  
  profilePicture: {
    type: String,
    default: ''
  },
  
  // OAuth information
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // Location information (privacy-first)
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
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    privacyLevel: {
      type: String,
      enum: ['public', 'friends', 'private'],
      default: 'friends'
    }
  },
  
  // Online status
  isOnline: {
    type: Boolean,
    default: false
  },
  
  lastSeen: {
    type: Date,
    default: Date.now
  },
  
  // Friend system
  friends: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'blocked'],
      default: 'pending'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  friendRequests: [{
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Streak information
  currentStreak: {
    type: Number,
    default: 0
  },
  
  longestStreak: {
    type: Number,
    default: 0
  },
  
  totalDaysActive: {
    type: Number,
    default: 0
  },
  
  streakReward: {
    type: String,
    enum: ['none', 'bronze', 'silver', 'gold', 'platinum'],
    default: 'none'
  },
  
  // Privacy settings
  privacySettings: {
    showLocation: {
      type: Boolean,
      default: true
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    allowFriendRequests: {
      type: Boolean,
      default: true
    },
    allowMessages: {
      type: Boolean,
      default: true
    },
    showInNearby: {
      type: Boolean,
      default: true
    }
  },
  
  // Account settings
  isVerified: {
    type: Boolean,
    default: false
  },
  
  isBlocked: {
    type: Boolean,
    default: false
  },
  
  blockedUsers: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    blockedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Preferences
  preferences: {
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    notifications: {
      messages: {
        type: Boolean,
        default: true
      },
      friendRequests: {
        type: Boolean,
        default: true
      },
      nearbyUsers: {
        type: Boolean,
        default: true
      },
      streaks: {
        type: Boolean,
        default: true
      }
    }
  },
  
  // Statistics
  stats: {
    messagesSent: {
      type: Number,
      default: 0
    },
    messagesReceived: {
      type: Number,
      default: 0
    },
    storiesPosted: {
      type: Number,
      default: 0
    },
    friendsCount: {
      type: Number,
      default: 0
    },
    profileViews: {
      type: Number,
      default: 0
    }
  },
  
  // Admin information
  role: {
    type: String,
    enum: ['user', 'moderator', 'admin'],
    default: 'user'
  },
  
  isAdmin: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal performance
userSchema.index({ location: '2dsphere' });
userSchema.index({ 'location.coordinates': '2dsphere', isOnline: 1, lastSeen: -1 });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ isOnline: 1, lastSeen: -1 });
userSchema.index({ currentStreak: -1 });
userSchema.index({ 'friends.userId': 1 });
userSchema.index({ 'friendRequests.from': 1 });
userSchema.index({ 'blockedUsers.userId': 1 });

// Text search index
userSchema.index({
  username: 'text',
  displayName: 'text',
  bio: 'text'
}, {
  weights: {
    username: 10,
    displayName: 5,
    bio: 1
  }
});

// Virtual for friend count
userSchema.virtual('friendsCount').get(function() {
  return this.friends.filter(friend => friend.status === 'accepted').length;
});

// Virtual for pending friend requests count
userSchema.virtual('pendingRequestsCount').get(function() {
  return this.friendRequests.filter(request => request.status === 'pending').length;
});

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Update lastSeen when user goes online
  if (this.isModified('isOnline') && this.isOnline) {
    this.lastSeen = new Date();
  }
  
  // Update stats
  if (this.isModified('friends')) {
    this.stats.friendsCount = this.friends.filter(friend => friend.status === 'accepted').length;
  }
  
  next();
});

// Instance methods
userSchema.methods.updateLocation = function(longitude, latitude, privacyLevel = 'friends') {
  this.location.coordinates = [longitude, latitude];
  this.location.lastUpdated = new Date();
  this.location.privacyLevel = privacyLevel;
  return this.save();
};

userSchema.methods.addFriend = async function(friendId) {
  const existingFriend = this.friends.find(friend => 
    friend.userId.toString() === friendId.toString()
  );
  
  if (existingFriend) {
    throw new Error('Friend relationship already exists');
  }
  
  this.friends.push({
    userId: friendId,
    status: 'pending'
  });
  
  return this.save();
};

userSchema.methods.acceptFriendRequest = async function(friendId) {
  const friendRequest = this.friendRequests.find(request => 
    request.from.toString() === friendId.toString() && request.status === 'pending'
  );
  
  if (!friendRequest) {
    throw new Error('No pending friend request found');
  }
  
  friendRequest.status = 'accepted';
  
  // Add to friends list
  this.friends.push({
    userId: friendId,
    status: 'accepted'
  });
  
  return this.save();
};

userSchema.methods.rejectFriendRequest = async function(friendId) {
  const friendRequest = this.friendRequests.find(request => 
    request.from.toString() === friendId.toString() && request.status === 'pending'
  );
  
  if (!friendRequest) {
    throw new Error('No pending friend request found');
  }
  
  friendRequest.status = 'rejected';
  return this.save();
};

userSchema.methods.blockUser = async function(userId) {
  const existingBlock = this.blockedUsers.find(block => 
    block.userId.toString() === userId.toString()
  );
  
  if (existingBlock) {
    throw new Error('User is already blocked');
  }
  
  this.blockedUsers.push({ userId });
  
  // Remove from friends if exists
  this.friends = this.friends.filter(friend => 
    friend.userId.toString() !== userId.toString()
  );
  
  // Remove from friend requests
  this.friendRequests = this.friendRequests.filter(request => 
    request.from.toString() !== userId.toString()
  );
  
  return this.save();
};

userSchema.methods.unblockUser = async function(userId) {
  this.blockedUsers = this.blockedUsers.filter(block => 
    block.userId.toString() !== userId.toString()
  );
  return this.save();
};

userSchema.methods.isBlocked = function(userId) {
  return this.blockedUsers.some(block => 
    block.userId.toString() === userId.toString()
  );
};

userSchema.methods.isFriend = function(userId) {
  return this.friends.some(friend => 
    friend.userId.toString() === userId.toString() && friend.status === 'accepted'
  );
};

userSchema.methods.updateStreak = async function(days) {
  this.currentStreak = days;
  if (days > this.longestStreak) {
    this.longestStreak = days;
  }
  
  // Update streak reward
  if (days >= 365) {
    this.streakReward = 'platinum';
  } else if (days >= 100) {
    this.streakReward = 'gold';
  } else if (days >= 30) {
    this.streakReward = 'silver';
  } else if (days >= 7) {
    this.streakReward = 'bronze';
  }
  
  return this.save();
};

userSchema.methods.incrementStats = async function(field) {
  if (this.stats[field] !== undefined) {
    this.stats[field]++;
    return this.save();
  }
  throw new Error(`Invalid stats field: ${field}`);
};

// Static methods
userSchema.statics.findNearbyUsers = async function(userId, longitude, latitude, maxDistance = 50000) {
  const user = await this.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  
  return this.find({
    _id: { $ne: userId },
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    'privacySettings.showInNearby': true,
    isBlocked: false
  }).select('username displayName profilePicture location lastSeen currentStreak streakReward');
};

userSchema.statics.searchUsers = async function(query, userId, limit = 20) {
  return this.find({
    $and: [
      {
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { displayName: { $regex: query, $options: 'i' } },
          { bio: { $regex: query, $options: 'i' } }
        ]
      },
      { _id: { $ne: userId } },
      { isBlocked: false }
    ]
  })
  .select('username displayName profilePicture currentStreak streakReward')
  .limit(limit);
};

userSchema.statics.getOnlineUsers = async function() {
  return this.find({
    isOnline: true,
    'privacySettings.showOnlineStatus': true
  }).select('username displayName profilePicture lastSeen');
};

module.exports = mongoose.model('User', userSchema);