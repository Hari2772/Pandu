const mongoose = require('mongoose');
const constants = require('../utils/constants');

const chatSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    trim: true,
    maxlength: 100,
    required: function() {
      return this.type === 'group';
    }
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  type: {
    type: String,
    enum: Object.values(constants.CHAT_TYPES),
    required: true,
    default: 'direct'
  },

  // Participants
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['member', 'admin', 'moderator', 'owner'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    lastReadAt: Date,
    lastSeenAt: Date,
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
    permissions: {
      canSendMessages: { type: Boolean, default: true },
      canSendMedia: { type: Boolean, default: true },
      canEditChat: { type: Boolean, default: false },
      canDeleteMessages: { type: Boolean, default: false },
      canInviteUsers: { type: Boolean, default: true },
      canPinMessages: { type: Boolean, default: false }
    }
  }],

  // Group Specific
  groupInfo: {
    avatar: String,
    coverPhoto: String,
    inviteLink: String,
    inviteLinkExpires: Date,
    isPublic: {
      type: Boolean,
      default: false
    },
    maxMembers: {
      type: Number,
      default: 1000,
      max: 10000
    },
    tags: [String],
    category: String,
    location: {
      coordinates: [Number],
      address: String,
      placeName: String
    }
  },

  // Direct Chat Specific
  directChatInfo: {
    isBlocked: {
      type: Boolean,
      default: false
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    blockedAt: Date,
    isFavorite: {
      type: Boolean,
      default: false
    }
  },

  // Message Management
  lastMessage: {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    content: String,
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: String,
    timestamp: Date
  },
  lastMessageAt: Date,
  messageCount: {
    type: Number,
    default: 0
  },
  unreadCounts: {
    type: Map,
    of: Number,
    default: new Map()
  },

  // Pinned Messages
  pinnedMessages: [{
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    pinnedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Chat Settings
  settings: {
    allowMedia: {
      type: Boolean,
      default: true
    },
    allowVoiceMessages: {
      type: Boolean,
      default: true
    },
    allowReactions: {
      type: Boolean,
      default: true
    },
    allowEditing: {
      type: Boolean,
      default: true
    },
    allowDeletion: {
      type: Boolean,
      default: true
    },
    slowMode: {
      enabled: { type: Boolean, default: false },
      interval: { type: Number, default: 0 } // seconds between messages
    },
    autoDelete: {
      enabled: { type: Boolean, default: false },
      afterDays: { type: Number, default: 30 }
    }
  },

  // Privacy & Security
  privacy: {
    visibility: {
      type: String,
      enum: Object.values(constants.PRIVACY_LEVELS),
      default: 'public'
    },
    searchable: {
      type: Boolean,
      default: true
    },
    inviteOnly: {
      type: Boolean,
      default: false
    },
    requireApproval: {
      type: Boolean,
      default: false
    }
  },

  // Encryption
  encrypted: {
    type: Boolean,
    default: false
  },
  encryptionKey: String,
  publicKey: String,

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

  // Analytics
  stats: {
    totalMessages: { type: Number, default: 0 },
    totalParticipants: { type: Number, default: 0 },
    totalAdmins: { type: Number, default: 0 },
    averageMessagesPerDay: { type: Number, default: 0 },
    mostActiveUser: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      messageCount: { type: Number, default: 0 }
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
chatSchema.index({ participants: 1 });
chatSchema.index({ type: 1 });
chatSchema.index({ lastMessageAt: -1 });
chatSchema.index({ createdAt: -1 });
chatSchema.index({ 'participants.userId': 1 });
chatSchema.index({ 'participants.role': 1 });
chatSchema.index({ isActive: 1 });
chatSchema.index({ isArchived: 1 });
chatSchema.index({ 'groupInfo.isPublic': 1 });
chatSchema.index({ 'groupInfo.category': 1 });
chatSchema.index({ 'groupInfo.location.coordinates': '2dsphere' });

// Virtuals
chatSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});

chatSchema.virtual('adminCount').get(function() {
  return this.participants.filter(p => 
    ['admin', 'owner'].includes(p.role)
  ).length;
});

chatSchema.virtual('isGroup').get(function() {
  return this.type === 'group';
});

chatSchema.virtual('isDirect').get(function() {
  return this.type === 'direct';
});

chatSchema.virtual('owner').get(function() {
  return this.participants.find(p => p.role === 'owner');
});

chatSchema.virtual('admins').get(function() {
  return this.participants.filter(p => 
    ['admin', 'owner'].includes(p.role)
  );
});

// Methods
chatSchema.methods.addParticipant = function(userId, role = 'member') {
  const existingParticipant = this.participants.find(p => 
    p.userId.equals(userId)
  );
  
  if (!existingParticipant) {
    this.participants.push({
      userId,
      role,
      joinedAt: new Date()
    });
    this.stats.totalParticipants = this.participants.length;
  }
  
  return this;
};

chatSchema.methods.removeParticipant = function(userId) {
  this.participants = this.participants.filter(p => 
    !p.userId.equals(userId)
  );
  this.stats.totalParticipants = this.participants.length;
  
  // Remove from unread counts
  this.unreadCounts.delete(userId.toString());
  
  return this;
};

chatSchema.methods.updateParticipantRole = function(userId, newRole) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.role = newRole;
    
    // Update admin count
    this.stats.totalAdmins = this.participants.filter(p => 
      ['admin', 'owner'].includes(p.role)
    ).length;
  }
  
  return this;
};

chatSchema.methods.muteParticipant = function(userId, duration = null) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.isMuted = true;
    participant.muteUntil = duration ? new Date(Date.now() + duration) : null;
  }
  
  return this;
};

chatSchema.methods.unmuteParticipant = function(userId) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.isMuted = false;
    participant.muteUntil = null;
  }
  
  return this;
};

chatSchema.methods.blockParticipant = function(userId, blockedBy, reason) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.isBlocked = true;
    participant.blockedAt = new Date();
    participant.blockedBy = blockedBy;
  }
  
  return this;
};

chatSchema.methods.unblockParticipant = function(userId) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.isBlocked = false;
    participant.blockedAt = null;
    participant.blockedBy = null;
  }
  
  return this;
};

chatSchema.methods.pinMessage = function(messageId, pinnedBy) {
  const existingPin = this.pinnedMessages.find(p => 
    p.messageId.equals(messageId)
  );
  
  if (!existingPin) {
    this.pinnedMessages.push({
      messageId,
      pinnedBy,
      pinnedAt: new Date()
    });
  }
  
  return this;
};

chatSchema.methods.unpinMessage = function(messageId) {
  this.pinnedMessages = this.pinnedMessages.filter(p => 
    !p.messageId.equals(messageId)
  );
  
  return this;
};

chatSchema.methods.updateLastMessage = function(message) {
  this.lastMessage = {
    messageId: message._id,
    content: message.content,
    senderId: message.senderId,
    type: message.type,
    timestamp: message.createdAt
  };
  this.lastMessageAt = message.createdAt;
  this.messageCount += 1;
  
  return this;
};

chatSchema.methods.markAsRead = function(userId, messageId = null) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.lastReadAt = new Date();
    
    if (messageId) {
      participant.lastSeenAt = new Date();
    }
  }
  
  // Reset unread count for this user
  this.unreadCounts.set(userId.toString(), 0);
  
  return this;
};

chatSchema.methods.incrementUnreadCount = function(userId) {
  const currentCount = this.unreadCounts.get(userId.toString()) || 0;
  this.unreadCounts.set(userId.toString(), currentCount + 1);
  
  return this;
};

chatSchema.methods.canUserSendMessage = function(userId) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (!participant) return false;
  
  if (participant.isBlocked) return false;
  if (participant.isMuted) {
    if (participant.muteUntil && participant.muteUntil > new Date()) {
      return false;
    }
  }
  
  return participant.permissions.canSendMessages;
};

chatSchema.methods.canUserSendMedia = function(userId) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (!participant) return false;
  
  return participant.permissions.canSendMedia && this.settings.allowMedia;
};

// Static methods
chatSchema.statics.findByUser = function(userId, options = {}) {
  const { type, page = 1, limit = 20 } = options;
  
  let query = {
    'participants.userId': userId,
    isActive: true,
    isArchived: false
  };
  
  if (type) {
    query.type = type;
  }
  
  return this.find(query)
    .sort({ lastMessageAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('participants.userId', 'username displayName profilePicture')
    .populate('lastMessage.senderId', 'username displayName profilePicture');
};

chatSchema.statics.findDirectChat = function(userId1, userId2) {
  return this.findOne({
    type: 'direct',
    'participants.userId': { $all: [userId1, userId2] },
    isActive: true
  }).populate('participants.userId', 'username displayName profilePicture');
};

chatSchema.statics.findPublicGroups = function(options = {}) {
  const { category, location, page = 1, limit = 20 } = options;
  
  let query = {
    type: 'group',
    'groupInfo.isPublic': true,
    isActive: true
  };
  
  if (category) {
    query['groupInfo.category'] = category;
  }
  
  if (location) {
    query['groupInfo.location.coordinates'] = {
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
    .sort({ 'stats.totalParticipants': -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('participants.userId', 'username displayName profilePicture');
};

// Pre-save middleware
chatSchema.pre('save', function(next) {
  // Update stats
  this.stats.totalParticipants = this.participants.length;
  this.stats.totalAdmins = this.participants.filter(p => 
    ['admin', 'owner'].includes(p.role)
  ).length;
  
  next();
});

module.exports = mongoose.model('Chat', chatSchema);