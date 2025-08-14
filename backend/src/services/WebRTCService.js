const Call = require('../models/Call');
const Recording = require('../models/Recording');
const Analytics = require('../models/Analytics');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');

class WebRTCService {
  constructor() {
    this.activeConnections = new Map(); // callId -> connectionData
    this.iceServers = this.getIceServers();
  }

  getIceServers() {
    const defaultServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    // Add TURN servers if configured
    if (process.env.TURN_SERVERS) {
      try {
        const turnServers = JSON.parse(process.env.TURN_SERVERS);
        defaultServers.push(...turnServers);
      } catch (error) {
        logger.error('Failed to parse TURN servers:', error);
      }
    }

    return defaultServers;
  }

  async handleCallOffer(socket, data) {
    try {
      const { callId, offer, recipientId } = data;
      const senderId = socket.userId;

      // Validate call
      const call = await Call.findById(callId);
      if (!call || 
          (call.callerId.toString() !== senderId.toString() && 
           call.recipientId.toString() !== senderId.toString())) {
        return socket.emit('error', { message: 'Invalid call' });
      }

      // Store connection data
      if (!this.activeConnections.has(callId)) {
        this.activeConnections.set(callId, {
          callId,
          callerId: call.callerId,
          recipientId: call.recipientId,
          offer: null,
          answer: null,
          iceCandidates: new Map(),
          startTime: new Date(),
          status: 'connecting'
        });
      }

      const connection = this.activeConnections.get(callId);
      connection.offer = offer;
      connection.status = 'offer_received';

      // Forward offer to recipient
      const recipientSocketId = this.getUserSocketId(recipientId);
      if (recipientSocketId) {
        this.io.to(recipientSocketId).emit('call_offer_received', {
          callId,
          offer,
          callerId: senderId,
          iceServers: this.iceServers
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'call_offer_sent',
        eventName: 'Call Offer Sent',
        eventCategory: 'communication',
        userId: senderId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId,
          callType: call.callType
        }
      });

      logger.info(`Call offer sent for call ${callId}`);

    } catch (error) {
      logger.error('Handle call offer error:', error);
      socket.emit('error', { message: 'Failed to process call offer' });
    }
  }

  async handleCallAnswer(socket, data) {
    try {
      const { callId, answer, recipientId } = data;
      const senderId = socket.userId;

      // Validate call
      const call = await Call.findById(callId);
      if (!call || 
          (call.callerId.toString() !== senderId.toString() && 
           call.recipientId.toString() !== senderId.toString())) {
        return socket.emit('error', { message: 'Invalid call' });
      }

      const connection = this.activeConnections.get(callId);
      if (!connection) {
        return socket.emit('error', { message: 'Call connection not found' });
      }

      connection.answer = answer;
      connection.status = 'answer_received';

      // Forward answer to caller
      const callerId = connection.callerId.equals(senderId) ? connection.recipientId : connection.callerId;
      const callerSocketId = this.getUserSocketId(callerId);
      if (callerSocketId) {
        this.io.to(callerSocketId).emit('call_answer_received', {
          callId,
          answer,
          recipientId: senderId
        });
      }

      // Update call status
      call.status = 'active';
      call.answeredAt = new Date();
      await call.save();

      // Track analytics
      await Analytics.create({
        eventType: 'call_answer_sent',
        eventName: 'Call Answer Sent',
        eventCategory: 'communication',
        userId: senderId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId,
          callType: call.callType
        }
      });

      logger.info(`Call answer sent for call ${callId}`);

    } catch (error) {
      logger.error('Handle call answer error:', error);
      socket.emit('error', { message: 'Failed to process call answer' });
    }
  }

  async handleIceCandidate(socket, data) {
    try {
      const { callId, candidate, recipientId } = data;
      const senderId = socket.userId;

      // Validate call
      const call = await Call.findById(callId);
      if (!call || 
          (call.callerId.toString() !== senderId.toString() && 
           call.recipientId.toString() !== senderId.toString())) {
        return socket.emit('error', { message: 'Invalid call' });
      }

      const connection = this.activeConnections.get(callId);
      if (!connection) {
        return socket.emit('error', { message: 'Call connection not found' });
      }

      // Store ICE candidate
      if (!connection.iceCandidates.has(senderId)) {
        connection.iceCandidates.set(senderId, []);
      }
      connection.iceCandidates.get(senderId).push(candidate);

      // Forward ICE candidate to recipient
      const recipientSocketId = this.getUserSocketId(recipientId);
      if (recipientSocketId) {
        this.io.to(recipientSocketId).emit('ice_candidate_received', {
          callId,
          candidate,
          senderId
        });
      }

      logger.debug(`ICE candidate forwarded for call ${callId}`);

    } catch (error) {
      logger.error('Handle ICE candidate error:', error);
      socket.emit('error', { message: 'Failed to process ICE candidate' });
    }
  }

  async handleScreenShareOffer(socket, data) {
    try {
      const { recipientId, offer, isVideo = false } = data;
      const senderId = socket.userId;

      // Store screen sharing connection
      const connectionId = `screen_share_${senderId}_${recipientId}`;
      this.activeConnections.set(connectionId, {
        connectionId,
        type: 'screen_share',
        sharerId: senderId,
        recipientId,
        offer,
        answer: null,
        iceCandidates: new Map(),
        isVideo,
        startTime: new Date(),
        status: 'offer_received'
      });

      // Forward offer to recipient
      const recipientSocketId = this.getUserSocketId(recipientId);
      if (recipientSocketId) {
        this.io.to(recipientSocketId).emit('screen_share_offer_received', {
          connectionId,
          offer,
          sharerId: senderId,
          isVideo,
          iceServers: this.iceServers
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_offer_sent',
        eventName: 'Screen Share Offer Sent',
        eventCategory: 'media',
        userId: senderId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          recipientId,
          isVideo
        }
      });

      logger.info(`Screen share offer sent from ${senderId} to ${recipientId}`);

    } catch (error) {
      logger.error('Handle screen share offer error:', error);
      socket.emit('error', { message: 'Failed to process screen share offer' });
    }
  }

  async handleScreenShareAnswer(socket, data) {
    try {
      const { connectionId, answer, sharerId } = data;
      const senderId = socket.userId;

      const connection = this.activeConnections.get(connectionId);
      if (!connection || connection.recipientId.toString() !== senderId.toString()) {
        return socket.emit('error', { message: 'Invalid screen share connection' });
      }

      connection.answer = answer;
      connection.status = 'answer_received';

      // Forward answer to sharer
      const sharerSocketId = this.getUserSocketId(sharerId);
      if (sharerSocketId) {
        this.io.to(sharerSocketId).emit('screen_share_answer_received', {
          connectionId,
          answer,
          recipientId: senderId
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_answer_sent',
        eventName: 'Screen Share Answer Sent',
        eventCategory: 'media',
        userId: senderId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          connectionId,
          isVideo: connection.isVideo
        }
      });

      logger.info(`Screen share answer sent for connection ${connectionId}`);

    } catch (error) {
      logger.error('Handle screen share answer error:', error);
      socket.emit('error', { message: 'Failed to process screen share answer' });
    }
  }

  async handleScreenShareIceCandidate(socket, data) {
    try {
      const { connectionId, candidate, recipientId } = data;
      const senderId = socket.userId;

      const connection = this.activeConnections.get(connectionId);
      if (!connection || 
          (connection.sharerId.toString() !== senderId.toString() && 
           connection.recipientId.toString() !== senderId.toString())) {
        return socket.emit('error', { message: 'Invalid screen share connection' });
      }

      // Store ICE candidate
      if (!connection.iceCandidates.has(senderId)) {
        connection.iceCandidates.set(senderId, []);
      }
      connection.iceCandidates.get(senderId).push(candidate);

      // Forward ICE candidate to recipient
      const recipientSocketId = this.getUserSocketId(recipientId);
      if (recipientSocketId) {
        this.io.to(recipientSocketId).emit('screen_share_ice_candidate_received', {
          connectionId,
          candidate,
          senderId
        });
      }

      logger.debug(`Screen share ICE candidate forwarded for connection ${connectionId}`);

    } catch (error) {
      logger.error('Handle screen share ICE candidate error:', error);
      socket.emit('error', { message: 'Failed to process ICE candidate' });
    }
  }

  async handleRecordingStart(socket, data) {
    try {
      const { callId, recordingType = 'audio', quality = 'medium' } = data;
      const userId = socket.userId;

      // Validate call
      const call = await Call.findById(callId);
      if (!call || 
          (call.callerId.toString() !== userId.toString() && 
           call.recipientId.toString() !== userId.toString())) {
        return socket.emit('error', { message: 'Invalid call' });
      }

      // Check if call is active
      if (call.status !== 'active') {
        return socket.emit('error', { message: 'Call is not active' });
      }

      // Create recording record
      const recording = new Recording({
        callId,
        recorderId: userId,
        recordingType,
        quality,
        status: 'recording',
        startTime: new Date()
      });

      await recording.save();

      // Store recording session
      this.recordingSessions.set(userId, {
        recordingId: recording._id,
        callId,
        recordingType,
        quality,
        startTime: new Date(),
        status: 'recording'
      });

      // Notify other participant
      const otherParticipantId = call.callerId.equals(userId) ? call.recipientId : call.callerId;
      const otherParticipantSocketId = this.getUserSocketId(otherParticipantId);
      if (otherParticipantSocketId) {
        this.io.to(otherParticipantSocketId).emit('recording_started', {
          callId,
          recorderId: userId,
          recordingType,
          quality,
          timestamp: new Date()
        });
      }

      // Track analytics
      await Analytics.create({
        eventType: 'recording_started',
        eventName: 'Recording Started',
        eventCategory: 'media',
        userId: userId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId,
          recordingType,
          quality
        }
      });

      socket.emit('recording_started', {
        recordingId: recording._id,
        timestamp: new Date()
      });

      logger.info(`Recording started for call ${callId} by user ${userId}`);

    } catch (error) {
      logger.error('Handle recording start error:', error);
      socket.emit('error', { message: 'Failed to start recording' });
    }
  }

  async handleRecordingStop(socket, data) {
    try {
      const { recordingId } = data;
      const userId = socket.userId;

      const recording = await Recording.findById(recordingId);
      if (!recording || recording.recorderId.toString() !== userId.toString()) {
        return socket.emit('error', { message: 'Invalid recording' });
      }

      // Update recording
      recording.status = 'completed';
      recording.endTime = new Date();
      recording.duration = recording.endTime - recording.startTime;
      await recording.save();

      // Remove from active sessions
      this.recordingSessions.delete(userId);

      // Notify other participant
      const call = await Call.findById(recording.callId);
      if (call) {
        const otherParticipantId = call.callerId.equals(userId) ? call.recipientId : call.callerId;
        const otherParticipantSocketId = this.getUserSocketId(otherParticipantId);
        if (otherParticipantSocketId) {
          this.io.to(otherParticipantSocketId).emit('recording_stopped', {
            callId: recording.callId,
            recorderId: userId,
            recordingId: recording._id,
            duration: recording.duration,
            timestamp: new Date()
          });
        }
      }

      // Track analytics
      await Analytics.create({
        eventType: 'recording_stopped',
        eventName: 'Recording Stopped',
        eventCategory: 'media',
        userId: userId,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          recordingId: recording._id,
          callId: recording.callId,
          duration: recording.duration
        }
      });

      socket.emit('recording_stopped', {
        recordingId: recording._id,
        duration: recording.duration,
        timestamp: new Date()
      });

      logger.info(`Recording stopped for recording ${recordingId}`);

    } catch (error) {
      logger.error('Handle recording stop error:', error);
      socket.emit('error', { message: 'Failed to stop recording' });
    }
  }

  async endCall(callId, reason = 'ended') {
    try {
      const connection = this.activeConnections.get(callId);
      if (connection) {
        // Cleanup connection
        this.activeConnections.delete(callId);

        // Update call status
        const call = await Call.findById(callId);
        if (call) {
          call.status = 'ended';
          call.endedAt = new Date();
          call.endReason = reason;
          if (connection.startTime) {
            call.duration = new Date() - connection.startTime;
          }
          await call.save();
        }

        // Stop any active recordings
        for (const [userId, session] of this.recordingSessions.entries()) {
          if (session.callId.toString() === callId) {
            await this.stopRecording(userId, session.recordingId);
          }
        }

        logger.info(`Call ${callId} ended: ${reason}`);
      }
    } catch (error) {
      logger.error('End call error:', error);
    }
  }

  async stopScreenShare(connectionId) {
    try {
      const connection = this.activeConnections.get(connectionId);
      if (connection) {
        // Cleanup connection
        this.activeConnections.delete(connectionId);

        // Notify participants
        const recipientSocketId = this.getUserSocketId(connection.recipientId);
        if (recipientSocketId) {
          this.io.to(recipientSocketId).emit('screen_share_ended', {
            connectionId,
            sharerId: connection.sharerId,
            timestamp: new Date()
          });
        }

        logger.info(`Screen share ${connectionId} ended`);
      }
    } catch (error) {
      logger.error('Stop screen share error:', error);
    }
  }

  async stopRecording(userId, recordingId = null) {
    try {
      let session = null;
      
      if (recordingId) {
        session = this.recordingSessions.get(userId);
        if (session && session.recordingId.toString() === recordingId) {
          this.recordingSessions.delete(userId);
        }
      } else {
        session = this.recordingSessions.get(userId);
        if (session) {
          this.recordingSessions.delete(userId);
        }
      }

      if (session) {
        // Update recording if exists
        const recording = await Recording.findById(session.recordingId);
        if (recording && recording.status === 'recording') {
          recording.status = 'completed';
          recording.endTime = new Date();
          recording.duration = recording.endTime - recording.startTime;
          await recording.save();
        }

        logger.info(`Recording session ended for user ${userId}`);
      }
    } catch (error) {
      logger.error('Stop recording error:', error);
    }
  }

  // Helper methods
  getUserSocketId(userId) {
    // This should be implemented to get socket ID from the main socket service
    // For now, return null - this will be set by the main service
    return null;
  }

  setSocketService(socketService) {
    this.socketService = socketService;
    this.io = socketService.io;
  }

  getConnectionStats() {
    const stats = {
      activeCalls: 0,
      activeScreenShares: 0,
      activeRecordings: 0,
      totalConnections: this.activeConnections.size
    };

    for (const connection of this.activeConnections.values()) {
      if (connection.type === 'screen_share') {
        stats.activeScreenShares++;
      } else {
        stats.activeCalls++;
      }
    }

    stats.activeRecordings = this.recordingSessions.size;

    return stats;
  }

  cleanupInactiveConnections() {
    const now = Date.now();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [id, connection] of this.activeConnections.entries()) {
      if (now - connection.startTime.getTime() > inactiveThreshold) {
        if (connection.type === 'screen_share') {
          this.stopScreenShare(id);
        } else {
          this.endCall(id, 'timeout');
        }
      }
    }
  }
}

module.exports = new WebRTCService();