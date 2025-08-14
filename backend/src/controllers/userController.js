const User = require('../models/User');
const DailyStreak = require('../models/DailyStreak');
const logger = require('../utils/logger');
const { calculateDistance } = require('../utils/locationUtils');

// Get nearby users with distance-based color coding
const getNearbyUsers = async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 50000, tier = 'all' } = req.query;
    const userId = req.user.id;

    // Validate coordinates
    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Longitude and latitude are required'
      });
    }

    // Parse coordinates
    const userLng = parseFloat(longitude);
    const userLat = parseFloat(latitude);
    const distance = parseFloat(maxDistance);

    // Validate coordinate ranges
    if (userLng < -180 || userLng > 180 || userLat < -90 || userLat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Get current user
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user's location
    await currentUser.updateLocation(userLng, userLat);

    // Find nearby users based on tier
    let searchDistance;
    switch (tier) {
      case 'near': // 1m - 3km
        searchDistance = 3000;
        break;
      case 'medium': // 3km - 10km
        searchDistance = 10000;
        break;
      case 'far': // 10km - 80km
        searchDistance = 80000;
        break;
      case 'very_far': // 80km - 1000km
        searchDistance = 1000000;
        break;
      default: // all tiers
        searchDistance = distance;
    }

    // Query nearby users
    const nearbyUsers = await User.findNearbyUsers(userId, userLng, userLat, searchDistance);

    // Calculate distances and apply color coding
    const usersWithDistance = nearbyUsers.map(user => {
      const distanceInMeters = calculateDistance(
        userLat, userLng,
        user.location.coordinates[1], user.location.coordinates[0]
      );

      // Color coding based on distance
      let colorCode, distanceRange;
      if (distanceInMeters <= 3000) {
        colorCode = 'green';
        distanceRange = 'near';
      } else if (distanceInMeters <= 10000) {
        colorCode = 'blue';
        distanceRange = 'medium';
      } else if (distanceInMeters <= 80000) {
        colorCode = 'orange';
        distanceRange = 'far';
      } else {
        colorCode = 'gray';
        distanceRange = 'very_far';
      }

      // Filter by tier if specified
      if (tier !== 'all' && distanceRange !== tier) {
        return null;
      }

      return {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        currentStreak: user.currentStreak,
        streakReward: user.streakReward,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        distance: Math.round(distanceInMeters),
        distanceInKm: (distanceInMeters / 1000).toFixed(1),
        colorCode,
        distanceRange,
        isFriend: currentUser.isFriend(user._id),
        mutualConnections: calculateMutualConnections(currentUser, user)
      };
    }).filter(user => user !== null);

    // Sort by distance
    usersWithDistance.sort((a, b) => a.distance - b.distance);

    // Get distance tier counts
    const tierCounts = {
      near: usersWithDistance.filter(u => u.distanceRange === 'near').length,
      medium: usersWithDistance.filter(u => u.distanceRange === 'medium').length,
      far: usersWithDistance.filter(u => u.distanceRange === 'far').length,
      very_far: usersWithDistance.filter(u => u.distanceRange === 'very_far').length
    };

    res.json({
      success: true,
      data: {
        users: usersWithDistance,
        tierCounts,
        totalUsers: usersWithDistance.length,
        userLocation: {
          longitude: userLng,
          latitude: userLat
        }
      }
    });

  } catch (error) {
    logger.error('Error getting nearby users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby users'
    });
  }
};

// Search users with 4-tier distance filtering
const searchUsers = async (req, res) => {
  try {
    const { query, longitude, latitude, tier = 'all', limit = 20 } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    // Get users by text search
    const users = await User.searchUsers(query.trim(), userId, parseInt(limit) * 2);

    // Filter and calculate distances if coordinates provided
    let filteredUsers = users;
    if (longitude && latitude) {
      const userLng = parseFloat(longitude);
      const userLat = parseFloat(latitude);

      filteredUsers = users.map(user => {
        if (!user.location || !user.location.coordinates) {
          return { ...user.toObject(), distance: null, colorCode: 'gray' };
        }

        const distanceInMeters = calculateDistance(
          userLat, userLng,
          user.location.coordinates[1], user.location.coordinates[0]
        );

        // Color coding
        let colorCode, distanceRange;
        if (distanceInMeters <= 3000) {
          colorCode = 'green';
          distanceRange = 'near';
        } else if (distanceInMeters <= 10000) {
          colorCode = 'blue';
          distanceRange = 'medium';
        } else if (distanceInMeters <= 80000) {
          colorCode = 'orange';
          distanceRange = 'far';
        } else {
          colorCode = 'gray';
          distanceRange = 'very_far';
        }

        return {
          ...user.toObject(),
          distance: Math.round(distanceInMeters),
          distanceInKm: (distanceInMeters / 1000).toFixed(1),
          colorCode,
          distanceRange
        };
      });

      // Filter by tier if specified
      if (tier !== 'all') {
        filteredUsers = filteredUsers.filter(user => user.distanceRange === tier);
      }

      // Sort by distance
      filteredUsers.sort((a, b) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
    }

    // Limit results
    filteredUsers = filteredUsers.slice(0, parseInt(limit));

    res.json({
      success: true,
      data: {
        users: filteredUsers,
        totalFound: filteredUsers.length,
        query: query.trim()
      }
    });

  } catch (error) {
    logger.error('Error searching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users'
    });
  }
};

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    const user = await User.findById(userId)
      .select('-email -googleId -blockedUsers -privacySettings');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is blocked
    if (user.isBlocked(currentUserId)) {
      return res.status(403).json({
        success: false,
        message: 'Cannot view this profile'
      });
    }

    // Get current user for relationship info
    const currentUser = await User.findById(currentUserId);
    const isFriend = currentUser.isFriend(userId);
    const isBlocked = currentUser.isBlocked(userId);

    // Get user's streak information
    const currentStreak = await DailyStreak.getCurrentStreak(userId);
    const longestStreak = await DailyStreak.getLongestStreak(userId);

    // Calculate distance if current user has location
    let distanceInfo = null;
    if (currentUser.location && currentUser.location.coordinates && 
        user.location && user.location.coordinates) {
      const distanceInMeters = calculateDistance(
        currentUser.location.coordinates[1], currentUser.location.coordinates[0],
        user.location.coordinates[1], user.location.coordinates[0]
      );

      let colorCode;
      if (distanceInMeters <= 3000) {
        colorCode = 'green';
      } else if (distanceInMeters <= 10000) {
        colorCode = 'blue';
      } else if (distanceInMeters <= 80000) {
        colorCode = 'orange';
      } else {
        colorCode = 'gray';
      }

      distanceInfo = {
        distance: Math.round(distanceInMeters),
        distanceInKm: (distanceInMeters / 1000).toFixed(1),
        colorCode
      };
    }

    // Increment profile views
    await user.incrementStats('profileViews');

    const profileData = {
      _id: user._id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      profilePicture: user.profilePicture,
      currentStreak,
      longestStreak,
      streakReward: user.streakReward,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      stats: user.stats,
      achievements: user.achievements,
      distanceInfo,
      relationship: {
        isFriend,
        isBlocked,
        canSendMessage: user.privacySettings.allowMessages && !isBlocked,
        canSendFriendRequest: user.privacySettings.allowFriendRequests && !isBlocked
      },
      createdAt: user.createdAt
    };

    res.json({
      success: true,
      data: profileData
    });

  } catch (error) {
    logger.error('Error getting user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { displayName, bio, profilePicture } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (displayName) {
      user.displayName = displayName;
    }
    if (bio !== undefined) {
      user.bio = bio;
    }
    if (profilePicture) {
      user.profilePicture = profilePicture;
    }

    await user.save();

    res.json({
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        profilePicture: user.profilePicture
      },
      message: 'Profile updated successfully'
    });

  } catch (error) {
    logger.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// Update user location
const updateLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { longitude, latitude, privacyLevel = 'friends' } = req.body;

    // Validate coordinates
    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Longitude and latitude are required'
      });
    }

    const userLng = parseFloat(longitude);
    const userLat = parseFloat(latitude);

    if (userLng < -180 || userLng > 180 || userLat < -90 || userLat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.updateLocation(userLng, userLat, privacyLevel);

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        location: {
          coordinates: user.location.coordinates,
          lastUpdated: user.location.lastUpdated,
          privacyLevel: user.location.privacyLevel
        }
      }
    });

  } catch (error) {
    logger.error('Error updating location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
};

// Get online users
const getOnlineUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50 } = req.query;

    const onlineUsers = await User.getOnlineUsers();
    const limitedUsers = onlineUsers.slice(0, parseInt(limit));

    // Get current user for relationship info
    const currentUser = await User.findById(userId);

    const usersWithInfo = limitedUsers.map(user => ({
      _id: user._id,
      username: user.username,
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      lastSeen: user.lastSeen,
      currentStreak: user.currentStreak,
      streakReward: user.streakReward,
      isFriend: currentUser.isFriend(user._id)
    }));

    res.json({
      success: true,
      data: {
        users: usersWithInfo,
        totalOnline: usersWithInfo.length
      }
    });

  } catch (error) {
    logger.error('Error getting online users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get online users'
    });
  }
};

// Get user statistics
const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get streak statistics
    const currentStreak = await DailyStreak.getCurrentStreak(userId);
    const longestStreak = await DailyStreak.getLongestStreak(userId);
    const streakStats = await DailyStreak.getStreakStats(userId, 7);

    const stats = {
      profile: {
        totalDaysActive: user.totalDaysActive,
        friendsCount: user.friendsCount,
        pendingRequestsCount: user.pendingRequestsCount
      },
      activity: {
        messagesSent: user.stats.messagesSent,
        messagesReceived: user.stats.messagesReceived,
        storiesPosted: user.stats.storiesPosted,
        profileViews: user.stats.profileViews
      },
      streaks: {
        currentStreak,
        longestStreak,
        streakReward: user.streakReward,
        weeklyStats: streakStats
      },
      achievements: user.achievements || []
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting user stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user statistics'
    });
  }
};

// Helper function to calculate mutual connections
const calculateMutualConnections = (user1, user2) => {
  if (!user1.friends || !user2.friends) return 0;
  
  const user1FriendIds = user1.friends
    .filter(friend => friend.status === 'accepted')
    .map(friend => friend.userId.toString());
  
  const user2FriendIds = user2.friends
    .filter(friend => friend.status === 'accepted')
    .map(friend => friend.userId.toString());
  
  return user1FriendIds.filter(id => user2FriendIds.includes(id)).length;
};

module.exports = {
  getNearbyUsers,
  searchUsers,
  getUserProfile,
  updateProfile,
  updateLocation,
  getOnlineUsers,
  getUserStats
};