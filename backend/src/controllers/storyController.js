const Story = require('../models/Story');
const User = require('../models/User');
const logger = require('../utils/logger');
const { calculateDistance } = require('../utils/locationUtils');

// Create a new story
const createStory = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      type,
      content,
      longitude,
      latitude,
      address,
      placeName,
      visibility = 'nearby',
      visibilityRadius = 50000,
      settings,
      tags,
      category = 'general'
    } = req.body;

    // Validate required fields
    if (!type || !longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Type, longitude, and latitude are required'
      });
    }

    // Validate coordinates
    const userLng = parseFloat(longitude);
    const userLat = parseFloat(latitude);

    if (userLng < -180 || userLng > 180 || userLat < -90 || userLat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Validate content based on type
    if (type === 'text' && (!content.text || content.text.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Text content is required for text stories'
      });
    }

    if ((type === 'image' || type === 'video' || type === 'audio') && !content.mediaUrl) {
      return res.status(400).json({
        success: false,
        message: 'Media URL is required for media stories'
      });
    }

    // Create story
    const story = new Story({
      userId,
      type,
      content,
      location: {
        type: 'Point',
        coordinates: [userLng, userLat],
        address,
        placeName
      },
      visibility,
      visibilityRadius,
      settings: {
        allowReplies: settings?.allowReplies !== false,
        allowReactions: settings?.allowReactions !== false,
        allowScreenshots: settings?.allowScreenshots || false,
        allowSharing: settings?.allowSharing !== false
      },
      tags: tags || [],
      category,
      metadata: {
        deviceInfo: req.headers['user-agent'],
        appVersion: req.headers['x-app-version'],
        locationAccuracy: req.body.locationAccuracy
      }
    });

    await story.save();

    // Increment user's story count
    await User.findByIdAndUpdate(userId, {
      $inc: { 'stats.storiesPosted': 1 }
    });

    // Populate user info
    await story.populate('userId', 'username displayName profilePicture');

    res.status(201).json({
      success: true,
      data: story,
      message: 'Story created successfully'
    });

  } catch (error) {
    logger.error('Error creating story:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create story'
    });
  }
};

// Get nearby stories
const getNearbyStories = async (req, res) => {
  try {
    const userId = req.user.id;
    const { longitude, latitude, maxDistance = 50000, limit = 50 } = req.query;

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

    // Get nearby stories
    const stories = await Story.findNearbyStories(userLng, userLat, maxDistance, userId);

    // Calculate distances and add user info
    const storiesWithDistance = stories.map(story => {
      const distanceInMeters = calculateDistance(
        userLat, userLng,
        story.location.coordinates[1], story.location.coordinates[0]
      );

      return {
        ...story.toObject(),
        distance: Math.round(distanceInMeters),
        distanceInKm: (distanceInMeters / 1000).toFixed(1),
        timeUntilExpiry: story.timeUntilExpiry,
        isExpired: story.isExpired
      };
    });

    // Sort by creation time (newest first)
    storiesWithDistance.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Limit results
    const limitedStories = storiesWithDistance.slice(0, parseInt(limit));

    res.json({
      success: true,
      data: {
        stories: limitedStories,
        totalStories: limitedStories.length,
        userLocation: {
          longitude: userLng,
          latitude: userLat
        }
      }
    });

  } catch (error) {
    logger.error('Error getting nearby stories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby stories'
    });
  }
};

// Get user's stories
const getUserStories = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    const currentUserId = req.user.id;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if current user can view stories
    if (userId !== currentUserId) {
      const currentUser = await User.findById(currentUserId);
      if (currentUser.isBlocked(userId) || user.isBlocked(currentUserId)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot view stories'
        });
      }
    }

    const stories = await Story.findUserStories(userId, parseInt(limit));

    res.json({
      success: true,
      data: {
        stories,
        totalStories: stories.length,
        user: {
          _id: user._id,
          username: user.username,
          displayName: user.displayName,
          profilePicture: user.profilePicture
        }
      }
    });

  } catch (error) {
    logger.error('Error getting user stories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user stories'
    });
  }
};

// Get story by ID
const getStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    const story = await Story.findById(storyId)
      .populate('userId', 'username displayName profilePicture');

    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if story is expired
    if (story.isExpired) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    // Check if user can view the story
    const currentUser = await User.findById(userId);
    if (story.userId._id.toString() !== userId) {
      // Check if user is blocked
      if (currentUser.isBlocked(story.userId._id) || 
          story.userId.isBlocked(currentUser._id)) {
        return res.status(403).json({
          success: false,
          message: 'Cannot view this story'
        });
      }

      // Check visibility settings
      if (story.visibility === 'friends') {
        if (!currentUser.isFriend(story.userId._id)) {
          return res.status(403).json({
            success: false,
            message: 'Story is only visible to friends'
          });
        }
      }
    }

    // Add view if not the creator
    if (story.userId._id.toString() !== userId) {
      await story.addView(userId);
    }

    res.json({
      success: true,
      data: {
        ...story.toObject(),
        timeUntilExpiry: story.timeUntilExpiry,
        isExpired: story.isExpired
      }
    });

  } catch (error) {
    logger.error('Error getting story:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get story'
    });
  }
};

// React to a story
const reactToStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { reactionType } = req.body;
    const userId = req.user.id;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    if (story.isExpired) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    if (!story.settings.allowReactions) {
      return res.status(403).json({
        success: false,
        message: 'Reactions are not allowed for this story'
      });
    }

    await story.addReaction(userId, reactionType);

    res.json({
      success: true,
      message: 'Reaction added successfully',
      data: {
        reactions: story.engagement.reactions,
        totalReactions: story.totalReactions
      }
    });

  } catch (error) {
    logger.error('Error reacting to story:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to react to story'
    });
  }
};

// Reply to a story
const replyToStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Reply content is required'
      });
    }

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    if (story.isExpired) {
      return res.status(410).json({
        success: false,
        message: 'Story has expired'
      });
    }

    await story.addReply(userId, content.trim());

    res.json({
      success: true,
      message: 'Reply added successfully',
      data: {
        replies: story.replies,
        totalReplies: story.engagement.replies
      }
    });

  } catch (error) {
    logger.error('Error replying to story:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reply to story'
    });
  }
};

// Delete story
const deleteStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    // Check if user owns the story
    if (story.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete this story'
      });
    }

    story.status = 'deleted';
    await story.save();

    res.json({
      success: true,
      message: 'Story deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting story:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete story'
    });
  }
};

// Start live broadcast
const startLiveBroadcast = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title,
      description,
      streamUrl,
      longitude,
      latitude,
      address,
      placeName,
      isMonetized = false,
      adFrequency = 5
    } = req.body;

    // Validate required fields
    if (!title || !longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Title, longitude, and latitude are required'
      });
    }

    // Validate coordinates
    const userLng = parseFloat(longitude);
    const userLat = parseFloat(latitude);

    if (userLng < -180 || userLng > 180 || userLat < -90 || userLat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Create live broadcast story
    const story = new Story({
      userId,
      type: 'video',
      content: {
        mediaUrl: streamUrl,
        mediaType: 'video/mp4',
        text: description
      },
      location: {
        type: 'Point',
        coordinates: [userLng, userLat],
        address,
        placeName
      },
      visibility: 'nearby',
      visibilityRadius: 60000, // 60km for live broadcasts
      isLiveBroadcast: true,
      broadcastInfo: {
        title,
        description,
        streamUrl,
        isMonetized,
        adFrequency,
        startedAt: new Date()
      },
      category: 'live_broadcast',
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours for live broadcasts
    });

    await story.save();

    // Populate user info
    await story.populate('userId', 'username displayName profilePicture');

    res.status(201).json({
      success: true,
      data: story,
      message: 'Live broadcast started successfully'
    });

  } catch (error) {
    logger.error('Error starting live broadcast:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start live broadcast'
    });
  }
};

// End live broadcast
const endLiveBroadcast = async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.user.id;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    if (!story.isLiveBroadcast) {
      return res.status(400).json({
        success: false,
        message: 'This is not a live broadcast'
      });
    }

    if (story.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Cannot end this broadcast'
      });
    }

    await story.endLiveBroadcast();

    res.json({
      success: true,
      message: 'Live broadcast ended successfully'
    });

  } catch (error) {
    logger.error('Error ending live broadcast:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end live broadcast'
    });
  }
};

// Get live broadcasts
const getLiveBroadcasts = async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 60000 } = req.query;

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

    const broadcasts = await Story.findLiveBroadcasts(userLng, userLat, maxDistance);

    // Calculate distances
    const broadcastsWithDistance = broadcasts.map(broadcast => {
      const distanceInMeters = calculateDistance(
        userLat, userLng,
        broadcast.location.coordinates[1], broadcast.location.coordinates[0]
      );

      return {
        ...broadcast.toObject(),
        distance: Math.round(distanceInMeters),
        distanceInKm: (distanceInMeters / 1000).toFixed(1)
      };
    });

    res.json({
      success: true,
      data: {
        broadcasts: broadcastsWithDistance,
        totalBroadcasts: broadcastsWithDistance.length
      }
    });

  } catch (error) {
    logger.error('Error getting live broadcasts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get live broadcasts'
    });
  }
};

// Update broadcast viewer count
const updateViewerCount = async (req, res) => {
  try {
    const { storyId } = req.params;
    const { viewerCount } = req.body;
    const userId = req.user.id;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({
        success: false,
        message: 'Story not found'
      });
    }

    if (!story.isLiveBroadcast) {
      return res.status(400).json({
        success: false,
        message: 'This is not a live broadcast'
      });
    }

    if (story.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Cannot update this broadcast'
      });
    }

    await story.updateViewerCount(viewerCount);

    res.json({
      success: true,
      message: 'Viewer count updated successfully',
      data: {
        viewerCount: story.broadcastInfo.viewerCount
      }
    });

  } catch (error) {
    logger.error('Error updating viewer count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update viewer count'
    });
  }
};

// Get story statistics
const getStoryStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 7 } = req.query;

    const stats = await Story.getStoryStats(userId, parseInt(days));

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting story stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get story statistics'
    });
  }
};

module.exports = {
  createStory,
  getNearbyStories,
  getUserStories,
  getStory,
  reactToStory,
  replyToStory,
  deleteStory,
  startLiveBroadcast,
  endLiveBroadcast,
  getLiveBroadcasts,
  updateViewerCount,
  getStoryStats
};