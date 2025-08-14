const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nearchat';
    
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 100, // Maximum number of connections in the pool
      minPoolSize: 10,  // Minimum number of connections in the pool
      serverSelectionTimeoutMS: 5000, // Timeout for server selection
      socketTimeoutMS: 45000, // Socket timeout
      bufferMaxEntries: 0, // Disable mongoose buffering
      bufferCommands: false, // Disable mongoose buffering
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      family: 4, // Use IPv4, skip trying IPv6
      retryWrites: true,
      w: 'majority',
      readPreference: 'secondaryPreferred', // Read from secondary for better performance
      readConcern: { level: 'majority' },
      writeConcern: { w: 'majority', j: true }
    };

    const conn = await mongoose.connect(mongoURI, options);
    
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    
    // Create geospatial indexes for optimal location-based queries
    await createGeospatialIndexes();
    
    // Monitor database connection
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
};

const createGeospatialIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    
    // User collection - 2dsphere index for location-based queries
    await db.collection('users').createIndex(
      { location: '2dsphere' },
      { 
        background: true,
        name: 'location_2dsphere',
        expireAfterSeconds: 0
      }
    );

    // User collection - compound index for nearby search optimization
    await db.collection('users').createIndex(
      { 
        'location.coordinates': '2dsphere',
        isOnline: 1,
        lastSeen: -1
      },
      { 
        background: true,
        name: 'location_online_status',
        expireAfterSeconds: 0
      }
    );

    // Story collection - 2dsphere index for location-based stories
    await db.collection('stories').createIndex(
      { location: '2dsphere' },
      { 
        background: true,
        name: 'story_location_2dsphere',
        expireAfterSeconds: 0
      }
    );

    // Story collection - TTL index for auto-expiry (24 hours)
    await db.collection('stories').createIndex(
      { createdAt: 1 },
      { 
        background: true,
        name: 'story_ttl',
        expireAfterSeconds: 86400 // 24 hours
      }
    );

    // Story collection - compound index for location + time
    await db.collection('stories').createIndex(
      { 
        location: '2dsphere',
        createdAt: -1,
        userId: 1
      },
      { 
        background: true,
        name: 'story_location_time_user',
        expireAfterSeconds: 0
      }
    );

    // DailyStreak collection - compound index for user + date
    await db.collection('dailystreaks').createIndex(
      { 
        userId: 1,
        date: -1
      },
      { 
        background: true,
        name: 'streak_user_date',
        unique: true
      }
    );

    // Message collection - compound index for chat optimization
    await db.collection('messages').createIndex(
      { 
        chatId: 1,
        createdAt: -1
      },
      { 
        background: true,
        name: 'message_chat_time'
      }
    );

    // User collection - text search index
    await db.collection('users').createIndex(
      { 
        username: 'text',
        displayName: 'text',
        bio: 'text'
      },
      { 
        background: true,
        name: 'user_text_search',
        weights: {
          username: 10,
          displayName: 5,
          bio: 1
        }
      }
    );

    // User collection - email index for OAuth
    await db.collection('users').createIndex(
      { email: 1 },
      { 
        background: true,
        name: 'user_email',
        unique: true,
        sparse: true
      }
    );

    // User collection - Google ID index
    await db.collection('users').createIndex(
      { googleId: 1 },
      { 
        background: true,
        name: 'user_google_id',
        unique: true,
        sparse: true
      }
    );

    logger.info('Geospatial indexes created successfully');

  } catch (error) {
    logger.error('Error creating geospatial indexes:', error);
    // Don't exit process, indexes might already exist
  }
};

// Database health check
const checkDBHealth = async () => {
  try {
    const adminDb = mongoose.connection.db.admin();
    const result = await adminDb.ping();
    return result.ok === 1;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
};

// Get database statistics
const getDBStats = async () => {
  try {
    const stats = await mongoose.connection.db.stats();
    return {
      collections: stats.collections,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes,
      indexSize: stats.indexSize,
      avgObjSize: stats.avgObjSize,
      objects: stats.objects
    };
  } catch (error) {
    logger.error('Error getting database stats:', error);
    return null;
  }
};

module.exports = {
  connectDB,
  checkDBHealth,
  getDBStats,
  createGeospatialIndexes
};