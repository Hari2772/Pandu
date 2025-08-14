const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const constants = require('../utils/constants');

const userSchema = new mongoose.Schema({
  // Basic Information
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_]+$/
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  bio: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  profilePicture: {
    type: String,
    default: ''
  },
  coverPhoto: {
    type: String,
    default: ''
  },
  phoneNumber: {
    type: String,
    sparse: true,
    validate: {
      validator: function(v) {
        return !v || /^\+?[\d\s\-\(\)]{10,}$/.test(v);
      },
      message: 'Please enter a valid phone number'
    }
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: function(v) {
        return !v || v < new Date();
      },
      message: 'Date of birth cannot be in the future'
    }
  },

  // Authentication
  password: {
    type: String,
    required: function() {
      return !this.googleId && !this.facebookId;
    },
    minlength: 8
  },
  googleId: {
    type: String,
    sparse: true
  },
  facebookId: {
    type: String,
    sparse: true
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'facebook'],
    default: 'local'
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,

  // Location & Proximity
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
    }
  },
  tier: {
    type: Number,
    min: 0,
    max: 5,
    default: 5
  },
  isLocationPublic: {
    type: Boolean,
    default: true
  },

  // Social Features
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
    sentAt: {
      type: Date,
      default: Date.now
    }
  }],
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

  // Streaks & Achievements
  currentStreak: {
    type: Number,
    default: 0,
    min: 0
  },
  longestStreak: {
    type: Number,
    default: 0,
    min: 0
  },
  lastActiveDate: {
    type: Date,
    default: Date.now
  },
  achievements: [{
    name: String,
    description: String,
    unlockedAt: {
      type: Date,
      default: Date.now
    },
    icon: String
  }],

  // Status & Activity
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
  role: {
    type: String,
    enum: Object.values(constants.USER_ROLES),
    default: 'user'
  },

  // Preferences
  preferences: {
    notifications: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: Object.values(constants.PRIVACY_LEVELS),
        default: 'public'
      },
      locationVisibility: {
        type: String,
        enum: Object.values(constants.PRIVACY_LEVELS),
        default: 'friends'
      },
      onlineStatus: {
        type: String,
        enum: Object.values(constants.PRIVACY_LEVELS),
        default: 'friends'
      }
    },
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
  },

  // Statistics
  stats: {
    totalMessages: { type: Number, default: 0 },
    totalCalls: { type: Number, default: 0 },
    totalStories: { type: Number, default: 0 },
    totalFriends: { type: Number, default: 0 },
    totalGroups: { type: Number, default: 0 },
    lastMessageAt: Date,
    lastCallAt: Date,
    lastStoryAt: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSchema.index({ location: '2dsphere' });
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ phoneNumber: 1 }, { sparse: true });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ facebookId: 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastSeen: -1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ tier: 1 });
userSchema.index({ 'friends.userId': 1 });
userSchema.index({ 'blockedUsers.userId': 1 });
userSchema.index({ 'friendRequests.from': 1 });

// Virtuals
userSchema.virtual('fullName').get(function() {
  return this.displayName;
});

userSchema.virtual('age').get(function() {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
});

userSchema.virtual('isVerified').get(function() {
  return this.isEmailVerified;
});

// Methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.hashPassword = async function() {
  if (this.password && this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
};

userSchema.methods.updateLocation = function(coordinates, accuracy) {
  this.location.coordinates = coordinates;
  this.location.accuracy = accuracy;
  this.location.lastUpdated = new Date();
  this.lastSeen = new Date();
  this.isOnline = true;
};

userSchema.methods.addFriend = function(userId) {
  const existingFriend = this.friends.find(f => f.userId.equals(userId));
  if (!existingFriend) {
    this.friends.push({ userId, status: 'accepted' });
    this.stats.totalFriends = this.friends.filter(f => f.status === 'accepted').length;
  }
};

userSchema.methods.removeFriend = function(userId) {
  this.friends = this.friends.filter(f => !f.userId.equals(userId));
  this.stats.totalFriends = this.friends.filter(f => f.status === 'accepted').length;
};

userSchema.methods.blockUser = function(userId, reason) {
  const existingBlock = this.blockedUsers.find(b => b.userId.equals(userId));
  if (!existingBlock) {
    this.blockedUsers.push({ userId, reason });
    this.removeFriend(userId);
  }
};

userSchema.methods.unblockUser = function(userId) {
  this.blockedUsers = this.blockedUsers.filter(b => !b.userId.equals(userId));
};

userSchema.methods.updateStreak = function() {
  const today = new Date().toDateString();
  const lastActive = this.lastActiveDate.toDateString();
  
  if (today === lastActive) return;
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  
  if (lastActive === yesterdayStr) {
    this.currentStreak++;
    if (this.currentStreak > this.longestStreak) {
      this.longestStreak = this.currentStreak;
    }
  } else {
    this.currentStreak = 1;
  }
  
  this.lastActiveDate = new Date();
};

// Pre-save middleware
userSchema.pre('save', async function(next) {
  try {
    await this.hashPassword();
    this.updateStreak();
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-find middleware
userSchema.pre('find', function() {
  this.where({ isActive: true });
});

userSchema.pre('findOne', function() {
  this.where({ isActive: true });
});

module.exports = mongoose.model('User', userSchema);