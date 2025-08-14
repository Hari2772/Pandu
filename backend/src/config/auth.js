const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');

// Google OAuth client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

// Hardcoded admin credentials
const ADMIN_EMAIL = 'ghari2772@gmail.com';
const ADMIN_PASSWORD = 'hari143p';

// Generate JWT token
const generateToken = (payload) => {
  try {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'nearchat',
      audience: 'nearchat-users'
    });
  } catch (error) {
    logger.error('Error generating JWT token:', error);
    throw new Error('Token generation failed');
  }
};

// Generate refresh token
const generateRefreshToken = (payload) => {
  try {
    return jwt.sign(payload, JWT_REFRESH_SECRET, {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      issuer: 'nearchat',
      audience: 'nearchat-refresh'
    });
  } catch (error) {
    logger.error('Error generating refresh token:', error);
    throw new Error('Refresh token generation failed');
  }
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'nearchat',
      audience: 'nearchat-users'
    });
  } catch (error) {
    logger.error('Error verifying JWT token:', error);
    throw new Error('Invalid token');
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET, {
      issuer: 'nearchat',
      audience: 'nearchat-refresh'
    });
  } catch (error) {
    logger.error('Error verifying refresh token:', error);
    throw new Error('Invalid refresh token');
  }
};

// Hash password
const hashPassword = async (password) => {
  try {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    logger.error('Error hashing password:', error);
    throw new Error('Password hashing failed');
  }
};

// Compare password
const comparePassword = async (password, hashedPassword) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    logger.error('Error comparing password:', error);
    throw new Error('Password comparison failed');
  }
};

// Verify Google OAuth token
const verifyGoogleToken = async (idToken) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified
    };
  } catch (error) {
    logger.error('Error verifying Google token:', error);
    throw new Error('Invalid Google token');
  }
};

// Admin authentication
const authenticateAdmin = async (email, password) => {
  try {
    if (email !== ADMIN_EMAIL) {
      throw new Error('Invalid admin credentials');
    }

    // For production, you should hash the admin password and compare
    // For now, using direct comparison as specified in requirements
    if (password !== ADMIN_PASSWORD) {
      throw new Error('Invalid admin credentials');
    }

    return {
      id: 'admin',
      email: ADMIN_EMAIL,
      role: 'admin',
      isAdmin: true
    };
  } catch (error) {
    logger.error('Admin authentication failed:', error);
    throw error;
  }
};

// Generate admin token
const generateAdminToken = (adminData) => {
  try {
    return jwt.sign(adminData, JWT_SECRET, {
      expiresIn: '24h', // Longer expiry for admin
      issuer: 'nearchat',
      audience: 'nearchat-admin'
    });
  } catch (error) {
    logger.error('Error generating admin token:', error);
    throw new Error('Admin token generation failed');
  }
};

// Check if user is admin
const isAdmin = (user) => {
  return user && (user.email === ADMIN_EMAIL || user.role === 'admin' || user.isAdmin);
};

// Token refresh
const refreshToken = async (refreshToken) => {
  try {
    const decoded = verifyRefreshToken(refreshToken);
    
    // Generate new access token
    const newToken = generateToken({
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    });

    // Generate new refresh token
    const newRefreshToken = generateRefreshToken({
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    });

    return {
      token: newToken,
      refreshToken: newRefreshToken,
      expiresIn: JWT_EXPIRES_IN
    };
  } catch (error) {
    logger.error('Token refresh failed:', error);
    throw new Error('Token refresh failed');
  }
};

// Decode token without verification (for logging purposes)
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    logger.error('Error decoding token:', error);
    return null;
  }
};

// Get token expiration time
const getTokenExpiration = (token) => {
  try {
    const decoded = jwt.decode(token);
    return decoded ? new Date(decoded.exp * 1000) : null;
  } catch (error) {
    logger.error('Error getting token expiration:', error);
    return null;
  }
};

// Check if token is expired
const isTokenExpired = (token) => {
  try {
    const expiration = getTokenExpiration(token);
    return expiration ? expiration < new Date() : true;
  } catch (error) {
    logger.error('Error checking token expiration:', error);
    return true;
  }
};

// Generate password reset token
const generatePasswordResetToken = (email) => {
  try {
    return jwt.sign(
      { email, type: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  } catch (error) {
    logger.error('Error generating password reset token:', error);
    throw new Error('Password reset token generation failed');
  }
};

// Verify password reset token
const verifyPasswordResetToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'password_reset') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    logger.error('Error verifying password reset token:', error);
    throw new Error('Invalid password reset token');
  }
};

// Generate email verification token
const generateEmailVerificationToken = (email) => {
  try {
    return jwt.sign(
      { email, type: 'email_verification' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
  } catch (error) {
    logger.error('Error generating email verification token:', error);
    throw new Error('Email verification token generation failed');
  }
};

// Verify email verification token
const verifyEmailVerificationToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'email_verification') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    logger.error('Error verifying email verification token:', error);
    throw new Error('Invalid email verification token');
  }
};

// Generate temporary access token (for WebRTC signaling)
const generateTemporaryToken = (userId, purpose) => {
  try {
    return jwt.sign(
      { id: userId, purpose, type: 'temporary' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
  } catch (error) {
    logger.error('Error generating temporary token:', error);
    throw new Error('Temporary token generation failed');
  }
};

// Verify temporary token
const verifyTemporaryToken = (token, purpose) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'temporary' || decoded.purpose !== purpose) {
      throw new Error('Invalid temporary token');
    }
    return decoded;
  } catch (error) {
    logger.error('Error verifying temporary token:', error);
    throw new Error('Invalid temporary token');
  }
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  hashPassword,
  comparePassword,
  verifyGoogleToken,
  authenticateAdmin,
  generateAdminToken,
  isAdmin,
  refreshToken,
  decodeToken,
  getTokenExpiration,
  isTokenExpired,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  generateEmailVerificationToken,
  verifyEmailVerificationToken,
  generateTemporaryToken,
  verifyTemporaryToken,
  ADMIN_EMAIL,
  JWT_SECRET,
  JWT_REFRESH_SECRET
};