const mongoose = require('mongoose');
const constants = require('../utils/constants');

const recordingSchema = new mongoose.Schema({
  // Basic Information
  recordingId: {
    type: String,
    required: true,
    unique: true
  },
  callId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    trim: true,
    maxlength: 200,
    default: 'Call Recording'
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // File Information
  file: {
    path: {
      type: String,
      required: true
    },
    filename: {
      type: String,
      required: true
    },
    originalName: String,
    mimeType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true,
      min: 0
    },
    extension: String,
    checksum: String, // MD5 or SHA256 hash
    isCompressed: {
      type: Boolean,
      default: false
    },
    compressionRatio: Number
  },

  // Recording Details
  type: {
    type: String,
    enum: ['audio', 'video', 'screen', 'mixed'],
    required: true
  },
  quality: {
    type: String,
    enum: ['low', 'medium', 'high', 'ultra'],
    default: 'medium'
  },
  duration: {
    type: Number,
    required: true,
    min: 0
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },

  // Media Properties
  media: {
    audio: {
      codec: String,
      bitrate: Number,
      sampleRate: Number,
      channels: Number,
      quality: String
    },
    video: {
      codec: String,
      bitrate: Number,
      frameRate: Number,
      resolution: {
        width: Number,
        height: Number
      },
      quality: String
    },
    screen: {
      resolution: {
        width: Number,
        height: Number
      },
      frameRate: Number,
      quality: String
    }
  },

  // Transcription
  transcription: {
    text: String,
    language: {
      type: String,
      default: 'en'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    segments: [{
      start: Number,
      end: Number,
      text: String,
      speaker: String,
      confidence: Number
    }],
    isProcessed: {
      type: Boolean,
      default: false
    },
    processedAt: Date
  },

  // Privacy & Permissions
  privacy: {
    level: {
      type: String,
      enum: Object.values(constants.PRIVACY_LEVELS),
      default: 'private'
    },
    isPublic: {
      type: Boolean,
      default: false
    },
    isUnlisted: {
      type: Boolean,
      default: false
    },
    password: String,
    expiresAt: Date
  },

  permissions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['owner', 'viewer', 'editor', 'admin'],
      default: 'viewer'
    },
    grantedAt: {
      type: Date,
      default: Date.now
    },
    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    canView: { type: Boolean, default: true },
    canDownload: { type: Boolean, default: false },
    canEdit: { type: Boolean, default: false },
    canDelete: { type: Boolean, default: false },
    canShare: { type: Boolean, default: false },
    canTranscribe: { type: Boolean, default: false }
  }],

  // Sharing & Distribution
  sharing: {
    isShareable: {
      type: Boolean,
      default: true
    },
    shareLink: String,
    shareLinkExpires: Date,
    embedCode: String,
    downloadCount: {
      type: Number,
      default: 0
    },
    viewCount: {
      type: Number,
      default: 0
    },
    shareCount: {
      type: Number,
      default: 0
    }
  },

  // Processing Status
  processing: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    startedAt: Date,
    completedAt: Date,
    error: String,
    retryCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      default: 3
    }
  },

  // Storage & CDN
  storage: {
    provider: {
      type: String,
      enum: ['local', 'aws', 'gcp', 'azure'],
      default: 'local'
    },
    bucket: String,
    region: String,
    cdnUrl: String,
    isBackedUp: {
      type: Boolean,
      default: false
    },
    backupLocation: String,
    retentionPolicy: String
  },

  // Analytics & Metrics
  analytics: {
    totalViews: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    totalDownloads: { type: Number, default: 0 },
    averageWatchTime: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 },
    lastViewedAt: Date,
    lastDownloadedAt: Date
  },

  // Tags & Categories
  tags: [String],
  category: String,
  language: {
    type: String,
    default: 'en'
  },

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

  // Metadata
  metadata: mongoose.Schema.Types.Mixed,
  clientRecordingId: String, // For client-side deduplication
  deviceId: String,
  platform: String,
  appVersion: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
recordingSchema.index({ recordingId: 1 }, { unique: true });
recordingSchema.index({ callId: 1 });
recordingSchema.index({ userId: 1 });
recordingSchema.index({ createdAt: -1 });
recordingSchema.index({ status: 1 });
recordingSchema.index({ 'privacy.level': 1 });
recordingSchema.index({ 'privacy.isPublic': 1 });
recordingSchema.index({ type: 1 });
recordingSchema.index({ quality: 1 });
recordingSchema.index({ 'processing.status': 1 });
recordingSchema.index({ 'permissions.userId': 1 });
recordingSchema.index({ tags: 1 });
recordingSchema.index({ category: 1 });
recordingSchema.index({ 'storage.provider': 1 });
recordingSchema.index({ 'sharing.isShareable': 1 });

// Virtuals
recordingSchema.virtual('isProcessed').get(function() {
  return this.processing.status === 'completed';
});

recordingSchema.virtual('isPublic').get(function() {
  return this.privacy.isPublic;
});

recordingSchema.virtual('isExpired').get(function() {
  return this.privacy.expiresAt && this.privacy.expiresAt < new Date();
});

recordingSchema.virtual('fileSizeMB').get(function() {
  return (this.file.size / (1024 * 1024)).toFixed(2);
});

recordingSchema.virtual('durationFormatted').get(function() {
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = this.duration % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

recordingSchema.virtual('owner').get(function() {
  return this.permissions.find(p => p.type === 'owner');
});

// Methods
recordingSchema.methods.addPermission = function(userId, type, grantedBy, permissions = {}) {
  const existingPermission = this.permissions.find(p => p.userId.equals(userId));
  
  if (existingPermission) {
    Object.assign(existingPermission, { type, grantedBy, ...permissions });
  } else {
    this.permissions.push({
      userId,
      type,
      grantedBy,
      ...permissions
    });
  }
  
  return this;
};

recordingSchema.methods.removePermission = function(userId) {
  this.permissions = this.permissions.filter(p => !p.userId.equals(userId));
  return this;
};

recordingSchema.methods.updatePermission = function(userId, updates) {
  const permission = this.permissions.find(p => p.userId.equals(userId));
  if (permission) {
    Object.assign(permission, updates);
  }
  return this;
};

recordingSchema.methods.canUserAccess = function(userId, action = 'view') {
  const permission = this.permissions.find(p => p.userId.equals(userId));
  
  if (!permission) return false;
  
  switch (action) {
    case 'view':
      return permission.canView;
    case 'download':
      return permission.canDownload;
    case 'edit':
      return permission.canEdit;
    case 'delete':
      return permission.canDelete;
    case 'share':
      return permission.canShare;
    case 'transcribe':
      return permission.canTranscribe;
    default:
      return false;
  }
};

recordingSchema.methods.incrementView = function(userId = null) {
  this.analytics.totalViews += 1;
  
  if (userId) {
    // Track unique views if needed
    this.analytics.lastViewedAt = new Date();
  }
  
  return this;
};

recordingSchema.methods.incrementDownload = function() {
  this.analytics.totalDownloads += 1;
  this.sharing.downloadCount += 1;
  this.analytics.lastDownloadedAt = new Date();
  
  return this;
};

recordingSchema.methods.incrementShare = function() {
  this.analytics.shareCount += 1;
  this.sharing.shareCount += 1;
  
  return this;
};

recordingSchema.methods.updateProcessingStatus = function(status, progress = 0, error = null) {
  this.processing.status = status;
  this.processing.progress = progress;
  
  if (status === 'processing' && !this.processing.startedAt) {
    this.processing.startedAt = new Date();
  } else if (status === 'completed') {
    this.processing.completedAt = new Date();
    this.processing.progress = 100;
  } else if (status === 'failed') {
    this.processing.error = error;
    this.processing.retryCount += 1;
  }
  
  return this;
};

recordingSchema.methods.generateShareLink = function(expiresIn = 24 * 60 * 60 * 1000) { // 24 hours
  const shareId = require('crypto').randomBytes(16).toString('hex');
  this.sharing.shareLink = `/share/${shareId}`;
  this.sharing.shareLinkExpires = new Date(Date.now() + expiresIn);
  
  return this.sharing.shareLink;
};

recordingSchema.methods.softDelete = function(deletedBy) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  
  return this;
};

recordingSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  
  return this;
};

recordingSchema.methods.updateTranscription = function(transcriptionData) {
  this.transcription = {
    ...this.transcription,
    ...transcriptionData,
    isProcessed: true,
    processedAt: new Date()
  };
  
  return this;
};

// Static methods
recordingSchema.statics.findByUser = function(userId, options = {}) {
  const { type, status, page = 1, limit = 20 } = options;
  
  let query = {
    $or: [
      { userId },
      { 'permissions.userId': userId }
    ],
    isActive: true,
    isDeleted: false
  };
  
  if (type) query.type = type;
  if (status) query['processing.status'] = status;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture')
    .populate('callId', 'type duration');
};

recordingSchema.statics.findPublicRecordings = function(options = {}) {
  const { type, category, page = 1, limit = 20 } = options;
  
  let query = {
    'privacy.isPublic': true,
    'processing.status': 'completed',
    isActive: true,
    isDeleted: false
  };
  
  if (type) query.type = type;
  if (category) query.category = category;
  
  return this.find(query)
    .sort({ 'analytics.totalViews': -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('userId', 'username displayName profilePicture');
};

recordingSchema.statics.getRecordingStats = function(userId, period = '30d') {
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
        totalRecordings: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        averageDuration: { $avg: '$duration' },
        totalSize: { $sum: '$file.size' },
        averageSize: { $avg: '$file.size' },
        totalViews: { $sum: '$analytics.totalViews' },
        totalDownloads: { $sum: '$analytics.totalDownloads' }
      }
    }
  ]);
};

// Pre-save middleware
recordingSchema.pre('save', function(next) {
  // Set owner permission if not exists
  if (this.permissions.length === 0) {
    this.permissions.push({
      userId: this.userId,
      type: 'owner',
      canView: true,
      canDownload: true,
      canEdit: true,
      canDelete: true,
      canShare: true,
      canTranscribe: true
    });
  }
  
  // Generate recording ID if not exists
  if (!this.recordingId) {
    this.recordingId = require('crypto').randomBytes(16).toString('hex');
  }
  
  // Set file extension
  if (this.file.filename && !this.file.extension) {
    this.file.extension = this.file.filename.split('.').pop();
  }
  
  next();
});

// Pre-find middleware
recordingSchema.pre('find', function() {
  this.where({ isDeleted: false });
});

recordingSchema.pre('findOne', function() {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model('Recording', recordingSchema);