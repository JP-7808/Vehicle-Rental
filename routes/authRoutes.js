import express from 'express';
import {
  register,
  login,
  logout,
  verifyEmail,
  resendOtp,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
  uploadProfileImage,
  deleteProfileImage,
  refreshToken,
  getCurrentUser
} from '../controllers/authController.js';
import { 
  authMiddleware, 
  requireAdmin, 
  requireVendor, 
  requireCustomer,
  requireVendorOrAdmin,
  requireCustomerOrAdmin 
} from '../middleware/authMiddleware.js';
import { uploadMiddleware } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh-token', refreshToken);

// Protected routes
router.post('/logout', authMiddleware, logout);
router.get('/me', authMiddleware, getCurrentUser);
router.get('/profile', authMiddleware, getProfile);
router.put('/profile', authMiddleware, updateProfile);
router.patch('/change-password', authMiddleware, changePassword);

// Profile image routes
router.post(
  '/upload-profile-image', 
  authMiddleware, 
  uploadMiddleware.single('avatar'), 
  uploadProfileImage
);
router.delete('/delete-profile-image', authMiddleware, deleteProfileImage);

// Admin only routes
router.get('/admin/users', authMiddleware, requireAdmin, (req, res) => {
  // Admin user management routes would go here
  res.json({ message: 'Admin access granted' });
});

// Vendor only routes
router.get('/vendor/dashboard', authMiddleware, requireVendor, (req, res) => {
  res.json({ message: 'Vendor dashboard access' });
});

// Customer only routes
router.get('/customer/dashboard', authMiddleware, requireCustomer, (req, res) => {
  res.json({ message: 'Customer dashboard access' });
});

export default router;