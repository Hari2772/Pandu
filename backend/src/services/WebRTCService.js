const Call = require('../models/Call');
const Recording = require('../models/Recording');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

class WebRTCService {
  constructor(io) {
    this.io = io;
    this.activeConnections = new Map(); // callId -> connection data
    this.screenShareSessions = new Map(); // sessionId -> session data
    this.recordingSessions = new Map(); // callId -> recording data
  }

  // Handle WebRTC offer
  async handleOffer(socket, data) {
    try {
      const { callId, offer, targetUserId } = data;
      const senderId = socket.userId;

      if (!callId || !offer || !targetUserId) {
        socket.emit('error', { message: 'Invalid offer data' });
        return;
      }

      // Validate call
      const call = await Call.findById(callId);
      if (!call || (call.callerId.toString() !== senderId && call.receiverId.toString() !== senderId)) {
        socket.emit('error', { message: 'Invalid call' });
        return;
      }

      // Store connection data
      if (!this.activeConnections.has(callId)) {
        this.activeConnections.set(callId, {
          callId,
          callerId: call.callerId,
          receiverId: call.receiverId,
          callType: call.callType,
          startTime: new Date(),
          participants: [call.callerId, call.receiverId]
        });
      }

      // Forward offer to target user
      const targetSocketId = this.getUserSocketId(targetUserId);
      if (targetSocketId) {
        this.io.to(targetSocketId).emit('webrtc_offer', {
          callId,
          offer,
          fromUserId: senderId
        });
      }

      logger.info(`WebRTC offer sent for call ${callId}`);

    } catch (error) {
      logger.error('Handle offer error:', error);
      socket.emit('error', { message: 'Failed to process offer' });
    }
  }

  // Handle WebRTC answer
  async handleAnswer(socket, data) {
    try {
      const { callId, answer, targetUserId } = data;
      const senderId = socket.userId;

      if (!callId || !answer || !targetUserId) {
        socket.emit('error', { message: 'Invalid answer data' });
        return;
      }

      // Forward answer to target user
      const targetSocketId = this.getUserSocketId(targetUserId);
      if (targetSocketId) {
        this.io.to(targetSocketId).emit('webrtc_answer', {
          callId,
          answer,
          fromUserId: senderId
        });
      }

      logger.info(`WebRTC answer sent for call ${callId}`);

    } catch (error) {
      logger.error('Handle answer error:', error);
      socket.emit('error', { message: 'Failed to process answer' });
    }
  }

  // Handle ICE candidate
  async handleICECandidate(socket, data) {
    try {
      const { callId, candidate, targetUserId } = data;
      const senderId = socket.userId;

      if (!callId || !candidate || !targetUserId) return;

      // Forward ICE candidate to target user
      const targetSocketId = this.getUserSocketId(targetUserId);
      if (targetSocketId) {
        this.io.to(targetSocketId).emit('webrtc_ice_candidate', {
          callId,
          candidate,
          fromUserId: senderId
        });
      }

    } catch (error) {
      logger.error('Handle ICE candidate error:', error);
    }
  }

  // Handle screen share start
  async handleScreenShareStart(socket, data) {
    try {
      const { callId, streamId, sessionId } = data;
      const senderId = socket.userId;

      if (!callId || !streamId || !sessionId) {
        socket.emit('error', { message: 'Invalid screen share data' });
        return;
      }

      // Validate call
      const call = await Call.findById(callId);
      if (!call || (call.callerId.toString() !== senderId && call.receiverId.toString() !== senderId)) {
        socket.emit('error', { message: 'Invalid call' });
        return;
      }

      // Create screen share session
      const sessionData = {
        sessionId,
        callId,
        senderId,
        streamId,
        startTime: new Date(),
        isActive: true
      };

      this.screenShareSessions.set(sessionId, sessionData);

      // Notify other participant
      const otherUserId = call.callerId.toString() === senderId ? call.receiverId : call.callerId;
      const otherSocketId = this.getUserSocketId(otherUserId);
      
      if (otherSocketId) {
        this.io.to(otherSocketId).emit('screen_share_started', {
          callId,
          sessionId,
          streamId,
          fromUserId: senderId
        });
      }

      // Update call with screen share info
      await Call.findByIdAndUpdate(callId, {
        hasScreenShare: true,
        screenShareSessionId: sessionId
      });

      logger.info(`Screen share started for call ${callId} by user ${senderId}`);

    } catch (error) {
      logger.error('Screen share start error:', error);
      socket.emit('error', { message: 'Failed to start screen share' });
    }
  }

  // Handle screen share stop
  async handleScreenShareStop(socket, data) {
    try {
      const { callId, sessionId } = data;
      const senderId = socket.userId;

      if (!callId || !sessionId) return;

      const sessionData = this.screenShareSessions.get(sessionId);
      if (!sessionData || sessionData.senderId.toString() !== senderId) {
        socket.emit('error', { message: 'Invalid session' });
        return;
      }

      // End session
      sessionData.isActive = false;
      sessionData.endTime = new Date();
      this.screenShareSessions.set(sessionId, sessionData);

      // Notify other participant
      const call = await Call.findById(callId);
      if (call) {
        const otherUserId = call.callerId.toString() === senderId ? call.receiverId : call.callerId;
        const otherSocketId = this.getUserSocketId(otherUserId);
        
        if (otherSocketId) {
          this.io.to(otherSocketId).emit('screen_share_stopped', {
            callId,
            sessionId,
            fromUserId: senderId
          });
        }

        // Update call
        await Call.findByIdAndUpdate(callId, {
          hasScreenShare: false,
          screenShareSessionId: null
        });
      }

      logger.info(`Screen share stopped for call ${callId} by user ${senderId}`);

    } catch (error) {
      logger.error('Screen share stop error:', error);
      socket.emit('error', { message: 'Failed to stop screen share' });
    }
  }

  // Handle recording start
  async handleRecordingStart(socket, data) {
    try {
      const { callId, recordingType = 'audio' } = data;
      const senderId = socket.userId;

      if (!callId) {
        socket.emit('error', { message: 'Call ID required' });
        return;
      }

      // Validate call
      const call = await Call.findById(callId);
      if (!call || (call.callerId.toString() !== senderId && call.receiverId.toString() !== senderId)) {
        socket.emit('error', { message: 'Invalid call' });
        return;
      }

      // Check if recording already exists
      if (this.recordingSessions.has(callId)) {
        socket.emit('error', { message: 'Recording already in progress' });
        return;
      }

      // Create recording session
      const recordingData = {
        callId,
        startedBy: senderId,
        recordingType,
        startTime: new Date(),
        isActive: true,
        filePath: null
      };

      this.recordingSessions.set(callId, recordingData);

      // Create recording record
      const recording = new Recording({
        callId,
        startedBy: senderId,
        recordingType,
        status: 'recording',
        startTime: new Date()
      });

      await recording.save();

      // Notify other participant
      const otherUserId = call.callerId.toString() === senderId ? call.receiverId : call.callerId;
      const otherSocketId = this.getUserSocketId(otherUserId);
      
      if (otherSocketId) {
        this.io.to(otherSocketId).emit('recording_started', {
          callId,
          recordingId: recording._id,
          recordingType,
          startedBy: senderId
        });
      }

      // Update call
      await Call.findByIdAndUpdate(callId, {
        isRecording: true,
        recordingId: recording._id
      });

      logger.info(`Recording started for call ${callId} by user ${senderId}`);

    } catch (error) {
      logger.error('Recording start error:', error);
      socket.emit('error', { message: 'Failed to start recording' });
    }
  }

  // Handle recording stop
  async handleRecordingStop(socket, data) {
    try {
      const { callId } = data;
      const senderId = socket.userId;

      if (!callId) return;

      const recordingData = this.recordingSessions.get(callId);
      if (!recordingData) {
        socket.emit('error', { message: 'No active recording' });
        return;
      }

      // Check if user can stop recording
      if (recordingData.startedBy.toString() !== senderId) {
        socket.emit('error', { message: 'Only recording initiator can stop recording' });
        return;
      }

      // End recording session
      recordingData.isActive = false;
      recordingData.endTime = new Date();
      this.recordingSessions.set(callId, recordingData);

      // Update recording record
      await Recording.findByIdAndUpdate(recordingData.recordingId, {
        status: 'completed',
        endTime: new Date(),
        duration: new Date() - recordingData.startTime
      });

      // Notify other participant
      const call = await Call.findById(callId);
      if (call) {
        const otherUserId = call.callerId.toString() === senderId ? call.receiverId : call.callerId;
        const otherSocketId = this.getUserSocketId(otherUserId);
        
        if (otherSocketId) {
          this.io.to(otherSocketId).emit('recording_stopped', {
            callId,
            recordingId: recordingData.recordingId,
            stoppedBy: senderId
          });
        }

        // Update call
        await Call.findByIdAndUpdate(callId, {
          isRecording: false,
          recordingId: null
        });
      }

      logger.info(`Recording stopped for call ${callId} by user ${senderId}`);

    } catch (error) {
      logger.error('Recording stop error:', error);
      socket.emit('error', { message: 'Failed to stop recording' });
    }
  }

  // Handle connection state change
  async handleConnectionStateChange(socket, data) {
    try {
      const { callId, state, connectionId } = data;
      const userId = socket.userId;

      if (!callId || !state) return;

      // Update connection state in Redis for monitoring
      await redisManager.getClient().hset(
        `call:${callId}:connections`,
        connectionId || userId,
        JSON.stringify({
          state,
          userId,
          timestamp: new Date()
        })
      );

      // Notify other participant
      const call = await Call.findById(callId);
      if (call) {
        const otherUserId = call.callerId.toString() === userId ? call.receiverId : call.callerId;
        const otherSocketId = this.getUserSocketId(otherUserId);
        
        if (otherSocketId) {
          this.io.to(otherSocketId).emit('connection_state_change', {
            callId,
            state,
            userId
          });
        }
      }

      logger.info(`Connection state changed to ${state} for call ${callId} by user ${userId}`);

    } catch (error) {
      logger.error('Connection state change error:', error);
    }
  }

  // Handle bandwidth estimation
  async handleBandwidthEstimation(socket, data) {
    try {
      const { callId, bandwidth, connectionQuality } = data;
      const userId = socket.userId;

      if (!callId || !bandwidth) return;

      // Store bandwidth data in Redis for analytics
      await redisManager.getClient().hset(
        `call:${callId}:metrics`,
        'bandwidth',
        JSON.stringify({
          userId,
          bandwidth,
          connectionQuality,
          timestamp: new Date()
        })
      );

      // Update call with quality metrics
      await Call.findByIdAndUpdate(callId, {
        $push: {
          qualityMetrics: {
            userId,
            bandwidth,
            connectionQuality,
            timestamp: new Date()
          }
        }
      });

    } catch (error) {
      logger.error('Bandwidth estimation error:', error);
    }
  }

  // Get active connections
  getActiveConnections() {
    return Array.from(this.activeConnections.values());
  }

  // Get screen share sessions
  getScreenShareSessions() {
    return Array.from(this.screenShareSessions.values()).filter(s => s.isActive);
  }

  // Get recording sessions
  getRecordingSessions() {
    return Array.from(this.recordingSessions.values()).filter(r => r.isActive);
  }

  // End call and cleanup
  async endCall(callId) {
    try {
      // Cleanup active connections
      this.activeConnections.delete(callId);

      // Stop screen sharing
      const screenShareSessions = Array.from(this.screenShareSessions.values())
        .filter(s => s.callId === callId);
      
      screenShareSessions.forEach(session => {
        session.isActive = false;
        session.endTime = new Date();
      });

      // Stop recordings
      const recordingData = this.recordingSessions.get(callId);
      if (recordingData && recordingData.isActive) {
        recordingData.isActive = false;
        recordingData.endTime = new Date();

        // Update recording record
        await Recording.findByIdAndUpdate(recordingData.recordingId, {
          status: 'interrupted',
          endTime: new Date(),
          duration: new Date() - recordingData.startTime
        });
      }

      // Cleanup Redis data
      await redisManager.getClient().del(`call:${callId}:connections`);
      await redisManager.getClient().del(`call:${callId}:metrics`);

      logger.info(`Call ${callId} ended and cleaned up`);

    } catch (error) {
      logger.error('End call cleanup error:', error);
    }
  }

  // Helper method to get user socket ID
  getUserSocketId(userId) {
    // This would be implemented based on your socket management
    // For now, returning null as placeholder
    return null;
  }
}

module.exports = WebRTCService;