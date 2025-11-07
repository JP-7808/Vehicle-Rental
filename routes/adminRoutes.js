import express from 'express';
import {
  // Dashboard
  getAdminDashboard,
  
  // User Management
  getAllUsers,
  getUserById,
  updateUserStatus,
  updateUserRole,
  
  // Vendor Management
  getAllVendors,
  getVendorById,
  updateVendorStatus,
  verifyVendorKYC,
  rejectVendorKYC,
  
  // Vehicle Management
  getAllVehicles,
  getVehicleById,
  updateVehicleStatus,
  
  // Booking Management
  getAllBookings,
  getBookingById,
  updateBookingStatus,
  cancelBookingAdmin,
  
  // Payment Management
  getAllPayments,
  getPaymentById,
  initiateAdminRefund,
  
  // Analytics & Reports
  getSystemAnalytics,
  generateFinancialReport,
  getUserGrowthReport,
  getBookingTrends,
  
  // System Settings
  updateSystemSettings,
  getSystemSettings,
  
  // Promo Code Management
  createPromoCode,
  getAllPromoCodes,
  updatePromoCode,
  deletePromoCode
} from '../controllers/adminController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authMiddleware, requireAdmin);

// Dashboard
router.get('/dashboard', getAdminDashboard);

// User Management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.patch('/users/:id/status', updateUserStatus);
router.patch('/users/:id/role', updateUserRole);

// Vendor Management
router.get('/vendors', getAllVendors);
router.get('/vendors/:id', getVendorById);
router.patch('/vendors/:id/status', updateVendorStatus);
router.patch('/vendors/:id/kyc/verify', verifyVendorKYC);
router.patch('/vendors/:id/kyc/reject', rejectVendorKYC);

// Vehicle Management
router.get('/vehicles', getAllVehicles);
router.get('/vehicles/:id', getVehicleById);
router.patch('/vehicles/:id/status', updateVehicleStatus);

// Booking Management
router.get('/bookings', getAllBookings);
router.get('/bookings/:id', getBookingById);
router.patch('/bookings/:id/status', updateBookingStatus);
router.post('/bookings/:id/cancel', cancelBookingAdmin);

// Payment Management
router.get('/payments', getAllPayments);
router.get('/payments/:id', getPaymentById);
router.post('/payments/:id/refund', initiateAdminRefund);

// Analytics & Reports
router.get('/analytics', getSystemAnalytics);
router.get('/reports/financial', generateFinancialReport);
router.get('/reports/user-growth', getUserGrowthReport);
router.get('/reports/booking-trends', getBookingTrends);

// System Settings
router.get('/settings', getSystemSettings);
router.put('/settings', updateSystemSettings);

// Promo Code Management
router.post('/promo-codes', createPromoCode);
router.get('/promo-codes', getAllPromoCodes);
router.put('/promo-codes/:id', updatePromoCode);
router.delete('/promo-codes/:id', deletePromoCode);

export default router;