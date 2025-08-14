const Call = require('../../models/Call');
const Recording = require('../../models/Recording');
const User = require('../../models/User');
const Analytics = require('../../models/Analytics');
const redisManager = require('../../config/redis');
const logger = require('../../utils/logger');
const constants = require('../../utils/constants');

class WebRTCHandler {
  constructor(io, authHandler) {
    this.io = io;
    this.authHandler = authHandler;
    this.activeCalls = new Map(); // callId -> callData
    this.userCalls = new Map(); // userId -> callId
    this.screenSharing = new Map(); // userId -> callId
    this.recordingSessions = new Map(); // callId -> recordingData
  }

  // Handle call initiation
  async handleCallInitiate(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { targetUserId, callType = 'audio', isVideo = false, isScreenShare = false } = data;

      if (!targetUserId) {
        socket.emit('call:error', { error: 'Target user ID is required' });
        return;
      }

      // Check if user is already in a call
      if (this.userCalls.has(userData.id)) {
        socket.emit('call:error', { error: 'You are already in a call' });
        return;
      }

      // Check if target user is available
      const targetUser = await User.findById(targetUserId);
      if (!targetUser || !targetUser.isActive) {
        socket.emit('call:error', { error: 'Target user is not available' });
        return;
      }

      // Check if target user is online
      if (!this.authHandler.isUserOnline(targetUserId)) {
        socket.emit('call:error', { error: 'Target user is offline' });
        return;
      }

      // Check if target user is already in a call
      if (this.userCalls.has(targetUserId)) {
        socket.emit('call:error', { error: 'Target user is already in a call' });
        return;
      }

      // Create call record
      const call = new Call({
        initiatorId: userData.id,
        participants: [
          { userId: userData.id, role: 'initiator', joinedAt: new Date() },
          { userId: targetUserId, role: 'participant', joinedAt: null }
        ],
        callType,
        isVideo,
        isScreenShare,
        status: 'initiating',
        startTime: new Date()
      });

      await call.save();

      // Store call data
      const callData = {
        callId: call._id,
        initiatorId: userData.id,
        targetUserId,
        callType,
        isVideo,
        isScreenShare,
        status: 'initiating',
        startTime: new Date(),
        participants: [userData.id, targetUserId]
      };

      this.activeCalls.set(call._id, callData);
      this.userCalls.set(userData.id, call._id);
      this.userCalls.set(targetUserId, call._id);

      // Send call invitation to target user
      this.authHandler.broadcastToUser(targetUserId, 'call:incoming', {
        callId: call._id,
        initiatorId: userData.id,
        initiatorName: userData.displayName,
        initiatorPicture: userData.profilePicture,
        callType,
        isVideo,
        isScreenShare
      });

      // Send confirmation to initiator
      socket.emit('call:initiated', {
        callId: call._id,
        status: 'initiating',
        targetUserId
      });

      // Track analytics
      await Analytics.create({
        eventType: 'call_initiated',
        eventName: 'Call Initiated',
        eventCategory: 'communication',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId: call._id,
          targetUserId,
          callType,
          isVideo,
          isScreenShare
        }
      });

      logger.info(`Call initiated by ${userData.username} to ${targetUser.username}`);

    } catch (error) {
      logger.error('Handle call initiate error:', error);
      socket.emit('call:error', { error: 'Failed to initiate call' });
    }
  }

  // Handle call answer
  async handleCallAnswer(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId, answer = 'accept' } = data;

      if (!callId) {
        socket.emit('call:error', { error: 'Call ID is required' });
        return;
      }

      const callData = this.activeCalls.get(callId);
      if (!callData) {
        socket.emit('call:error', { error: 'Call not found' });
        return;
      }

      if (callData.targetUserId.toString() !== userData.id.toString()) {
        socket.emit('call:error', { error: 'You are not the target of this call' });
        return;
      }

      if (answer === 'accept') {
        // Accept call
        callData.status = 'active';
        callData.answerTime = new Date();

        // Update call record
        await Call.findByIdAndUpdate(callId, {
          status: 'active',
          answerTime: new Date(),
          'participants.1.joinedAt': new Date()
        });

        // Notify initiator
        this.authHandler.broadcastToUser(callData.initiatorId, 'call:answered', {
          callId,
          status: 'active',
          answerTime: new Date()
        });

        // Send WebRTC offer/answer exchange signals
        socket.emit('call:accepted', {
          callId,
          status: 'active',
          initiatorId: callData.initiatorId
        });

        // Track analytics
        await Analytics.create({
          eventType: 'call_answered',
          eventName: 'Call Answered',
          eventCategory: 'communication',
          userId: userData.id,
          sessionId: socket.id,
          platform: 'socket',
          metadata: {
            callId,
            initiatorId: callData.initiatorId,
            callType: callData.callType
          }
        });

        logger.info(`Call ${callId} answered by ${userData.username}`);

      } else if (answer === 'reject') {
        // Reject call
        await this.handleCallEnd(callId, 'rejected', userData.id);
      }

    } catch (error) {
      logger.error('Handle call answer error:', error);
      socket.emit('call:error', { error: 'Failed to answer call' });
    }
  }

  // Handle call end
  async handleCallEnd(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId, reason = 'ended' } = data;

      if (!callId) {
        socket.emit('call:error', { error: 'Call ID is required' });
        return;
      }

      await this.handleCallEnd(callId, reason, userData.id);

    } catch (error) {
      logger.error('Handle call end error:', error);
      socket.emit('call:error', { error: 'Failed to end call' });
    }
  }

  // Internal call end handler
  async handleCallEnd(callId, reason, endedBy) {
    try {
      const callData = this.activeCalls.get(callId);
      if (!callData) return;

      // Update call record
      const endTime = new Date();
      const duration = endTime - callData.startTime;

      await Call.findByIdAndUpdate(callId, {
        status: 'ended',
        endTime,
        duration,
        endReason: reason,
        endedBy
      });

      // Stop recording if active
      if (this.recordingSessions.has(callId)) {
        await this.stopRecording(callId);
      }

      // Stop screen sharing if active
      if (this.screenSharing.has(callId)) {
        this.screenSharing.delete(callId);
      }

      // Notify all participants
      callData.participants.forEach(userId => {
        this.authHandler.broadcastToUser(userId, 'call:ended', {
          callId,
          status: 'ended',
          reason,
          duration,
          endedBy
        });
      });

      // Clean up
      this.activeCalls.delete(callId);
      callData.participants.forEach(userId => {
        this.userCalls.delete(userId);
      });

      // Track analytics
      await Analytics.create({
        eventType: 'call_ended',
        eventName: 'Call Ended',
        eventCategory: 'communication',
        userId: endedBy,
        sessionId: 'system',
        platform: 'socket',
        duration,
        metadata: {
          callId,
          reason,
          callType: callData.callType,
          isVideo: callData.isVideo,
          isScreenShare: callData.isScreenShare
        }
      });

      logger.info(`Call ${callId} ended: ${reason}`);

    } catch (error) {
      logger.error('Handle call end error:', error);
    }
  }

  // Handle WebRTC signaling
  async handleSignaling(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId, targetUserId, signal, type } = data;

      if (!callId || !targetUserId || !signal || !type) {
        socket.emit('webrtc:error', { error: 'Missing signaling data' });
        return;
      }

      // Validate call exists and user is participant
      const callData = this.activeCalls.get(callId);
      if (!callData || !callData.participants.includes(userData.id)) {
        socket.emit('webrtc:error', { error: 'Invalid call or not a participant' });
        return;
      }

      // Forward signal to target user
      this.authHandler.broadcastToUser(targetUserId, 'webrtc:signal', {
        callId,
        fromUserId: userData.id,
        signal,
        type
      });

    } catch (error) {
      logger.error('Handle signaling error:', error);
      socket.emit('webrtc:error', { error: 'Failed to send signal' });
    }
  }

  // Handle screen sharing start
  async handleScreenShareStart(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId } = data;

      if (!callId) {
        socket.emit('screenshare:error', { error: 'Call ID is required' });
        return;
      }

      const callData = this.activeCalls.get(callId);
      if (!callData || !callData.participants.includes(userData.id)) {
        socket.emit('screenshare:error', { error: 'Invalid call or not a participant' });
        return;
      }

      // Check if screen sharing is already active
      if (this.screenSharing.has(callId)) {
        socket.emit('screenshare:error', { error: 'Screen sharing is already active' });
        return;
      }

      // Start screen sharing
      this.screenSharing.set(callId, userData.id);

      // Notify all participants
      callData.participants.forEach(userId => {
        this.authHandler.broadcastToUser(userId, 'screenshare:started', {
          callId,
          startedBy: userData.id,
          startedAt: new Date()
        });
      });

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_started',
        eventName: 'Screen Share Started',
        eventCategory: 'media',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId,
          callType: callData.callType
        }
      });

      logger.info(`Screen sharing started in call ${callId} by ${userData.username}`);

    } catch (error) {
      logger.error('Handle screen share start error:', error);
      socket.emit('screenshare:error', { error: 'Failed to start screen sharing' });
    }
  }

  // Handle screen sharing stop
  async handleScreenShareStop(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId } = data;

      if (!callId) {
        socket.emit('screenshare:error', { error: 'Call ID is required' });
        return;
      }

      const callData = this.activeCalls.get(callId);
      if (!callData || !callData.participants.includes(userData.id)) {
        socket.emit('screenshare:error', { error: 'Invalid call or not a participant' });
        return;
      }

      // Check if user started the screen sharing
      if (this.screenSharing.get(callId) !== userData.id) {
        socket.emit('screenshare:error', { error: 'You did not start the screen sharing' });
        return;
      }

      // Stop screen sharing
      this.screenSharing.delete(callId);

      // Notify all participants
      callData.participants.forEach(userId => {
        this.authHandler.broadcastToUser(userId, 'screenshare:stopped', {
          callId,
          stoppedBy: userData.id,
          stoppedAt: new Date()
        });
      });

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_stopped',
        eventName: 'Screen Share Stopped',
        eventCategory: 'media',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId,
          callType: callData.callType
        }
      });

      logger.info(`Screen sharing stopped in call ${callId} by ${userData.username}`);

    } catch (error) {
      logger.error('Handle screen share stop error:', error);
      socket.emit('screenshare:error', { error: 'Failed to stop screen sharing' });
    }
  }

  // Handle recording start
  async handleRecordingStart(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId, recordingType = 'audio' } = data;

      if (!callId) {
        socket.emit('recording:error', { error: 'Call ID is required' });
        return;
      }

      const callData = this.activeCalls.get(callId);
      if (!callData || !callData.participants.includes(userData.id)) {
        socket.emit('recording:error', { error: 'Invalid call or not a participant' });
        return;
      }

      // Check if recording is already active
      if (this.recordingSessions.has(callId)) {
        socket.emit('recording:error', { error: 'Recording is already active' });
        return;
      }

      // Create recording record
      const recording = new Recording({
        callId,
        startedBy: userData.id,
        recordingType,
        status: 'recording',
        startTime: new Date()
      });

      await recording.save();

      // Start recording session
      this.recordingSessions.set(callId, {
        recordingId: recording._id,
        startedBy: userData.id,
        recordingType,
        startTime: new Date()
      });

      // Notify all participants
      callData.participants.forEach(userId => {
        this.authHandler.broadcastToUser(userId, 'recording:started', {
          callId,
          recordingId: recording._id,
          startedBy: userData.id,
          recordingType,
          startedAt: new Date()
        });
      });

      // Track analytics
      await Analytics.create({
        eventType: 'recording_started',
        eventName: 'Recording Started',
        eventCategory: 'media',
        userId: userData.id,
        sessionId: socket.id,
        platform: 'socket',
        metadata: {
          callId,
          recordingId: recording._id,
          recordingType
        }
      });

      logger.info(`Recording started in call ${callId} by ${userData.username}`);

    } catch (error) {
      logger.error('Handle recording start error:', error);
      socket.emit('recording:error', { error: 'Failed to start recording' });
    }
  }

  // Handle recording stop
  async handleRecordingStop(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId } = data;

      if (!callId) {
        socket.emit('recording:error', { error: 'Call ID is required' });
        return;
      }

      const callData = this.activeCalls.get(callId);
      if (!callData || !callData.participants.includes(userData.id)) {
        socket.emit('recording:error', { error: 'Invalid call or not a participant' });
        return;
      }

      const recordingSession = this.recordingSessions.get(callId);
      if (!recordingSession) {
        socket.emit('recording:error', { error: 'No active recording found' });
        return;
      }

      // Check if user started the recording
      if (recordingSession.startedBy !== userData.id) {
        socket.emit('recording:error', { error: 'You did not start the recording' });
        return;
      }

      // Stop recording
      await this.stopRecording(callId);

      // Notify all participants
      callData.participants.forEach(userId => {
        this.authHandler.broadcastToUser(userId, 'recording:stopped', {
          callId,
          recordingId: recordingSession.recordingId,
          stoppedBy: userData.id,
          stoppedAt: new Date()
        });
      });

      logger.info(`Recording stopped in call ${callId} by ${userData.username}`);

    } catch (error) {
      logger.error('Handle recording stop error:', error);
      socket.emit('recording:error', { error: 'Failed to stop recording' });
    }
  }

  // Internal recording stop handler
  async stopRecording(callId) {
    try {
      const recordingSession = this.recordingSessions.get(callId);
      if (!recordingSession) return;

      // Update recording record
      const endTime = new Date();
      const duration = endTime - recordingSession.startTime;

      await Recording.findByIdAndUpdate(recordingSession.recordingId, {
        status: 'completed',
        endTime,
        duration
      });

      // Clean up
      this.recordingSessions.delete(callId);

      // Track analytics
      await Analytics.create({
        eventType: 'recording_stopped',
        eventName: 'Recording Stopped',
        eventCategory: 'media',
        userId: recordingSession.startedBy,
        sessionId: 'system',
        platform: 'socket',
        duration,
        metadata: {
          callId,
          recordingId: recordingSession.recordingId,
          recordingType: recordingSession.recordingType
        }
      });

    } catch (error) {
      logger.error('Stop recording error:', error);
    }
  }

  // Handle call quality metrics
  async handleQualityMetrics(socket, data) {
    try {
      const userData = await this.authHandler.validateSession(socket);
      if (!userData) return;

      const { callId, metrics } = data;

      if (!callId || !metrics) {
        socket.emit('quality:error', { error: 'Call ID and metrics are required' });
        return;
      }

      // Store metrics in Redis for real-time monitoring
      await redisManager.getClient().setex(
        `call:quality:${callId}:${userData.id}`,
        300, // 5 minutes
        JSON.stringify({
          ...metrics,
          timestamp: new Date(),
          userId: userData.id
        })
      );

      // Track analytics for significant quality issues
      if (metrics.packetLoss > 0.1 || metrics.latency > 500) {
        await Analytics.create({
          eventType: 'call_quality_issue',
          eventName: 'Call Quality Issue',
          eventCategory: 'performance',
          userId: userData.id,
          sessionId: socket.id,
          platform: 'socket',
          metadata: {
            callId,
            packetLoss: metrics.packetLoss,
            latency: metrics.latency,
            jitter: metrics.jitter,
            bandwidth: metrics.bandwidth
          }
        });
      }

    } catch (error) {
      logger.error('Handle quality metrics error:', error);
    }
  }

  // Get call statistics
  getCallStats() {
    return {
      activeCalls: this.activeCalls.size,
      activeRecordings: this.recordingSessions.size,
      activeScreenSharing: this.screenSharing.size,
      totalParticipants: Array.from(this.activeCalls.values())
        .reduce((total, call) => total + call.participants.length, 0)
    };
  }

  // Clean up expired calls
  async cleanupExpiredCalls() {
    try {
      const now = Date.now();
      const expiredCalls = [];

      for (const [callId, callData] of this.activeCalls) {
        const timeDiff = now - callData.startTime;
        
        // Consider call expired after 2 hours
        if (timeDiff > 2 * 60 * 60 * 1000) {
          expiredCalls.push(callId);
        }
      }

      expiredCalls.forEach(callId => {
        this.handleCallEnd(callId, 'expired', 'system');
      });

      if (expiredCalls.length > 0) {
        logger.info(`Cleaned up ${expiredCalls.length} expired calls`);
      }

    } catch (error) {
      logger.error('Cleanup expired calls error:', error);
    }
  }
}

module.exports = WebRTCHandler;