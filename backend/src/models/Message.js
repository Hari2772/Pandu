const mongoose = require('mongoose');
const constants = require('../utils/constants');

const messageSchema = new mongoose.Schema({
  // Basic Information
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  content: {
    type: String,
    required: function() {
      return this.type === 'text' || this.type === 'location';
    },
    maxlength: constants.MAX_MESSAGE_LENGTH,
    trim: true
  },
  type: {
    type: String,
    enum: Object.values(constants.MESSAGE_TYPES),
    default: 'text',
    required: true
  },

  // Media Content
  media: {
    url: String,
    thumbnail: String,
    filename: String,
    mimeType: String,
    size: Number,
    duration: Number, // For audio/video
    dimensions: {
      width: Number,
      height: Number
    },
    metadata: mongoose.Schema.Types.Mixed
  },

  // Location Data
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
    accuracy: Number
  },

  // Message Properties
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Reply & Thread
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  threadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  threadCount: {
    type: Number,
    default: 0
  },

  // Recipients & Delivery
  recipients: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deliveredAt: Date,
    readAt: Date,
    deliveredTo: [String], // Device IDs
    readBy: [String] // Device IDs
  }],

  // Reactions
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

  // Voice Message Specific
  voiceMessage: {
    duration: Number,
    waveform: [Number], // Audio waveform data
    transcription: String,
    language: String,
    confidence: Number
  },

  // Sticker Specific
  sticker: {
    packId: String,
    stickerId: String,
    emoji: String
  },

  // System Message
  systemMessage: {
    action: String, // 'user_joined', 'user_left', 'group_created', etc.
    metadata: mongoose.Schema.Types.Mixed
  },

  // Encryption
  encrypted: {
    type: Boolean,
    default: false
  },
  encryptionKey: String,
  signature: String,

  // Analytics
  views: {
    type: Number,
    default: 0
  },
  forwards: {
    type: Number,
    default: 0
  },
  shares: {
    type: Number,
    default: 0
  },

  // Metadata
  clientMessageId: String, // For client-side deduplication
  deviceId: String, // Device that sent the message
  appVersion: String,
  platform: String, // 'ios', 'android', 'web'
  language: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ 'recipients.userId': 1 });
messageSchema.index({ type: 1 });
messageSchema.index({ isDeleted: 1 });
messageSchema.index({ 'reactions.userId': 1 });
messageSchema.index({ replyTo: 1 });
messageSchema.index({ threadId: 1 });
messageSchema.index({ 'recipients.deliveredAt': 1 });
messageSchema.index({ 'recipients.readAt': 1 });

// Virtuals
messageSchema.virtual('isRead').get(function() {
  return this.recipients.every(r => r.readAt);
});

messageSchema.virtual('isDelivered').get(function() {
  return this.recipients.every(r => r.deliveredAt);
});

messageSchema.virtual('reactionCounts').get(function() {
  const counts = {};
  this.reactions.forEach(reaction => {
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  });
  return counts;
});

messageSchema.virtual('hasReactions').get(function() {
  return this.reactions.length > 0;
});

// Methods
messageSchema.methods.addReaction = function(userId, emoji) {
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
  
  return this;
};

messageSchema.methods.markAsDelivered = function(userId, deviceId) {
  const recipient = this.recipients.find(r => r.userId.equals(userId));
  if (recipient) {
    recipient.deliveredAt = new Date();
    if (deviceId && !recipient.deliveredTo.includes(deviceId)) {
      recipient.deliveredTo.push(deviceId);
    }
  }
};

messageSchema.methods.markAsRead = function(userId, deviceId) {
  const recipient = this.recipients.find(r => r.userId.equals(userId));
  if (recipient) {
    recipient.readAt = new Date();
    if (deviceId && !recipient.readBy.includes(deviceId)) {
      recipient.readBy.push(deviceId);
    }
  }
};

messageSchema.methods.edit = function(newContent) {
  if (this.type === 'text') {
    this.editHistory.push({
      content: this.content,
      editedAt: new Date()
    });
    this.content = newContent;
    this.isEdited = true;
    this.editedAt = new Date();
  }
};

messageSchema.methods.softDelete = function(deletedBy) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
};

messageSchema.methods.forward = function() {
  this.forwards += 1;
};

messageSchema.methods.share = function() {
  this.shares += 1;
};

messageSchema.methods.view = function() {
  this.views += 1;
};

// Pre-save middleware
messageSchema.pre('save', function(next) {
  if (this.isModified('content') && this.type === 'text') {
    this.content = this.content.trim();
  }
  next();
});

// Pre-find middleware
messageSchema.pre('find', function() {
  this.where({ isDeleted: false });
});

messageSchema.pre('findOne', function() {
  this.where({ isDeleted: false });
});

// Static methods
messageSchema.statics.findByChat = function(chatId, options = {}) {
  const { page = 1, limit = 50, before, after } = options;
  
  let query = { chatId, isDeleted: false };
  
  if (before) {
    query.createdAt = { ...query.createdAt, $lt: before };
  }
  
  if (after) {
    query.createdAt = { ...query.createdAt, $gt: after };
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('senderId', 'username displayName profilePicture')
    .populate('replyTo', 'content senderId')
    .populate('recipients.userId', 'username displayName profilePicture');
};

messageSchema.statics.findUnreadMessages = function(userId, chatId) {
  return this.find({
    chatId,
    'recipients.userId': userId,
    'recipients.readAt': { $exists: false },
    isDeleted: false
  }).sort({ createdAt: 1 });
};

messageSchema.statics.getReactionStats = function(messageId) {
  return this.aggregate([
    { $match: { _id: mongoose.Types.ObjectId(messageId) } },
    { $unwind: '$reactions' },
    {
      $group: {
        _id: '$reactions.emoji',
        count: { $sum: 1 },
        users: { $addToSet: '$reactions.userId' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('Message', messageSchema);