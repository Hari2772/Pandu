const User = require('../models/User');
const TierData = require('../models/TierData');
const Analytics = require('../models/Analytics');
const { validateUserData, validateLocationUpdate } = require('../utils/validators');
const { createJWT, verifyJWT } = require('../utils/auth');
const { hashPassword, comparePassword } = require('../utils/crypto');
const { sendEmail } = require('../utils/email');
const { generateVerificationToken, generateResetToken } = require('../utils/tokens');
const { uploadToCloud, deleteFromCloud } = require('../utils/storage');
const redisManager = require('../config/redis');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class UserController {
  // User Registration
  async register(req, res) {
    try {
      const { email, username, displayName, password, phoneNumber, dateOfBirth } = req.body;

      // Validate input data
      const validation = validateUserData(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validation.errors
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'User already exists with this email or username'
        });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);

      // Create user
      const user = new User({
        email,
        username,
        displayName,
        password: hashedPassword,
        phoneNumber,
        dateOfBirth,
        authProvider: 'local'
      });

      await user.save();

      // Create tier data
      const tierData = new TierData({
        userId: user._id,
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        tier: 5, // Default tier
        tierName: constants.TIER_NAMES[5]
      });

      await tierData.save();

      // Track analytics
      await Analytics.create({
        eventType: 'user_registration',
        eventName: 'User Registration',
        eventCategory: 'user',
        userId: user._id,
        sessionId: req.sessionID || 'unknown',
        platform: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'web',
        metadata: {
          authProvider: 'local',
          hasPhoneNumber: !!phoneNumber,
          hasDateOfBirth: !!dateOfBirth
        }
      });

      // Generate JWT token
      const token = createJWT(user._id);

      // Send verification email
      const verificationToken = generateVerificationToken();
      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await user.save();

      await sendEmail({
        to: email,
        subject: 'Verify Your Email - NearChat',
        template: 'emailVerification',
        data: {
          username: displayName,
          verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`
        }
      });

      // Cache user data in Redis
      await redisManager.getClient().setex(
        `user:${user._id}`,
        3600, // 1 hour
        JSON.stringify({
          id: user._id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          role: user.role
        })
      );

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            isEmailVerified: user.isEmailVerified,
            role: user.role,
            tier: user.tier
          },
          token
        }
      });

    } catch (error) {
      logger.error('User registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // User Login
  async login(req, res) {
    try {
      const { email, password, deviceId, platform, appVersion } = req.body;

      // Find user by email or username
      const user = await User.findOne({
        $or: [{ email }, { username: email }]
      }).select('+password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      // Verify password
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Update user status
      user.isOnline = true;
      user.lastSeen = new Date();
      user.lastActiveDate = new Date();
      await user.save();

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId: user._id },
        {
          isOnline: true,
          lastSeen: new Date(),
          lastUpdate: new Date(),
          deviceInfo: {
            deviceId,
            platform,
            appVersion
          }
        },
        { upsert: true }
      );

      // Generate JWT token
      const token = createJWT(user._id);

      // Track analytics
      await Analytics.create({
        eventType: 'user_login',
        eventName: 'User Login',
        eventCategory: 'user',
        userId: user._id,
        sessionId: req.sessionID || 'unknown',
        platform: platform || 'web',
        appVersion,
        deviceId,
        metadata: {
          authProvider: user.authProvider,
          isEmailVerified: user.isEmailVerified
        }
      });

      // Cache user data in Redis
      await redisManager.getClient().setex(
        `user:${user._id}`,
        3600, // 1 hour
        JSON.stringify({
          id: user._id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
          tier: user.tier
        })
      );

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            profilePicture: user.profilePicture,
            isEmailVerified: user.isEmailVerified,
            role: user.role,
            tier: user.tier,
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak
          },
          token
        }
      });

    } catch (error) {
      logger.error('User login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Google OAuth Login
  async googleLogin(req, res) {
    try {
      const { googleId, email, displayName, profilePicture } = req.body;

      let user = await User.findOne({ googleId });

      if (!user) {
        // Create new user
        user = new User({
          googleId,
          email,
          displayName,
          profilePicture,
          username: email.split('@')[0] + Math.random().toString(36).substr(2, 5),
          authProvider: 'google',
          isEmailVerified: true
        });

        await user.save();

        // Create tier data
        const tierData = new TierData({
          userId: user._id,
          username: user.username,
          displayName: user.displayName,
          profilePicture: user.profilePicture,
          tier: 5,
          tierName: constants.TIER_NAMES[5]
        });

        await tierData.save();

        // Track analytics
        await Analytics.create({
          eventType: 'user_registration',
          eventName: 'Google OAuth Registration',
          eventCategory: 'user',
          userId: user._id,
          sessionId: req.sessionID || 'unknown',
          platform: 'web',
          metadata: {
            authProvider: 'google',
            isEmailVerified: true
          }
        });
      } else {
        // Update existing user
        user.isOnline = true;
        user.lastSeen = new Date();
        user.lastActiveDate = new Date();
        user.profilePicture = profilePicture;
        await user.save();

        // Update tier data
        await TierData.findOneAndUpdate(
          { userId: user._id },
          {
            isOnline: true,
            lastSeen: new Date(),
            lastUpdate: new Date(),
            profilePicture
          }
        );

        // Track analytics
        await Analytics.create({
          eventType: 'user_login',
          eventName: 'Google OAuth Login',
          eventCategory: 'user',
          userId: user._id,
          sessionId: req.sessionID || 'unknown',
          platform: 'web',
          metadata: {
            authProvider: 'google'
          }
        });
      }

      // Generate JWT token
      const token = createJWT(user._id);

      res.json({
        success: true,
        message: 'Google login successful',
        data: {
          user: {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            profilePicture: user.profilePicture,
            isEmailVerified: user.isEmailVerified,
            role: user.role,
            tier: user.tier
          },
          token
        }
      });

    } catch (error) {
      logger.error('Google login error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get User Profile
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const user = await User.findById(userId)
        .select('-password -emailVerificationToken -passwordResetToken')
        .populate('friends.userId', 'username displayName profilePicture isOnline lastSeen')
        .populate('blockedUsers.userId', 'username displayName');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get tier data
      const tierData = await TierData.findOne({ userId });

      res.json({
        success: true,
        data: {
          user: {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            bio: user.bio,
            profilePicture: user.profilePicture,
            coverPhoto: user.coverPhoto,
            phoneNumber: user.phoneNumber,
            dateOfBirth: user.dateOfBirth,
            isEmailVerified: user.isEmailVerified,
            role: user.role,
            tier: user.tier,
            currentStreak: user.currentStreak,
            longestStreak: user.longestStreak,
            isOnline: user.isOnline,
            lastSeen: user.lastSeen,
            preferences: user.preferences,
            stats: user.stats,
            friends: user.friends,
            blockedUsers: user.blockedUsers,
            achievements: user.achievements
          },
          tierData: tierData ? {
            tier: tierData.tier,
            tierName: tierData.tierName,
            tierDistance: tierData.tierDistance,
            nearbyUsers: tierData.nearbyUsers.length,
            totalNearbyUsers: tierData.totalNearbyUsers
          } : null
        }
      });

    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Update User Profile
  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const updateData = req.body;

      // Validate update data
      const validation = validateUserData(updateData, true);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validation.errors
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if username is being changed and if it's already taken
      if (updateData.username && updateData.username !== user.username) {
        const existingUser = await User.findOne({ username: updateData.username });
        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'Username is already taken'
          });
        }
      }

      // Update user
      Object.keys(updateData).forEach(key => {
        if (key !== 'password' && key !== 'email' && key !== 'role') {
          user[key] = updateData[key];
        }
      });

      await user.save();

      // Update tier data if display name or profile picture changed
      if (updateData.displayName || updateData.profilePicture) {
        await TierData.findOneAndUpdate(
          { userId },
          {
            displayName: updateData.displayName || user.displayName,
            profilePicture: updateData.profilePicture || user.profilePicture
          }
        );
      }

      // Track analytics
      await Analytics.create({
        eventType: 'user_profile_update',
        eventName: 'Profile Update',
        eventCategory: 'user',
        userId: user._id,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          updatedFields: Object.keys(updateData)
        }
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            bio: user.bio,
            profilePicture: user.profilePicture,
            coverPhoto: user.coverPhoto,
            phoneNumber: user.phoneNumber,
            dateOfBirth: user.dateOfBirth,
            preferences: user.preferences
          }
        }
      });

    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Update User Location
  async updateLocation(req, res) {
    try {
      const userId = req.user.id;
      const { coordinates, accuracy, address, placeName } = req.body;

      // Validate location data
      const validation = validateLocationUpdate(req.body);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validation.errors
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Update user location
      user.updateLocation(coordinates, accuracy);
      await user.save();

      // Update tier data
      const tierData = await TierData.findOne({ userId });
      if (tierData) {
        tierData.updateLocation(coordinates, accuracy, address, placeName);
        await tierData.save();
      }

      // Track analytics
      await Analytics.create({
        eventType: 'location_updated',
        eventName: 'Location Update',
        eventCategory: 'location',
        userId: user._id,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        location: {
          coordinates,
          accuracy,
          address,
          placeName
        },
        metadata: {
          accuracy,
          address,
          placeName
        }
      });

      res.json({
        success: true,
        message: 'Location updated successfully',
        data: {
          location: {
            coordinates: user.location.coordinates,
            accuracy: user.location.accuracy,
            lastUpdated: user.location.lastUpdated
          }
        }
      });

    } catch (error) {
      logger.error('Update location error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Upload Profile Picture
  async uploadProfilePicture(req, res) {
    try {
      const userId = req.user.id;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Delete old profile picture if exists
      if (user.profilePicture) {
        await deleteFromCloud(user.profilePicture);
      }

      // Upload new profile picture
      const uploadResult = await uploadToCloud(file, 'profile-pictures');

      // Update user
      user.profilePicture = uploadResult.url;
      await user.save();

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        { profilePicture: uploadResult.url }
      );

      res.json({
        success: true,
        message: 'Profile picture uploaded successfully',
        data: {
          profilePicture: uploadResult.url
        }
      });

    } catch (error) {
      logger.error('Upload profile picture error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Change Password
  async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
        });
      }

      const user = await User.findById(userId).select('+password');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify current password
      const isCurrentPasswordValid = await comparePassword(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const hashedNewPassword = await hashPassword(newPassword);
      user.password = hashedNewPassword;
      await user.save();

      // Track analytics
      await Analytics.create({
        eventType: 'user_profile_update',
        eventName: 'Password Change',
        eventCategory: 'user',
        userId: user._id,
        sessionId: req.sessionID || 'unknown',
        platform: 'web',
        metadata: {
          action: 'password_change'
        }
      });

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Forgot Password
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const user = await User.findOne({ email });
      if (!user) {
        // Don't reveal if user exists or not
        return res.json({
          success: true,
          message: 'If an account with that email exists, a password reset link has been sent'
        });
      }

      // Generate reset token
      const resetToken = generateResetToken();
      user.passwordResetToken = resetToken;
      user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await user.save();

      // Send reset email
      await sendEmail({
        to: email,
        subject: 'Reset Your Password - NearChat',
        template: 'passwordReset',
        data: {
          username: user.displayName,
          resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`
        }
      });

      res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });

    } catch (error) {
      logger.error('Forgot password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Reset Password
  async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Token and new password are required'
        });
      }

      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword);
      user.password = hashedPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      res.json({
        success: true,
        message: 'Password reset successfully'
      });

    } catch (error) {
      logger.error('Reset password error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Verify Email
  async verifyEmail(req, res) {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Verification token is required'
        });
      }

      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired verification token'
        });
      }

      // Verify email
      user.isEmailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();

      res.json({
        success: true,
        message: 'Email verified successfully'
      });

    } catch (error) {
      logger.error('Verify email error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Resend Verification Email
  async resendVerificationEmail(req, res) {
    try {
      const userId = req.user.id;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.isEmailVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email is already verified'
        });
      }

      // Generate new verification token
      const verificationToken = generateVerificationToken();
      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await user.save();

      // Send verification email
      await sendEmail({
        to: user.email,
        subject: 'Verify Your Email - NearChat',
        template: 'emailVerification',
        data: {
          username: user.displayName,
          verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`
        }
      });

      res.json({
        success: true,
        message: 'Verification email sent successfully'
      });

    } catch (error) {
      logger.error('Resend verification email error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Logout
  async logout(req, res) {
    try {
      const userId = req.user.id;

      // Update user status
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date()
      });

      // Update tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          isOnline: false,
          lastSeen: new Date(),
          lastUpdate: new Date()
        }
      );

      // Remove from Redis cache
      await redisManager.getClient().del(`user:${userId}`);

      // Track analytics
      await Analytics.create({
        eventType: 'user_logout',
        eventName: 'User Logout',
        eventCategory: 'user',
        userId,
        sessionId: req.sessionID || 'unknown',
        platform: 'web'
      });

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Delete Account
  async deleteAccount(req, res) {
    try {
      const userId = req.user.id;
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required to delete account'
        });
      }

      const user = await User.findById(userId).select('+password');
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify password
      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password'
        });
      }

      // Soft delete user
      user.isActive = false;
      user.isDeleted = true;
      user.deletedAt = new Date();
      await user.save();

      // Soft delete tier data
      await TierData.findOneAndUpdate(
        { userId },
        {
          isActive: false,
          isDeleted: true,
          deletedAt: new Date()
        }
      );

      // Remove from Redis cache
      await redisManager.getClient().del(`user:${userId}`);

      res.json({
        success: true,
        message: 'Account deleted successfully'
      });

    } catch (error) {
      logger.error('Delete account error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Get User Stats
  async getUserStats(req, res) {
    try {
      const userId = req.user.id;
      const { period = '30d' } = req.query;

      const stats = await Analytics.getUserStats(userId, period);

      res.json({
        success: true,
        data: {
          stats: stats[0] || {
            totalEvents: 0,
            eventTypes: [],
            platforms: [],
            totalDuration: 0,
            averageResponseTime: 0,
            errorCount: 0,
            securityEvents: 0
          }
        }
      });

    } catch (error) {
      logger.error('Get user stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

module.exports = new UserController();