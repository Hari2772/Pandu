const Call = require('../models/Call');
const Recording = require('../models/Recording');
const Analytics = require('../models/Analytics');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class WebRTCService {
  constructor() {
    this.activeCalls = new Map(); // callId -> callData
    this.screenSharing = new Map(); // userId -> screenShareData
    this.recordingSessions = new Map(); // userId -> recordingData
    this.iceServers = this.getIceServers();
  }

  getIceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
  }

  // Call Management
  async initiateCall(callerId, recipientId, callType, isVideo = false) {
    try {
      // Check if either user is already in a call
      if (this.isUserInCall(callerId) || this.isUserInCall(recipientId)) {
        throw new Error('User is already in a call');
      }

      // Create call record
      const call = new Call({
        callerId,
        recipientId,
        callType: isVideo ? 'video' : callType,
        status: 'initiating',
        startTime: new Date()
      });

      await call.save();

      // Store call data
      const callData = {
        callId: call._id,
        callerId,
        recipientId,
        callType: call.callType,
        startTime: new Date(),
        status: 'initiating',
        iceCandidates: new Map(), // userId -> [iceCandidates]
        offers: new Map(), // userId -> offer
        answers: new Map() // userId -> answer
      };

      this.activeCalls.set(call._id.toString(), callData);

      // Track analytics
      await Analytics.create({
        eventType: 'call_initiated',
        eventName: 'WebRTC Call Initiated',
        eventCategory: 'communication',
        userId: callerId,
        platform: 'webrtc',
        metadata: {
          callId: call._id,
          callType: call.callType,
          recipientId
        }
      });

      logger.info(`WebRTC call initiated: ${call._id} from ${callerId} to ${recipientId}`);
      return call;

    } catch (error) {
      logger.error('Initiate call error:', error);
      throw error;
    }
  }

  async answerCall(callId, recipientId, answer) {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      if (callData.recipientId.toString() !== recipientId.toString()) {
        throw new Error('Unauthorized to answer this call');
      }

      // Store answer
      callData.answers.set(recipientId.toString(), answer);
      callData.status = 'active';

      // Update call record
      await Call.findByIdAndUpdate(callId, {
        status: 'active',
        answeredAt: new Date()
      });

      // Track analytics
      await Analytics.create({
        eventType: 'call_answered',
        eventName: 'WebRTC Call Answered',
        eventCategory: 'communication',
        userId: recipientId,
        platform: 'webrtc',
        metadata: {
          callId,
          callType: callData.callType
        }
      });

      logger.info(`WebRTC call answered: ${callId} by ${recipientId}`);
      return callData;

    } catch (error) {
      logger.error('Answer call error:', error);
      throw error;
    }
  }

  async rejectCall(callId, recipientId, reason = 'rejected') {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      // Update call record
      await Call.findByIdAndUpdate(callId, {
        status: 'rejected',
        endedAt: new Date(),
        endReason: reason
      });

      // Remove from active calls
      this.activeCalls.delete(callId.toString());

      // Track analytics
      await Analytics.create({
        eventType: 'call_ended',
        eventName: 'WebRTC Call Rejected',
        eventCategory: 'communication',
        userId: recipientId,
        platform: 'webrtc',
        metadata: {
          callId,
          callType: callData.callType,
          reason
        }
      });

      logger.info(`WebRTC call rejected: ${callId} by ${recipientId}`);
      return true;

    } catch (error) {
      logger.error('Reject call error:', error);
      throw error;
    }
  }

  async endCall(callId, userId, reason = 'ended') {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      // Check if user is part of the call
      if (callData.callerId.toString() !== userId.toString() && 
          callData.recipientId.toString() !== userId.toString()) {
        throw new Error('Unauthorized to end this call');
      }

      // Calculate call duration
      const endTime = new Date();
      const duration = callData.answeredAt ? 
        (endTime - callData.answeredAt) / 1000 : 0;

      // Update call record
      await Call.findByIdAndUpdate(callId, {
        status: 'ended',
        endedAt: endTime,
        endReason: reason,
        duration: Math.round(duration)
      });

      // Remove from active calls
      this.activeCalls.delete(callId.toString());

      // Track analytics
      await Analytics.create({
        eventType: 'call_ended',
        eventName: 'WebRTC Call Ended',
        eventCategory: 'communication',
        userId,
        platform: 'webrtc',
        duration: Math.round(duration),
        metadata: {
          callId,
          callType: callData.callType,
          reason,
          duration: Math.round(duration)
        }
      });

      logger.info(`WebRTC call ended: ${callId} by ${userId}, duration: ${duration}s`);
      return true;

    } catch (error) {
      logger.error('End call error:', error);
      throw error;
    }
  }

  // ICE Candidate Management
  async addIceCandidate(callId, userId, iceCandidate) {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      // Check if user is part of the call
      if (callData.callerId.toString() !== userId.toString() && 
          callData.recipientId.toString() !== userId.toString()) {
        throw new Error('Unauthorized to add ICE candidate');
      }

      // Store ICE candidate
      if (!callData.iceCandidates.has(userId.toString())) {
        callData.iceCandidates.set(userId.toString(), []);
      }
      callData.iceCandidates.get(userId.toString()).push(iceCandidate);

      logger.debug(`ICE candidate added for call ${callId} by user ${userId}`);
      return true;

    } catch (error) {
      logger.error('Add ICE candidate error:', error);
      throw error;
    }
  }

  async getIceCandidates(callId, userId) {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      // Get ICE candidates from the other user
      const otherUserId = callData.callerId.toString() === userId.toString() ? 
        callData.recipientId.toString() : callData.callerId.toString();

      return callData.iceCandidates.get(otherUserId) || [];

    } catch (error) {
      logger.error('Get ICE candidates error:', error);
      throw error;
    }
  }

  // Offer/Answer Management
  async setOffer(callId, userId, offer) {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      // Check if user is part of the call
      if (callData.callerId.toString() !== userId.toString() && 
          callData.recipientId.toString() !== userId.toString()) {
        throw new Error('Unauthorized to set offer');
      }

      callData.offers.set(userId.toString(), offer);
      logger.debug(`Offer set for call ${callId} by user ${userId}`);
      return true;

    } catch (error) {
      logger.error('Set offer error:', error);
      throw error;
    }
  }

  async getOffer(callId, userId) {
    try {
      const callData = this.activeCalls.get(callId.toString());
      if (!callData) {
        throw new Error('Call not found');
      }

      // Get offer from the other user
      const otherUserId = callData.callerId.toString() === userId.toString() ? 
        callData.recipientId.toString() : callData.callerId.toString();

      return callData.offers.get(otherUserId);

    } catch (error) {
      logger.error('Get offer error:', error);
      throw error;
    }
  }

  // Screen Sharing
  async startScreenShare(sharerId, recipientId, isVideo = false) {
    try {
      // Check if user is already screen sharing
      if (this.screenSharing.has(sharerId.toString())) {
        throw new Error('User is already screen sharing');
      }

      // Store screen sharing data
      const screenShareData = {
        sharerId,
        recipientId,
        isVideo,
        startTime: new Date(),
        status: 'active',
        iceCandidates: new Map(),
        offers: new Map(),
        answers: new Map()
      };

      this.screenSharing.set(sharerId.toString(), screenShareData);

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_started',
        eventName: 'WebRTC Screen Share Started',
        eventCategory: 'media',
        userId: sharerId,
        platform: 'webrtc',
        metadata: {
          recipientId,
          isVideo
        }
      });

      logger.info(`Screen sharing started by ${sharerId} to ${recipientId}`);
      return screenShareData;

    } catch (error) {
      logger.error('Start screen share error:', error);
      throw error;
    }
  }

  async stopScreenShare(sharerId) {
    try {
      const screenShareData = this.screenSharing.get(sharerId.toString());
      if (!screenShareData) {
        throw new Error('Screen sharing session not found');
      }

      // Calculate duration
      const duration = (new Date() - screenShareData.startTime) / 1000;

      // Remove from active sessions
      this.screenSharing.delete(sharerId.toString());

      // Track analytics
      await Analytics.create({
        eventType: 'screen_share_stopped',
        eventName: 'WebRTC Screen Share Stopped',
        eventCategory: 'media',
        userId: sharerId,
        platform: 'webrtc',
        duration: Math.round(duration),
        metadata: {
          recipientId: screenShareData.recipientId,
          duration: Math.round(duration)
        }
      });

      logger.info(`Screen sharing stopped by ${sharerId}, duration: ${duration}s`);
      return true;

    } catch (error) {
      logger.error('Stop screen share error:', error);
      throw error;
    }
  }

  // Recording
  async startRecording(userId, callId = null, type = 'audio') {
    try {
      // Check if user is already recording
      if (this.recordingSessions.has(userId.toString())) {
        throw new Error('User is already recording');
      }

      // Create recording record
      const recording = new Recording({
        userId,
        callId,
        type,
        status: 'recording',
        startTime: new Date()
      });

      await recording.save();

      // Store recording session data
      const recordingData = {
        recordingId: recording._id,
        userId,
        callId,
        type,
        startTime: new Date(),
        status: 'recording',
        isPaused: false,
        pauseTime: 0
      };

      this.recordingSessions.set(userId.toString(), recordingData);

      // Track analytics
      await Analytics.create({
        eventType: 'recording_started',
        eventName: 'WebRTC Recording Started',
        eventCategory: 'media',
        userId,
        platform: 'webrtc',
        metadata: {
          recordingId: recording._id,
          callId,
          type
        }
      });

      logger.info(`Recording started by ${userId}, type: ${type}`);
      return recording;

    } catch (error) {
      logger.error('Start recording error:', error);
      throw error;
    }
  }

  async stopRecording(userId) {
    try {
      const recordingData = this.recordingSessions.get(userId.toString());
      if (!recordingData) {
        throw new Error('Recording session not found');
      }

      // Calculate total duration
      const endTime = new Date();
      const totalDuration = (endTime - recordingData.startTime) / 1000;
      const actualDuration = totalDuration - recordingData.pauseTime;

      // Update recording record
      await Recording.findByIdAndUpdate(recordingData.recordingId, {
        status: 'completed',
        endTime,
        duration: Math.round(actualDuration)
      });

      // Remove from active sessions
      this.recordingSessions.delete(userId.toString());

      // Track analytics
      await Analytics.create({
        eventType: 'recording_stopped',
        eventName: 'WebRTC Recording Stopped',
        eventCategory: 'media',
        userId,
        platform: 'webrtc',
        duration: Math.round(actualDuration),
        metadata: {
          recordingId: recordingData.recordingId,
          duration: Math.round(actualDuration)
        }
      });

      logger.info(`Recording stopped by ${userId}, duration: ${actualDuration}s`);
      return true;

    } catch (error) {
      logger.error('Stop recording error:', error);
      throw error;
    }
  }

  async pauseRecording(userId) {
    try {
      const recordingData = this.recordingSessions.get(userId.toString());
      if (!recordingData) {
        throw new Error('Recording session not found');
      }

      if (recordingData.isPaused) {
        throw new Error('Recording is already paused');
      }

      recordingData.isPaused = true;
      recordingData.pauseStartTime = new Date();

      // Update recording record
      await Recording.findByIdAndUpdate(recordingData.recordingId, {
        status: 'paused',
        pauseTime: new Date()
      });

      logger.info(`Recording paused by ${userId}`);
      return true;

    } catch (error) {
      logger.error('Pause recording error:', error);
      throw error;
    }
  }

  async resumeRecording(userId) {
    try {
      const recordingData = this.recordingSessions.get(userId.toString());
      if (!recordingData) {
        throw new Error('Recording session not found');
      }

      if (!recordingData.isPaused) {
        throw new Error('Recording is not paused');
      }

      // Calculate pause duration
      const pauseDuration = (new Date() - recordingData.pauseStartTime) / 1000;
      recordingData.pauseTime += pauseDuration;
      recordingData.isPaused = false;

      // Update recording record
      await Recording.findByIdAndUpdate(recordingData.recordingId, {
        status: 'recording',
        resumeTime: new Date()
      });

      logger.info(`Recording resumed by ${userId}`);
      return true;

    } catch (error) {
      logger.error('Resume recording error:', error);
      throw error;
    }
  }

  // Utility Methods
  isUserInCall(userId) {
    for (const [callId, callData] of this.activeCalls.entries()) {
      if (callData.callerId.toString() === userId.toString() || 
          callData.recipientId.toString() === userId.toString()) {
        return callId;
      }
    }
    return false;
  }

  isUserScreenSharing(userId) {
    return this.screenSharing.has(userId.toString());
  }

  isUserRecording(userId) {
    return this.recordingSessions.has(userId.toString());
  }

  getActiveCall(userId) {
    const callId = this.isUserInCall(userId);
    return callId ? this.activeCalls.get(callId) : null;
  }

  getScreenShareData(userId) {
    return this.screenSharing.get(userId.toString());
  }

  getRecordingData(userId) {
    return this.recordingSessions.get(userId.toString());
  }

  getAllActiveCalls() {
    return Array.from(this.activeCalls.values());
  }

  getAllScreenSharing() {
    return Array.from(this.screenSharing.values());
  }

  getAllRecordingSessions() {
    return Array.from(this.recordingSessions.values());
  }

  // Cleanup Methods
  cleanupExpiredSessions() {
    const now = Date.now();
    
    // Cleanup expired calls (1 hour)
    for (const [callId, callData] of this.activeCalls.entries()) {
      if (now - callData.startTime > 3600000) {
        this.activeCalls.delete(callId);
        logger.warn(`Expired call cleaned up: ${callId}`);
      }
    }

    // Cleanup expired screen sharing (30 minutes)
    for (const [userId, screenShareData] of this.screenSharing.entries()) {
      if (now - screenShareData.startTime > 1800000) {
        this.screenSharing.delete(userId);
        logger.warn(`Expired screen sharing cleaned up for user: ${userId}`);
      }
    }

    // Cleanup expired recordings (2 hours)
    for (const [userId, recordingData] of this.recordingSessions.entries()) {
      if (now - recordingData.startTime > 7200000) {
        this.recordingSessions.delete(userId);
        logger.warn(`Expired recording session cleaned up for user: ${userId}`);
      }
    }
  }

  // Health Check
  getHealthStatus() {
    return {
      activeCalls: this.activeCalls.size,
      screenSharing: this.screenSharing.size,
      recordingSessions: this.recordingSessions.size,
      totalSessions: this.activeCalls.size + this.screenSharing.size + this.recordingSessions.size,
      timestamp: new Date()
    };
  }
}

module.exports = new WebRTCService();