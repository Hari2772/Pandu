const mongoose = require('mongoose');

const dailyStreakSchema = new mongoose.Schema({
  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Date of the streak entry
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // Streak information
  streakCount: {
    type: Number,
    required: true,
    min: [1, 'Streak count must be at least 1'],
    max: [365, 'Streak count cannot exceed 365']
  },
  
  // Activity type that contributed to the streak
  activityType: {
    type: String,
    enum: ['login', 'message', 'story', 'reaction', 'friend_request', 'location_update', 'live_broadcast'],
    required: true
  },
  
  // Activity details
  activityDetails: {
    messageCount: {
      type: Number,
      default: 0
    },
    storyCount: {
      type: Number,
      default: 0
    },
    reactionCount: {
      type: Number,
      default: 0
    },
    friendRequestsSent: {
      type: Number,
      default: 0
    },
    friendRequestsAccepted: {
      type: Number,
      default: 0
    },
    locationUpdates: {
      type: Number,
      default: 0
    },
    broadcastMinutes: {
      type: Number,
      default: 0
    }
  },
  
  // Reward information
  reward: {
    type: {
      type: String,
      enum: ['none', 'bronze', 'silver', 'gold', 'platinum'],
      default: 'none'
    },
    unlockedAt: {
      type: Date
    },
    description: {
      type: String
    },
    benefits: [{
      type: String,
      enum: [
        'priority_listing',
        'extended_story_duration',
        'larger_visibility_radius',
        'custom_reactions',
        'advanced_filters',
        'ad_free_experience',
        'exclusive_features',
        'profile_badge',
        'custom_username_color',
        'increased_message_limit'
      ]
    }]
  },
  
  // Social features
  social: {
    sharedOnSocial: {
      type: Boolean,
      default: false
    },
    socialPlatforms: [{
      type: String,
      enum: ['facebook', 'twitter', 'instagram', 'snapchat', 'tiktok']
    }],
    shareCount: {
      type: Number,
      default: 0
    },
    congratulatedBy: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      congratulatedAt: {
        type: Date,
        default: Date.now
      },
      message: {
        type: String,
        maxlength: [100, 'Congratulation message cannot exceed 100 characters']
      }
    }]
  },
  
  // Achievement tracking
  achievements: [{
    type: {
      type: String,
      enum: [
        'first_day',
        'week_streak',
        'month_streak',
        'quarter_streak',
        'half_year',
        'year_streak',
        'social_butterfly',
        'content_creator',
        'friend_collector',
        'location_explorer',
        'broadcast_star',
        'reaction_master'
      ]
    },
    unlockedAt: {
      type: Date,
      default: Date.now
    },
    description: {
      type: String
    },
    icon: {
      type: String
    }
  }],
  
  // Statistics for the day
  stats: {
    totalMessages: {
      type: Number,
      default: 0
    },
    totalStories: {
      type: Number,
      default: 0
    },
    totalReactions: {
      type: Number,
      default: 0
    },
    totalViews: {
      type: Number,
      default: 0
    },
    totalFriends: {
      type: Number,
      default: 0
    },
    totalBroadcastMinutes: {
      type: Number,
      default: 0
    },
    totalDistanceTraveled: {
      type: Number, // in meters
      default: 0
    }
  },
  
  // Streak milestones
  milestones: [{
    type: {
      type: String,
      enum: ['7_days', '30_days', '100_days', '365_days', 'custom']
    },
    reachedAt: {
      type: Date,
      default: Date.now
    },
    streakCount: {
      type: Number
    },
    reward: {
      type: String
    }
  }],
  
  // Streak status
  status: {
    type: String,
    enum: ['active', 'broken', 'completed'],
    default: 'active'
  },
  
  // Notes or comments
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal performance
dailyStreakSchema.index({ userId: 1, date: -1 }, { unique: true });
dailyStreakSchema.index({ date: 1 });
dailyStreakSchema.index({ 'reward.type': 1 });
dailyStreakSchema.index({ status: 1 });
dailyStreakSchema.index({ streakCount: -1 });
dailyStreakSchema.index({ 'achievements.type': 1 });

// Compound indexes
dailyStreakSchema.index({ userId: 1, 'reward.type': 1 });
dailyStreakSchema.index({ userId: 1, status: 1, date: -1 });

// Virtual for formatted date
dailyStreakSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Virtual for reward level description
dailyStreakSchema.virtual('rewardDescription').get(function() {
  const descriptions = {
    none: 'Keep going!',
    bronze: 'Bronze Streak - 7 days of consistency!',
    silver: 'Silver Streak - 30 days of dedication!',
    gold: 'Gold Streak - 100 days of excellence!',
    platinum: 'Platinum Streak - 365 days of mastery!'
  };
  return descriptions[this.reward.type] || descriptions.none;
});

// Virtual for next milestone
dailyStreakSchema.virtual('nextMilestone').get(function() {
  const milestones = [7, 30, 100, 365];
  const currentStreak = this.streakCount;
  
  for (const milestone of milestones) {
    if (currentStreak < milestone) {
      return {
        days: milestone,
        daysRemaining: milestone - currentStreak,
        reward: this.getRewardForStreak(milestone)
      };
    }
  }
  
  return null; // All milestones reached
});

// Pre-save middleware
dailyStreakSchema.pre('save', function(next) {
  // Set reward based on streak count
  this.reward.type = this.getRewardForStreak(this.streakCount);
  
  // Set reward benefits
  this.reward.benefits = this.getBenefitsForReward(this.reward.type);
  
  // Update status
  if (this.streakCount >= 365) {
    this.status = 'completed';
  }
  
  // Add milestones
  this.addMilestones();
  
  // Add achievements
  this.addAchievements();
  
  next();
});

// Instance methods
dailyStreakSchema.methods.getRewardForStreak = function(streakCount) {
  if (streakCount >= 365) return 'platinum';
  if (streakCount >= 100) return 'gold';
  if (streakCount >= 30) return 'silver';
  if (streakCount >= 7) return 'bronze';
  return 'none';
};

dailyStreakSchema.methods.getBenefitsForReward = function(rewardType) {
  const benefits = {
    none: [],
    bronze: ['priority_listing', 'profile_badge'],
    silver: ['priority_listing', 'profile_badge', 'extended_story_duration', 'larger_visibility_radius'],
    gold: ['priority_listing', 'profile_badge', 'extended_story_duration', 'larger_visibility_radius', 'custom_reactions', 'advanced_filters'],
    platinum: ['priority_listing', 'profile_badge', 'extended_story_duration', 'larger_visibility_radius', 'custom_reactions', 'advanced_filters', 'ad_free_experience', 'exclusive_features', 'custom_username_color', 'increased_message_limit']
  };
  
  return benefits[rewardType] || [];
};

dailyStreakSchema.methods.addMilestones = function() {
  const milestones = [7, 30, 100, 365];
  const currentStreak = this.streakCount;
  
  milestones.forEach(milestone => {
    if (currentStreak >= milestone) {
      const existingMilestone = this.milestones.find(m => m.type === `${milestone}_days`);
      if (!existingMilestone) {
        this.milestones.push({
          type: `${milestone}_days`,
          reachedAt: new Date(),
          streakCount: milestone,
          reward: this.getRewardForStreak(milestone)
        });
      }
    }
  });
};

dailyStreakSchema.methods.addAchievements = function() {
  const achievements = [];
  
  // First day achievement
  if (this.streakCount === 1) {
    achievements.push({
      type: 'first_day',
      description: 'Started your streak journey!',
      icon: '🌟'
    });
  }
  
  // Week streak achievement
  if (this.streakCount === 7) {
    achievements.push({
      type: 'week_streak',
      description: 'Completed a week of consistency!',
      icon: '📅'
    });
  }
  
  // Month streak achievement
  if (this.streakCount === 30) {
    achievements.push({
      type: 'month_streak',
      description: 'A full month of dedication!',
      icon: '📆'
    });
  }
  
  // Quarter streak achievement
  if (this.streakCount === 100) {
    achievements.push({
      type: 'quarter_streak',
      description: '100 days of excellence!',
      icon: '💎'
    });
  }
  
  // Half year achievement
  if (this.streakCount === 180) {
    achievements.push({
      type: 'half_year',
      description: 'Half a year of consistency!',
      icon: '🎯'
    });
  }
  
  // Year streak achievement
  if (this.streakCount === 365) {
    achievements.push({
      type: 'year_streak',
      description: 'A full year of mastery!',
      icon: '👑'
    });
  }
  
  // Social butterfly achievement
  if (this.stats.totalFriends >= 50) {
    achievements.push({
      type: 'social_butterfly',
      description: 'Connected with 50+ friends!',
      icon: '🦋'
    });
  }
  
  // Content creator achievement
  if (this.stats.totalStories >= 100) {
    achievements.push({
      type: 'content_creator',
      description: 'Created 100+ stories!',
      icon: '📝'
    });
  }
  
  // Add new achievements
  achievements.forEach(achievement => {
    const existingAchievement = this.achievements.find(a => a.type === achievement.type);
    if (!existingAchievement) {
      this.achievements.push(achievement);
    }
  });
};

dailyStreakSchema.methods.addCongratulation = async function(fromUserId, message = '') {
  const existingCongratulation = this.social.congratulatedBy.find(c => 
    c.userId.toString() === fromUserId.toString()
  );
  
  if (existingCongratulation) {
    throw new Error('Already congratulated by this user');
  }
  
  this.social.congratulatedBy.push({
    userId: fromUserId,
    congratulatedAt: new Date(),
    message
  });
  
  return this.save();
};

dailyStreakSchema.methods.shareOnSocial = async function(platforms) {
  this.social.sharedOnSocial = true;
  this.social.socialPlatforms = platforms;
  this.social.shareCount++;
  
  return this.save();
};

// Static methods
dailyStreakSchema.statics.getUserStreak = async function(userId, date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return this.findOne({
    userId,
    date: { $gte: startOfDay, $lte: endOfDay }
  });
};

dailyStreakSchema.statics.getUserStreakHistory = async function(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    userId,
    date: { $gte: startDate }
  }).sort({ date: -1 });
};

dailyStreakSchema.statics.getCurrentStreak = async function(userId) {
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  
  const streak = await this.findOne({
    userId,
    date: { $gte: startOfDay }
  });
  
  return streak ? streak.streakCount : 0;
};

dailyStreakSchema.statics.getLongestStreak = async function(userId) {
  const result = await this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    { $group: { _id: null, maxStreak: { $max: '$streakCount' } } }
  ]);
  
  return result.length > 0 ? result[0].maxStreak : 0;
};

dailyStreakSchema.statics.getTopStreaks = async function(limit = 10) {
  return this.aggregate([
    { $sort: { streakCount: -1, date: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $project: {
        userId: 1,
        streakCount: 1,
        date: 1,
        'reward.type': 1,
        'user.username': 1,
        'user.displayName': 1,
        'user.profilePicture': 1
      }
    }
  ]);
};

dailyStreakSchema.statics.getStreakStats = async function(userId, days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const stats = await this.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        date: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalDays: { $sum: 1 },
        maxStreak: { $max: '$streakCount' },
        avgStreak: { $avg: '$streakCount' },
        totalMessages: { $sum: '$stats.totalMessages' },
        totalStories: { $sum: '$stats.totalStories' },
        totalReactions: { $sum: '$stats.totalReactions' },
        totalViews: { $sum: '$stats.totalViews' }
      }
    }
  ]);
  
  return stats[0] || {
    totalDays: 0,
    maxStreak: 0,
    avgStreak: 0,
    totalMessages: 0,
    totalStories: 0,
    totalReactions: 0,
    totalViews: 0
  };
};

dailyStreakSchema.statics.cleanupOldStreaks = async function(daysToKeep = 365) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const result = await this.deleteMany({
    date: { $lt: cutoffDate }
  });
  
  return result.deletedCount;
};

module.exports = mongoose.model('DailyStreak', dailyStreakSchema);