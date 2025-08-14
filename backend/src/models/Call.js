const mongoose = require('mongoose');
const constants = require('../utils/constants');

const callSchema = new mongoose.Schema({
  // Basic Information
  callId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: Object.values(constants.CALL_TYPES),
    required: true
  },
  status: {
    type: String,
    enum: ['initiating', 'ringing', 'answered', 'in-progress', 'ended', 'missed', 'rejected', 'busy', 'failed'],
    default: 'initiating'
  },

  // Participants
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  participants: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['caller', 'callee'],
      required: true
    },
    status: {
      type: String,
      enum: ['invited', 'ringing', 'answered', 'declined', 'busy', 'unavailable'],
      default: 'invited'
    },
    joinedAt: Date,
    leftAt: Date,
    deviceId: String,
    platform: String,
    appVersion: String,
    isRecording: {
      type: Boolean,
      default: false
    },
    recordingStartedAt: Date,
    recordingStoppedAt: Date
  }],

  // Call Details
  startTime: Date,
  endTime: Date,
  duration: {
    type: Number,
    default: 0,
    min: 0
  },
  maxDuration: {
    type: Number,
    default: constants.MAX_CALL_DURATION,
    min: 60,
    max: constants.MAX_CALL_DURATION
  },

  // WebRTC Data
  webrtc: {
    iceServers: [{
      urls: String,
      username: String,
      credential: String
    }],
    localDescription: {
      type: String,
      sdp: String
    },
    remoteDescription: {
      type: String,
      sdp: String
    },
    iceCandidates: [{
      candidate: String,
      sdpMLineIndex: Number,
      sdpMid: String
    }],
    connectionState: {
      type: String,
      enum: ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'],
      default: 'new'
    },
    iceConnectionState: {
      type: String,
      enum: ['new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed'],
      default: 'new'
    },
    dtlsTransportState: {
      type: String,
      enum: ['new', 'connecting', 'connected', 'closed', 'failed'],
      default: 'new'
    }
  },

  // Media Streams
  mediaStreams: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    type: {
      type: String,
      enum: ['audio', 'video', 'screen'],
      required: true
    },
    trackId: String,
    enabled: {
      type: Boolean,
      default: true
    },
    muted: {
      type: Boolean,
      default: false
    },
    paused: {
      type: Boolean,
      default: false
    },
    quality: {
      width: Number,
      height: Number,
      frameRate: Number,
      bitrate: Number
    },
    stats: {
      packetsLost: Number,
      packetsReceived: Number,
      bytesReceived: Number,
      jitter: Number,
      roundTripTime: Number
    }
  }],

  // Screen Sharing
  screenShare: {
    isActive: {
      type: Boolean,
      default: false
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    startedAt: Date,
    stoppedAt: Date,
    duration: Number,
    quality: {
      width: Number,
      height: Number,
      frameRate: Number
    }
  },

  // Call Quality Metrics
  qualityMetrics: {
    overall: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor'],
      default: 'good'
    },
    audio: {
      quality: String,
      latency: Number,
      jitter: Number,
      packetLoss: Number,
      bitrate: Number
    },
    video: {
      quality: String,
      latency: Number,
      jitter: Number,
      packetLoss: Number,
      bitrate: Number,
      frameRate: Number,
      resolution: String
    },
    network: {
      bandwidth: Number,
      connectionType: String,
      rtt: Number,
      congestion: String
    }
  },

  // Recording
  recording: {
    isEnabled: {
      type: Boolean,
      default: false
    },
    startedAt: Date,
    stoppedAt: Date,
    duration: Number,
    filePath: String,
    fileSize: Number,
    format: String,
    quality: String,
    isPublic: {
      type: Boolean,
      default: false
    },
    permissions: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      canView: { type: Boolean, default: false },
      canDownload: { type: Boolean, default: false },
      canShare: { type: Boolean, default: false }
    }]
  },

  // Call Events
  events: [{
    type: {
      type: String,
      enum: ['call_initiated', 'call_answered', 'call_ended', 'participant_joined', 'participant_left', 'media_muted', 'media_unmuted', 'screen_share_started', 'screen_share_stopped', 'recording_started', 'recording_stopped', 'quality_changed', 'connection_lost', 'connection_restored'],
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    metadata: mongoose.Schema.Types.Mixed
  }],

  // Error Handling
  errors: [{
    code: String,
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    }
  }],

  // Analytics
  analytics: {
    totalParticipants: { type: Number, default: 0 },
    averageQuality: { type: Number, default: 0 },
    totalErrors: { type: Number, default: 0 },
    networkSwitches: { type: Number, default: 0 },
    reconnections: { type: Number, default: 0 }
  },

  // Metadata
  clientCallId: String, // For client-side deduplication
  appVersion: String,
  platform: String,
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
callSchema.index({ callId: 1 }, { unique: true });
callSchema.index({ initiator: 1 });
callSchema.index({ 'participants.userId': 1 });
callSchema.index({ status: 1 });
callSchema.index({ startTime: -1 });
callSchema.index({ endTime: -1 });
callSchema.index({ type: 1 });
callSchema.index({ 'recording.isEnabled': 1 });
callSchema.index({ 'screenShare.isActive': 1 });
callSchema.index({ 'qualityMetrics.overall': 1 });

// Virtuals
callSchema.virtual('isActive').get(function() {
  return ['initiating', 'ringing', 'answered', 'in-progress'].includes(this.status);
});

callSchema.virtual('isEnded').get(function() {
  return ['ended', 'missed', 'rejected', 'busy', 'failed'].includes(this.status);
});

callSchema.virtual('participantCount').get(function() {
  return this.participants.length;
});

callSchema.virtual('activeParticipants').get(function() {
  return this.participants.filter(p => 
    ['answered', 'in-progress'].includes(p.status)
  );
});

callSchema.virtual('callQuality').get(function() {
  return this.qualityMetrics.overall;
});

// Methods
callSchema.methods.addParticipant = function(userId, role = 'callee') {
  const existingParticipant = this.participants.find(p => 
    p.userId.equals(userId)
  );
  
  if (!existingParticipant) {
    this.participants.push({
      userId,
      role,
      status: 'invited'
    });
    this.analytics.totalParticipants = this.participants.length;
  }
  
  return this;
};

callSchema.methods.updateParticipantStatus = function(userId, status) {
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.status = status;
    
    if (status === 'answered') {
      participant.joinedAt = new Date();
    } else if (['declined', 'busy', 'unavailable'].includes(status)) {
      participant.leftAt = new Date();
    }
  }
  
  return this;
};

callSchema.methods.startCall = function() {
  this.status = 'ringing';
  this.startTime = new Date();
  
  this.addEvent('call_initiated', this.initiator);
  
  return this;
};

callSchema.methods.answerCall = function(userId) {
  this.status = 'answered';
  this.updateParticipantStatus(userId, 'answered');
  
  this.addEvent('call_answered', userId);
  
  return this;
};

callSchema.methods.endCall = function(reason = 'ended') {
  this.status = reason;
  this.endTime = new Date();
  this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  
  this.addEvent('call_ended', null, { reason });
  
  return this;
};

callSchema.methods.startScreenShare = function(userId) {
  this.screenShare.isActive = true;
  this.screenShare.startedBy = userId;
  this.screenShare.startedAt = new Date();
  
  this.addEvent('screen_share_started', userId);
  
  return this;
};

callSchema.methods.stopScreenShare = function() {
  if (this.screenShare.isActive) {
    this.screenShare.isActive = false;
    this.screenShare.stoppedAt = new Date();
    this.screenShare.duration = Math.floor((this.screenShare.stoppedAt - this.screenShare.startedAt) / 1000);
    
    this.addEvent('screen_share_stopped', this.screenShare.startedBy);
  }
  
  return this;
};

callSchema.methods.startRecording = function(userId) {
  this.recording.isEnabled = true;
  this.recording.startedAt = new Date();
  
  const participant = this.participants.find(p => p.userId.equals(userId));
  if (participant) {
    participant.isRecording = true;
    participant.recordingStartedAt = new Date();
  }
  
  this.addEvent('recording_started', userId);
  
  return this;
};

callSchema.methods.stopRecording = function(userId) {
  if (this.recording.isEnabled) {
    this.recording.isEnabled = false;
    this.recording.stoppedAt = new Date();
    this.recording.duration = Math.floor((this.recording.stoppedAt - this.recording.startedAt) / 1000);
    
    const participant = this.participants.find(p => p.userId.equals(userId));
    if (participant) {
      participant.isRecording = false;
      participant.recordingStoppedAt = new Date();
    }
    
    this.addEvent('recording_stopped', userId);
  }
  
  return this;
};

callSchema.methods.updateQualityMetrics = function(metrics) {
  this.qualityMetrics = { ...this.qualityMetrics, ...metrics };
  
  // Calculate overall quality
  const audioScore = this.getQualityScore(this.qualityMetrics.audio.quality);
  const videoScore = this.getQualityScore(this.qualityMetrics.video.quality);
  const networkScore = this.getNetworkScore(this.qualityMetrics.network);
  
  const overallScore = (audioScore + videoScore + networkScore) / 3;
  
  if (overallScore >= 0.8) this.qualityMetrics.overall = 'excellent';
  else if (overallScore >= 0.6) this.qualityMetrics.overall = 'good';
  else if (overallScore >= 0.4) this.qualityMetrics.overall = 'fair';
  else this.qualityMetrics.overall = 'poor';
  
  this.analytics.averageQuality = overallScore;
  
  return this;
};

callSchema.methods.addEvent = function(type, userId, metadata = {}) {
  this.events.push({
    type,
    userId,
    timestamp: new Date(),
    metadata
  });
  
  return this;
};

callSchema.methods.addError = function(code, message, userId, severity = 'medium') {
  this.errors.push({
    code,
    message,
    timestamp: new Date(),
    userId,
    severity
  });
  
  this.analytics.totalErrors += 1;
  
  return this;
};

callSchema.methods.updateWebRTCState = function(connectionState, iceConnectionState, dtlsTransportState) {
  this.webrtc.connectionState = connectionState;
  this.webrtc.iceConnectionState = iceConnectionState;
  this.webrtc.dtlsTransportState = dtlsTransportState;
  
  return this;
};

// Helper methods
callSchema.methods.getQualityScore = function(quality) {
  const scores = { excellent: 1.0, good: 0.8, fair: 0.6, poor: 0.3 };
  return scores[quality] || 0.5;
};

callSchema.methods.getNetworkScore = function(network) {
  let score = 0.5;
  
  if (network.bandwidth > 1000000) score += 0.3; // 1Mbps+
  if (network.rtt < 100) score += 0.2; // Low latency
  if (network.connectionType === 'wifi' || network.connectionType === 'ethernet') score += 0.1;
  
  return Math.min(score, 1.0);
};

// Static methods
callSchema.statics.findByUser = function(userId, options = {}) {
  const { status, type, page = 1, limit = 20 } = options;
  
  let query = {
    $or: [
      { initiator: userId },
      { 'participants.userId': userId }
    ]
  };
  
  if (status) query.status = status;
  if (type) query.type = type;
  
  return this.find(query)
    .sort({ startTime: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('initiator', 'username displayName profilePicture')
    .populate('participants.userId', 'username displayName profilePicture');
};

callSchema.statics.findActiveCalls = function() {
  return this.find({
    status: { $in: ['initiating', 'ringing', 'answered', 'in-progress'] }
  }).populate('initiator', 'username displayName profilePicture');
};

callSchema.statics.getCallStats = function(userId, period = '30d') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  return this.aggregate([
    {
      $match: {
        $or: [
          { initiator: mongoose.Types.ObjectId(userId) },
          { 'participants.userId': mongoose.Types.ObjectId(userId) }
        ],
        startTime: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        averageDuration: { $avg: '$duration' },
        missedCalls: {
          $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] }
        },
        successfulCalls: {
          $sum: { $cond: [{ $eq: ['$status', 'ended'] }, 1, 0] }
        }
      }
    }
  ]);
};

// Pre-save middleware
callSchema.pre('save', function(next) {
  // Update duration if call ended
  if (this.endTime && this.startTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }
  
  // Update participant count
  this.analytics.totalParticipants = this.participants.length;
  
  next();
});

module.exports = mongoose.model('Call', callSchema);