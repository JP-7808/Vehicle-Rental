import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateAndSendOtp, verifyOtp } from '../services/otpService.js';
import { sendEmail } from '../services/emailService.js';
import { cloudinaryUpload, cloudinaryDelete, extractPublicId } from '../config/cloudinary.js';

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const refreshCookieOptions = {
  ...cookieOptions,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// Helper functions
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET + '_refresh', {
    expiresIn: '30d',
  });
};

const setTokenCookies = (res, token, refreshToken) => {
  res.cookie('accessToken', token, cookieOptions);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
};

const clearTokenCookies = (res) => {
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', refreshCookieOptions);
};

const getUserResponse = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  avatar: user.avatar,
  isEmailVerified: user.emailVerification?.isVerified || false,
  kycStatus: user.kycStatus,
  vendorProfile: user.vendorProfile,
  address: user.address,
  preferences: user.preferences
});

// Register controller
export const register = async (req, res) => {
  try {
    const { name, email, phone, password, role = 'customer' } = req.body;

    // Validate role for vendor registration
    // if (role === 'vendor' && !req.body.companyName) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Company name is required for vendor registration'
    //   });
    // }

    const existingUser = await User.findOne({
      $or: [{ email }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = new User({
      name,
      email,
      phone,
      passwordHash,
      role,
      registeredAt: new Date()
    });

    await user.save();

    // Generate and send OTP
    await generateAndSendOtp(email, name);

    // Generate tokens but don't set cookies until email verification
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
      data: {
        user: getUserResponse(user),
        token,
        refreshToken,
        requiresVerification: true
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Registration failed'
    });
  }
};


// Login controller with cookies - UPDATED FOR BOTH MODEL VERSIONS
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Use lean() to get plain JS object, avoiding schema validation issues on load
    const user = await User.findOne({ email }).lean().populate('vendorProfile');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check email verification for critical operations
    if (!user.emailVerification?.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
        requiresVerification: true
      });
    }

    // Update last login using updateOne to avoid full document save and validation
    await User.updateOne({ _id: user._id }, {
      lastLoginAt: new Date(),
      lastSeen: new Date()
    });

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Set cookies
    setTokenCookies(res, token, refreshToken);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: getUserResponse(user),
        token, // Also return in response for mobile apps
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// Verify email with OTP
export const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    const result = await verifyOtp(email, otp);

    if (result.success) {
      const user = await User.findOne({ email }).populate('vendorProfile');
      const token = generateToken(user._id);
      const refreshToken = generateRefreshToken(user._id);

      // Set cookies after email verification
      setTokenCookies(res, token, refreshToken);

      res.json({
        success: true,
        message: result.message,
        data: {
          user: getUserResponse(user),
          token,
          refreshToken
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Email verification failed'
    });
  }
};

// Resend OTP
export const resendOtp = async (req, res) => {
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
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const result = await generateAndSendOtp(email, user.name);

    res.json({
      success: true,
      message: result.message,
      cooldown: result.cooldown
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to resend OTP'
    });
  }
};

// Logout controller with cookie clearing
export const logout = async (req, res) => {
  try {
    // Update last seen before logout
    await User.findByIdAndUpdate(req.user._id, {
      lastSeen: new Date()
    });

    // Clear cookies
    clearTokenCookies(res);

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    clearTokenCookies(res); // Clear cookies even on error
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

// Get user profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-passwordHash')
      .populate('vendorProfile');

    res.json({
      success: true,
      data: { user: getUserResponse(user) }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
};

// Update profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, address, preferences } = req.body;
    const updates = {};

    if (name) updates.name = name;
    if (phone) {
      // Check if phone is already taken by another user
      const existingUser = await User.findOne({ 
        phone, 
        _id: { $ne: req.user._id } 
      });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }
      updates.phone = phone;
    }
    if (address) updates.address = address;
    if (preferences) updates.preferences = { ...req.user.preferences, ...preferences };

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-passwordHash').populate('vendorProfile');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: getUserResponse(user) }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// Upload profile image
export const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const user = await User.findById(req.user._id);
    
    // Delete old avatar if exists
    if (user.avatar) {
      await deleteCloudinaryImage(user.avatar);
    }

    // Upload new avatar
    const result = await cloudinaryUpload(req.file, 'profile');
    
    user.avatar = result.secure_url;
    await user.save();

    res.json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        avatar: result.secure_url
      }
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile image'
    });
  }
};

// Delete profile image
export const deleteProfileImage = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user.avatar) {
      return res.status(400).json({
        success: false,
        message: 'No profile image to delete'
      });
    }

    // Delete from Cloudinary
    await deleteCloudinaryImage(user.avatar);
    
    // Remove from user document
    user.avatar = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Profile image deleted successfully'
    });
  } catch (error) {
    console.error('Delete profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile image'
    });
  }
};

// Helper function to delete Cloudinary image
const deleteCloudinaryImage = async (imageUrl) => {
  try {
    const publicId = extractPublicId(imageUrl);
    if (publicId) {
      await cloudinaryDelete(publicId);
    }
  } catch (deleteError) {
    console.error('Error deleting Cloudinary image:', deleteError);
    throw new Error('Failed to delete image from storage');
  }
};

// Change password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.user._id);
    
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot be the same as current password'
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

// Forgot password
export const forgotPassword = async (req, res) => {
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
      // Don't reveal whether email exists or not
      return res.json({
        success: true,
        message: 'If the email exists, a reset link has been sent'
      });
    }

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'password_reset' },
      process.env.JWT_RESET_SECRET,
      { expiresIn: process.env.JWT_RESET_EXPIRES_IN }
    );

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await sendEmail(email, 'passwordReset', { 
      resetUrl, 
      name: user.name 
    });

    res.json({
      success: true,
      message: 'If the email exists, a reset link has been sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process forgot password request'
    });
  }
};

// Reset password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_RESET_SECRET);
    
    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({
        success: false,
        message: 'Invalid reset token'
      });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reset token'
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

// Refresh token
export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET + '_refresh');
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Generate new tokens
    const newToken = generateToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    // Set new cookies
    setTokenCookies(res, newToken, newRefreshToken);

    res.json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    clearTokenCookies(res);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};

// Get current user
export const getCurrentUser = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: getUserResponse(req.user)
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get current user'
    });
  }
};
