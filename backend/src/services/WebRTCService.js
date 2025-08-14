const Call = require('../models/Call');
const Recording = require('../models/Recording');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class WebRTCService {
  constructor() {
    this.activeConnections = new Map(); // callId -> connection data
    this.screenShareSessions = new Map(); // sessionId -> session data
    this.recordingSessions = new Map(); // sessionId -> recording data
  }

  // Initialize WebRTC connection
  async initializeConnection(callId, callerId, receiverId, callType) {
    try {
      const connectionData = {
        callId,
        callerId,
        receiverId,
        callType,
        startTime: new Date(),
        isActive: false,
        participants: [callerId, receiverId],
        mediaStreams: {
          audio: false,
          video: false,
          screen: false
        },
        recording: {
          isRecording: false,
          sessionId: null,
          startTime: null
        },
        screenShare: {
          isActive: false,
          sessionId: null,
          sharerId: null
        }
      };

      this.activeConnections.set(callId, connectionData);

      // Store connection data in Redis for persistence
      await redisManager.getClient().setex(
        `webrtc:connection:${callId}`,
        3600, // 1 hour
        JSON.stringify(connectionData)
      );

      logger.info(`WebRTC connection initialized for call ${callId}`);
      return connectionData;

    } catch (error) {
      logger.error('Initialize WebRTC connection error:', error);
      throw error;
    }
  }

  // Handle ICE candidate exchange
  async handleICECandidate(callId, fromUserId, candidate) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      // Store ICE candidate in Redis for the other participant
      const otherParticipant = connection.participants.find(id => id !== fromUserId);
      if (otherParticipant) {
        await redisManager.getClient().lpush(
          `webrtc:ice:${callId}:${otherParticipant}`,
          JSON.stringify({
            fromUserId,
            candidate,
            timestamp: new Date()
          })
        );

        // Set TTL for ICE candidates (5 minutes)
        await redisManager.getClient().expire(
          `webrtc:ice:${callId}:${otherParticipant}`,
          300
        );
      }

      logger.debug(`ICE candidate stored for call ${callId} from user ${fromUserId}`);

    } catch (error) {
      logger.error('Handle ICE candidate error:', error);
      throw error;
    }
  }

  // Handle offer/answer exchange
  async handleOfferAnswer(callId, fromUserId, type, sdp) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      // Store SDP in Redis for the other participant
      const otherParticipant = connection.participants.find(id => id !== fromUserId);
      if (otherParticipant) {
        await redisManager.getClient().setex(
          `webrtc:sdp:${callId}:${otherParticipant}`,
          300, // 5 minutes
          JSON.stringify({
            fromUserId,
            type,
            sdp,
            timestamp: new Date()
          })
        );
      }

      logger.debug(`${type} stored for call ${callId} from user ${fromUserId}`);

    } catch (error) {
      logger.error('Handle offer/answer error:', error);
      throw error;
    }
  }

  // Start screen sharing
  async startScreenShare(callId, sharerId, streamId) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      // Check if screen sharing is already active
      if (connection.screenShare.isActive) {
        throw new Error('Screen sharing already active');
      }

      const sessionId = `screenshare:${callId}:${Date.now()}`;
      
      // Update connection data
      connection.screenShare = {
        isActive: true,
        sessionId,
        sharerId,
        streamId,
        startTime: new Date()
      };

      connection.mediaStreams.screen = true;

      // Store screen share session
      this.screenShareSessions.set(sessionId, {
        callId,
        sharerId,
        streamId,
        startTime: new Date(),
        isActive: true
      });

      // Update Redis
      await redisManager.getClient().setex(
        `webrtc:connection:${callId}`,
        3600,
        JSON.stringify(connection)
      );

      await redisManager.getClient().setex(
        `webrtc:screenshare:${sessionId}`,
        3600,
        JSON.stringify(this.screenShareSessions.get(sessionId))
      );

      // Notify other participants
      const otherParticipants = connection.participants.filter(id => id !== sharerId);
      for (const participantId of otherParticipants) {
        await redisManager.getClient().lpush(
          `webrtc:events:${callId}:${participantId}`,
          JSON.stringify({
            type: 'screen_share_started',
            sessionId,
            sharerId,
            timestamp: new Date()
          })
        );
      }

      logger.info(`Screen sharing started for call ${callId} by user ${sharerId}`);
      return sessionId;

    } catch (error) {
      logger.error('Start screen share error:', error);
      throw error;
    }
  }

  // Stop screen sharing
  async stopScreenShare(callId, sharerId) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      if (!connection.screenShare.isActive || connection.screenShare.sharerId !== sharerId) {
        throw new Error('Screen sharing not active or unauthorized');
      }

      const sessionId = connection.screenShare.sessionId;

      // Update connection data
      connection.screenShare = {
        isActive: false,
        sessionId: null,
        sharerId: null
      };

      connection.mediaStreams.screen = false;

      // Remove screen share session
      this.screenShareSessions.delete(sessionId);

      // Update Redis
      await redisManager.getClient().setex(
        `webrtc:connection:${callId}`,
        3600,
        JSON.stringify(connection)
      );

      await redisManager.getClient().del(`webrtc:screenshare:${sessionId}`);

      // Notify other participants
      const otherParticipants = connection.participants.filter(id => id !== sharerId);
      for (const participantId of otherParticipants) {
        await redisManager.getClient().lpush(
          `webrtc:events:${callId}:${participantId}`,
          JSON.stringify({
            type: 'screen_share_stopped',
            sessionId,
            sharerId,
            timestamp: new Date()
          })
        );
      }

      logger.info(`Screen sharing stopped for call ${callId} by user ${sharerId}`);

    } catch (error) {
      logger.error('Stop screen share error:', error);
      throw error;
    }
  }

  // Start call recording
  async startRecording(callId, initiatorId) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      // Check if recording is already active
      if (connection.recording.isRecording) {
        throw new Error('Recording already active');
      }

      const sessionId = `recording:${callId}:${Date.now()}`;
      
      // Create recording record
      const recording = new Recording({
        callId,
        initiatorId,
        sessionId,
        status: 'recording',
        startTime: new Date(),
        callType: connection.callType
      });

      await recording.save();

      // Update connection data
      connection.recording = {
        isRecording: true,
        sessionId,
        startTime: new Date()
      };

      // Store recording session
      this.recordingSessions.set(sessionId, {
        callId,
        initiatorId,
        recordingId: recording._id,
        startTime: new Date(),
        isActive: true
      });

      // Update Redis
      await redisManager.getClient().setex(
        `webrtc:connection:${callId}`,
        3600,
        JSON.stringify(connection)
      );

      await redisManager.getClient().setex(
        `webrtc:recording:${sessionId}`,
        3600,
        JSON.stringify(this.recordingSessions.get(sessionId))
      );

      // Notify participants
      for (const participantId of connection.participants) {
        await redisManager.getClient().lpush(
          `webrtc:events:${callId}:${participantId}`,
          JSON.stringify({
            type: 'recording_started',
            sessionId,
            initiatorId,
            timestamp: new Date()
          })
        );
      }

      logger.info(`Recording started for call ${callId} by user ${initiatorId}`);
      return sessionId;

    } catch (error) {
      logger.error('Start recording error:', error);
      throw error;
    }
  }

  // Stop call recording
  async stopRecording(callId, initiatorId) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      if (!connection.recording.isRecording) {
        throw new Error('Recording not active');
      }

      const sessionId = connection.recording.sessionId;
      const recordingSession = this.recordingSessions.get(sessionId);

      if (!recordingSession) {
        throw new Error('Recording session not found');
      }

      // Update recording record
      await Recording.findByIdAndUpdate(recordingSession.recordingId, {
        status: 'completed',
        endTime: new Date(),
        duration: Date.now() - recordingSession.startTime.getTime()
      });

      // Update connection data
      connection.recording = {
        isRecording: false,
        sessionId: null,
        startTime: null
      };

      // Remove recording session
      this.recordingSessions.delete(sessionId);

      // Update Redis
      await redisManager.getClient().setex(
        `webrtc:connection:${callId}`,
        3600,
        JSON.stringify(connection)
      );

      await redisManager.getClient().del(`webrtc:recording:${sessionId}`);

      // Notify participants
      for (const participantId of connection.participants) {
        await redisManager.getClient().lpush(
          `webrtc:events:${callId}:${participantId}`,
          JSON.stringify({
            type: 'recording_stopped',
            sessionId,
            initiatorId,
            timestamp: new Date()
          })
        );
      }

      logger.info(`Recording stopped for call ${callId} by user ${initiatorId}`);

    } catch (error) {
      logger.error('Stop recording error:', error);
      throw error;
    }
  }

  // Handle media stream state change
  async handleMediaStreamChange(callId, userId, mediaType, isEnabled) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      // Update media stream state
      if (mediaType === 'audio' || mediaType === 'video') {
        connection.mediaStreams[mediaType] = isEnabled;
      }

      // Update Redis
      await redisManager.getClient().setex(
        `webrtc:connection:${callId}`,
        3600,
        JSON.stringify(connection)
      );

      // Notify other participants
      const otherParticipants = connection.participants.filter(id => id !== userId);
      for (const participantId of otherParticipants) {
        await redisManager.getClient().lpush(
          `webrtc:events:${callId}:${participantId}`,
          JSON.stringify({
            type: 'media_stream_changed',
            userId,
            mediaType,
            isEnabled,
            timestamp: new Date()
          })
        );
      }

      logger.debug(`Media stream ${mediaType} ${isEnabled ? 'enabled' : 'disabled'} for user ${userId} in call ${callId}`);

    } catch (error) {
      logger.error('Handle media stream change error:', error);
      throw error;
    }
  }

  // Get connection data
  async getConnectionData(callId) {
    try {
      // Try to get from memory first
      let connection = this.activeConnections.get(callId);
      
      if (!connection) {
        // Try to get from Redis
        const redisData = await redisManager.getClient().get(`webrtc:connection:${callId}`);
        if (redisData) {
          connection = JSON.parse(redisData);
          // Restore in memory
          this.activeConnections.set(callId, connection);
        }
      }

      return connection;

    } catch (error) {
      logger.error('Get connection data error:', error);
      return null;
    }
  }

  // Get pending events for user
  async getPendingEvents(callId, userId) {
    try {
      const events = await redisManager.getClient().lrange(
        `webrtc:events:${callId}:${userId}`,
        0,
        -1
      );

      // Clear events after reading
      await redisManager.getClient().del(`webrtc:events:${callId}:${userId}`);

      return events.map(event => JSON.parse(event));

    } catch (error) {
      logger.error('Get pending events error:', error);
      return [];
    }
  }

  // Get pending ICE candidates for user
  async getPendingICECandidates(callId, userId) {
    try {
      const candidates = await redisManager.getClient().lrange(
        `webrtc:ice:${callId}:${userId}`,
        0,
        -1
      );

      // Clear candidates after reading
      await redisManager.getClient().del(`webrtc:ice:${callId}:${userId}`);

      return candidates.map(candidate => JSON.parse(candidate));

    } catch (error) {
      logger.error('Get pending ICE candidates error:', error);
      return [];
    }
  }

  // Get pending SDP for user
  async getPendingSDP(callId, userId) {
    try {
      const sdpData = await redisManager.getClient().get(`webrtc:sdp:${callId}:${userId}`);
      
      if (sdpData) {
        // Clear SDP after reading
        await redisManager.getClient().del(`webrtc:sdp:${callId}:${userId}`);
        return JSON.parse(sdpData);
      }

      return null;

    } catch (error) {
      logger.error('Get pending SDP error:', error);
      return null;
    }
  }

  // End connection
  async endConnection(callId) {
    try {
      const connection = this.activeConnections.get(callId);
      if (!connection) return;

      // Stop any active recording
      if (connection.recording.isRecording) {
        await this.stopRecording(callId, connection.recording.initiatorId);
      }

      // Stop any active screen sharing
      if (connection.screenShare.isActive) {
        await this.stopScreenShare(callId, connection.screenShare.sharerId);
      }

      // Remove from memory
      this.activeConnections.delete(callId);

      // Remove from Redis
      await redisManager.getClient().del(`webrtc:connection:${callId}`);

      // Clear all related Redis keys
      const keys = await redisManager.getClient().keys(`webrtc:*:${callId}:*`);
      if (keys.length > 0) {
        await redisManager.getClient().del(...keys);
      }

      logger.info(`WebRTC connection ended for call ${callId}`);

    } catch (error) {
      logger.error('End connection error:', error);
    }
  }

  // Get active connections count
  getActiveConnectionsCount() {
    return this.activeConnections.size;
  }

  // Get active screen share sessions count
  getActiveScreenShareSessionsCount() {
    return this.screenShareSessions.size;
  }

  // Get active recording sessions count
  getActiveRecordingSessionsCount() {
    return this.recordingSessions.size;
  }

  // Clean up expired sessions
  async cleanupExpiredSessions() {
    try {
      const now = new Date();
      const expiryTime = 24 * 60 * 60 * 1000; // 24 hours

      // Clean up expired screen share sessions
      for (const [sessionId, session] of this.screenShareSessions.entries()) {
        if (now - session.startTime > expiryTime) {
          this.screenShareSessions.delete(sessionId);
          await redisManager.getClient().del(`webrtc:screenshare:${sessionId}`);
        }
      }

      // Clean up expired recording sessions
      for (const [sessionId, session] of this.recordingSessions.entries()) {
        if (now - session.startTime > expiryTime) {
          this.recordingSessions.delete(sessionId);
          await redisManager.getClient().del(`webrtc:recording:${sessionId}`);
        }
      }

      logger.info('Expired WebRTC sessions cleaned up');

    } catch (error) {
      logger.error('Cleanup expired sessions error:', error);
    }
  }
}

module.exports = WebRTCService;