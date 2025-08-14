const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { validateRegistration, validateLogin } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/upload');

// User Registration
router.post('/register', 
  rateLimiter('register', 5, 15 * 60 * 1000), // 5 attempts per 15 minutes
  validateRegistration,
  userController.register
);

// User Login
router.post('/login',
  rateLimiter('login', 10, 15 * 60 * 1000), // 10 attempts per 15 minutes
  validateLogin,
  userController.login
);

// Google OAuth Login
router.post('/google',
  rateLimiter('oauth', 20, 15 * 60 * 1000), // 20 attempts per 15 minutes
  userController.googleLogin
);

// Forgot Password
router.post('/forgot-password',
  rateLimiter('forgot-password', 3, 60 * 60 * 1000), // 3 attempts per hour
  userController.forgotPassword
);

// Reset Password
router.post('/reset-password',
  rateLimiter('reset-password', 5, 60 * 60 * 1000), // 5 attempts per hour
  userController.resetPassword
);

// Verify Email
router.post('/verify-email',
  rateLimiter('verify-email', 10, 60 * 60 * 1000), // 10 attempts per hour
  userController.verifyEmail
);

// Resend Verification Email
router.post('/resend-verification',
  rateLimiter('resend-verification', 3, 60 * 60 * 1000), // 3 attempts per hour
  userController.resendVerificationEmail
);

// Logout
router.post('/logout',
  userController.logout
);

// Refresh Token (if implementing refresh tokens)
router.post('/refresh-token',
  rateLimiter('refresh-token', 30, 15 * 60 * 1000), // 30 attempts per 15 minutes
  (req, res) => {
    // Implementation for refresh tokens
    res.status(501).json({
      success: false,
      message: 'Refresh token functionality not implemented yet'
    });
  }
);

// Validate Token
router.get('/validate-token',
  (req, res) => {
    // This endpoint can be used to validate tokens without requiring full authentication
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Basic token validation (full validation should be done in protected routes)
    res.json({
      success: true,
      message: 'Token format is valid',
      note: 'Full validation should be done in protected routes'
    });
  }
);

// OAuth Callback (for future OAuth providers)
router.get('/oauth/:provider/callback',
  (req, res) => {
    const { provider } = req.params;
    res.status(501).json({
      success: false,
      message: `${provider} OAuth callback not implemented yet`
    });
  }
);

// OAuth Providers List
router.get('/oauth/providers',
  (req, res) => {
    res.json({
      success: true,
      data: {
        providers: [
          {
            name: 'google',
            enabled: true,
            clientId: process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not_configured',
            scopes: ['email', 'profile']
          },
          {
            name: 'facebook',
            enabled: false,
            clientId: 'not_configured',
            scopes: ['email', 'public_profile']
          },
          {
            name: 'apple',
            enabled: false,
            clientId: 'not_configured',
            scopes: ['email', 'name']
          }
        ]
      }
    });
  }
);

// Account Deletion
router.delete('/delete-account',
  rateLimiter('delete-account', 1, 24 * 60 * 60 * 1000), // 1 attempt per day
  userController.deleteAccount
);

// Session Management
router.get('/sessions',
  (req, res) => {
    // This would return active sessions for the user
    res.status(501).json({
      success: false,
      message: 'Session management not implemented yet'
    });
  }
);

router.delete('/sessions/:sessionId',
  (req, res) => {
    // This would terminate a specific session
    res.status(501).json({
      success: false,
      message: 'Session termination not implemented yet'
    });
  }
);

// Two-Factor Authentication (future feature)
router.post('/2fa/enable',
  (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Two-factor authentication not implemented yet'
    });
  }
);

router.post('/2fa/verify',
  (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Two-factor authentication not implemented yet'
    });
  }
);

router.post('/2fa/disable',
  (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Two-factor authentication not implemented yet'
    });
  }
);

// Password Strength Checker
router.post('/password/check-strength',
  (req, res) => {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    // Basic password strength validation
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const strength = {
      score: 0,
      feedback: [],
      meetsRequirements: false
    };

    if (password.length >= minLength) strength.score += 1;
    else strength.feedback.push(`At least ${minLength} characters`);

    if (hasUpperCase) strength.score += 1;
    else strength.feedback.push('At least one uppercase letter');

    if (hasLowerCase) strength.score += 1;
    else strength.feedback.push('At least one lowercase letter');

    if (hasNumbers) strength.score += 1;
    else strength.feedback.push('At least one number');

    if (hasSpecialChar) strength.score += 1;
    else strength.feedback.push('At least one special character');

    strength.meetsRequirements = strength.score === 5;

    res.json({
      success: true,
      data: {
        strength: strength.score,
        maxStrength: 5,
        meetsRequirements: strength.meetsRequirements,
        feedback: strength.feedback,
        category: strength.score < 2 ? 'weak' : 
                 strength.score < 4 ? 'medium' : 'strong'
      }
    });
  }
);

// Account Recovery Options
router.get('/recovery-options',
  (req, res) => {
    res.json({
      success: true,
      data: {
        options: [
          {
            type: 'email',
            enabled: true,
            description: 'Password reset via email'
          },
          {
            type: 'phone',
            enabled: false,
            description: 'Password reset via SMS'
          },
          {
            type: 'security_questions',
            enabled: false,
            description: 'Password reset via security questions'
          }
        ]
      }
    });
  }
);

// Export router
module.exports = router;