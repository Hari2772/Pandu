const mongoose = require('mongoose');
const constants = require('../utils/constants');

const groupSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  avatar: {
    type: String,
    default: ''
  },
  coverPhoto: {
    type: String,
    default: ''
  },

  // Group Type & Category
  type: {
    type: String,
    enum: ['public', 'private', 'secret', 'business', 'community'],
    default: 'private'
  },
  category: {
    type: String,
    enum: ['general', 'business', 'education', 'entertainment', 'sports', 'technology', 'health', 'travel', 'food', 'music', 'gaming', 'other'],
    default: 'general'
  },
  tags: [String],

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
    city: String,
    country: String,
    isLocationPublic: {
      type: Boolean,
      default: false
    }
  },

  // Members & Roles
  members: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'moderator', 'member', 'guest'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastSeenAt: Date,
    lastMessageAt: Date,
    messageCount: {
      type: Number,
      default: 0
    },
    permissions: {
      canSendMessages: { type: Boolean, default: true },
      canSendMedia: { type: Boolean, default: true },
      canEditGroup: { type: Boolean, default: false },
      canDeleteMessages: { type: Boolean, default: false },
      canInviteUsers: { type: Boolean, default: true },
      canPinMessages: { type: Boolean, default: false },
      canManageRoles: { type: Boolean, default: false },
      canViewMembers: { type: Boolean, default: true },
      canViewAnalytics: { type: Boolean, default: false }
    },
    isMuted: {
      type: Boolean,
      default: false
    },
    muteUntil: Date,
    isBlocked: {
      type: Boolean,
      default: false
    },
    blockedAt: Date,
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    blockReason: String
  }],

  // Invitations & Requests
  invitations: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    invitedAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      default: function() {
        return new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)); // 7 days
      }
    },
    message: String,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired'],
      default: 'pending'
    }
  }],
  joinRequests: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    message: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date,
    reviewMessage: String
  }],

  // Group Settings
  settings: {
    maxMembers: {
      type: Number,
      default: 1000,
      min: 2,
      max: 10000
    },
    allowInvites: {
      type: Boolean,
      default: true
    },
    requireApproval: {
      type: Boolean,
      default: false
    },
    allowMemberInvites: {
      type: Boolean,
      default: true
    },
    allowMemberRemoval: {
      type: Boolean,
      default: false
    },
    allowMemberPromotion: {
      type: Boolean,
      default: false
    },
    slowMode: {
      enabled: { type: Boolean, default: false },
      interval: { type: Number, default: 0 } // seconds between messages
    },
    autoDelete: {
      enabled: { type: Boolean, default: false },
      afterDays: { type: Number, default: 30 }
    },
    welcomeMessage: String,
    rules: [String],
    pinnedMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    }
  },

  // Privacy & Visibility
  privacy: {
    isPublic: {
      type: Boolean,
      default: false
    },
    isSearchable: {
      type: Boolean,
      default: true
    },
    showMembers: {
      type: Boolean,
      default: true
    },
    showOnlineStatus: {
      type: Boolean,
      default: true
    },
    allowExternalSharing: {
      type: Boolean,
      default: false
    }
  },

  // Content & Moderation
  moderation: {
    isModerated: {
      type: Boolean,
      default: false
    },
    autoModeration: {
      enabled: { type: Boolean, default: false },
      level: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
    },
    bannedWords: [String],
    allowedDomains: [String],
    blockedDomains: [String],
    moderationQueue: [{
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
      },
      reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reportedAt: {
        type: Date,
        default: Date.now
      },
      reason: String,
      status: {
        type: String,
        enum: ['pending', 'reviewed', 'resolved'],
        default: 'pending'
      },
      action: {
        type: String,
        enum: ['warn', 'mute', 'kick', 'ban', 'none'],
        default: 'none'
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reviewedAt: Date
    }]
  },

  // Activity & Statistics
  activity: {
    lastMessageAt: Date,
    lastActivityAt: Date,
    totalMessages: { type: Number, default: 0 },
    totalMembers: { type: Number, default: 0 },
    totalAdmins: { type: Number, default: 0 },
    averageMessagesPerDay: { type: Number, default: 0 },
    mostActiveUser: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      messageCount: { type: Number, default: 0 }
    },
    growthRate: { type: Number, default: 0 }, // members per month
    retentionRate: { type: Number, default: 0 } // percentage of members who stay
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  archivedAt: Date,
  archivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  language: {
    type: String,
    default: 'en'
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  clientGroupId: String // For client-side deduplication
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
groupSchema.index({ name: 1 });
groupSchema.index({ type: 1 });
groupSchema.index({ category: 1 });
groupSchema.index({ tags: 1 });
groupSchema.index({ 'members.userId': 1 });
groupSchema.index({ 'members.role': 1 });
groupSchema.index({ 'location.coordinates': '2dsphere' });
groupSchema.index({ 'privacy.isPublic': 1 });
groupSchema.index({ 'privacy.isSearchable': 1 });
groupSchema.index({ isActive: 1 });
groupSchema.index({ isArchived: 1 });
groupSchema.index({ createdAt: -1 });
groupSchema.index({ 'activity.lastMessageAt': -1 });
groupSchema.index({ 'activity.lastActivityAt': -1 });

// Virtuals
groupSchema.virtual('memberCount').get(function() {
  return this.members.filter(m => m.isActive).length;
});

groupSchema.virtual('adminCount').get(function() {
  return this.members.filter(m => 
    ['owner', 'admin'].includes(m.role) && m.isActive
  ).length;
});

groupSchema.virtual('moderatorCount').get(function() {
  return this.members.filter(m => 
    ['owner', 'admin', 'moderator'].includes(m.role) && m.isActive
  ).length;
});

groupSchema.virtual('owner').get(function() {
  return this.members.find(m => m.role === 'owner');
});

groupSchema.virtual('admins').get(function() {
  return this.members.filter(m => 
    ['owner', 'admin'].includes(m.role) && m.isActive
  );
});

groupSchema.virtual('moderators').get(function() {
  return this.members.filter(m => 
    ['owner', 'admin', 'moderator'].includes(m.role) && m.isActive
  );
});

groupSchema.virtual('activeMembers').get(function() {
  return this.members.filter(m => m.isActive);
});

groupSchema.virtual('isPublic').get(function() {
  return this.privacy.isPublic;
});

groupSchema.virtual('isSearchable').get(function() {
  return this.privacy.isSearchable;
});

// Methods
groupSchema.methods.addMember = function(userId, role = 'member', invitedBy = null) {
  const existingMember = this.members.find(m => m.userId.equals(userId));
  
  if (!existingMember) {
    this.members.push({
      userId,
      role,
      invitedBy,
      joinedAt: new Date()
    });
    
    this.activity.totalMembers = this.members.filter(m => m.isActive).length;
    this.activity.lastActivityAt = new Date();
  }
  
  return this;
};

groupSchema.methods.removeMember = function(userId, removedBy = null, reason = '') {
  const member = this.members.find(m => m.userId.equals(userId));
  
  if (member) {
    member.isActive = false;
    member.removedAt = new Date();
    member.removedBy = removedBy;
    member.removalReason = reason;
    
    this.activity.totalMembers = this.members.filter(m => m.isActive).length;
    this.activity.lastActivityAt = new Date();
  }
  
  return this;
};

groupSchema.methods.updateMemberRole = function(userId, newRole, updatedBy = null) {
  const member = this.members.find(m => m.userId.equals(userId));
  
  if (member) {
    member.role = newRole;
    member.roleUpdatedAt = new Date();
    member.roleUpdatedBy = updatedBy;
    
    // Update admin count
    this.activity.totalAdmins = this.members.filter(m => 
      ['owner', 'admin'].includes(m.role) && m.isActive
    ).length;
  }
  
  return this;
};

groupSchema.methods.muteMember = function(userId, duration = null, mutedBy = null, reason = '') {
  const member = this.members.find(m => m.userId.equals(userId));
  
  if (member) {
    member.isMuted = true;
    member.muteUntil = duration ? new Date(Date.now() + duration) : null;
    member.mutedAt = new Date();
    member.mutedBy = mutedBy;
    member.muteReason = reason;
  }
  
  return this;
};

groupSchema.methods.unmuteMember = function(userId) {
  const member = this.members.find(m => m.userId.equals(userId));
  
  if (member) {
    member.isMuted = false;
    member.muteUntil = null;
    member.mutedAt = null;
    member.mutedBy = null;
    member.muteReason = null;
  }
  
  return this;
};

groupSchema.methods.blockMember = function(userId, blockedBy = null, reason = '') {
  const member = this.members.find(m => m.userId.equals(userId));
  
  if (member) {
    member.isBlocked = true;
    member.blockedAt = new Date();
    member.blockedBy = blockedBy;
    member.blockReason = reason;
  }
  
  return this;
};

groupSchema.methods.unblockMember = function(userId) {
  const member = this.members.find(m => m.userId.equals(userId));
  
  if (member) {
    member.isBlocked = false;
    member.blockedAt = null;
    member.blockedBy = null;
    member.blockReason = null;
  }
  
  return this;
};

groupSchema.methods.addInvitation = function(userId, invitedBy, message = '') {
  const existingInvitation = this.invitations.find(i => i.userId.equals(userId));
  
  if (!existingInvitation) {
    this.invitations.push({
      userId,
      invitedBy,
      message,
      invitedAt: new Date()
    });
  }
  
  return this;
};

groupSchema.methods.removeInvitation = function(userId) {
  this.invitations = this.invitations.filter(i => !i.userId.equals(userId));
  return this;
};

groupSchema.methods.addJoinRequest = function(userId, message = '') {
  const existingRequest = this.joinRequests.find(r => r.userId.equals(userId));
  
  if (!existingRequest) {
    this.joinRequests.push({
      userId,
      message,
      requestedAt: new Date()
    });
  }
  
  return this;
};

groupSchema.methods.approveJoinRequest = function(userId, approvedBy, message = '') {
  const request = this.joinRequests.find(r => r.userId.equals(userId));
  
  if (request) {
    request.status = 'approved';
    request.reviewedBy = approvedBy;
    request.reviewedAt = new Date();
    request.reviewMessage = message;
    
    // Add member to group
    this.addMember(userId, 'member', approvedBy);
  }
  
  return this;
};

groupSchema.methods.rejectJoinRequest = function(userId, rejectedBy, message = '') {
  const request = this.joinRequests.find(r => r.userId.equals(userId));
  
  if (request) {
    request.status = 'rejected';
    request.reviewedBy = rejectedBy;
    request.reviewedAt = new Date();
    request.reviewMessage = message;
  }
  
  return this;
};

groupSchema.methods.canUserPerformAction = function(userId, action) {
  const member = this.members.find(m => m.userId.equals(userId) && m.isActive);
  
  if (!member) return false;
  
  switch (action) {
    case 'send_message':
      return member.permissions.canSendMessages && !member.isMuted && !member.isBlocked;
    case 'send_media':
      return member.permissions.canSendMedia && !member.isMuted && !member.isBlocked;
    case 'edit_group':
      return member.permissions.canEditGroup;
    case 'delete_messages':
      return member.permissions.canDeleteMessages;
    case 'invite_users':
      return member.permissions.canInviteUsers;
    case 'pin_messages':
      return member.permissions.canPinMessages;
    case 'manage_roles':
      return member.permissions.canManageRoles;
    case 'view_members':
      return member.permissions.canViewMembers;
    case 'view_analytics':
      return member.permissions.canViewAnalytics;
    default:
      return false;
  }
};

groupSchema.methods.updateActivity = function() {
  this.activity.lastActivityAt = new Date();
  this.activity.totalMembers = this.members.filter(m => m.isActive).length;
  this.activity.totalAdmins = this.members.filter(m => 
    ['owner', 'admin'].includes(m.role) && m.isActive
  ).length;
  
  return this;
};

groupSchema.methods.archive = function(archivedBy) {
  this.isArchived = true;
  this.archivedAt = new Date();
  this.archivedBy = archivedBy;
  
  return this;
};

groupSchema.methods.unarchive = function() {
  this.isArchived = false;
  this.archivedAt = null;
  this.archivedBy = null;
  
  return this;
};

groupSchema.methods.softDelete = function(deletedBy) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  
  return this;
};

groupSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  
  return this;
};

// Static methods
groupSchema.statics.findByUser = function(userId, options = {}) {
  const { type, category, page = 1, limit = 20 } = options;
  
  let query = {
    'members.userId': userId,
    'members.isActive': true,
    isActive: true,
    isDeleted: false
  };
  
  if (type) query.type = type;
  if (category) query.category = category;
  
  return this.find(query)
    .sort({ 'activity.lastMessageAt': -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('members.userId', 'username displayName profilePicture')
    .populate('createdBy', 'username displayName profilePicture');
};

groupSchema.statics.findPublicGroups = function(options = {}) {
  const { category, location, page = 1, limit = 20 } = options;
  
  let query = {
    'privacy.isPublic': true,
    'privacy.isSearchable': true,
    isActive: true,
    isDeleted: false
  };
  
  if (category) query.category = category;
  
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
    .sort({ 'activity.totalMembers': -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('members.userId', 'username displayName profilePicture')
    .populate('createdBy', 'username displayName profilePicture');
};

groupSchema.statics.getGroupStats = function(groupId, period = '30d') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  return this.aggregate([
    {
      $match: {
        _id: mongoose.Types.ObjectId(groupId),
        isActive: true,
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalMembers: { $sum: '$activity.totalMembers' },
        totalMessages: { $sum: '$activity.totalMessages' },
        averageMessagesPerDay: { $avg: '$activity.averageMessagesPerDay' },
        growthRate: { $avg: '$activity.growthRate' },
        retentionRate: { $avg: '$activity.retentionRate' }
      }
    }
  ]);
};

// Pre-save middleware
groupSchema.pre('save', function(next) {
  // Update activity stats
  this.updateActivity();
  
  // Set createdBy if not set
  if (!this.createdBy && this.members.length > 0) {
    const owner = this.members.find(m => m.role === 'owner');
    if (owner) {
      this.createdBy = owner.userId;
    }
  }
  
  next();
});

// Pre-find middleware
groupSchema.pre('find', function() {
  this.where({ isDeleted: false });
});

groupSchema.pre('findOne', function() {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model('Group', groupSchema);