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
  deletePromoCode,

  // Enhanced Dashboard
  getEnhancedDashboard,
  
  // Advanced Analytics
  getUserAnalytics,
  getVendorPerformance,
  getRevenueAnalytics,
  getBookingQualityMetrics,
  getRefundAnalytics,
  
  // System Management
  getSystemHealth,
  
  // Bulk Operations
  bulkUpdateUserStatus,
  bulkVerifyVendors,
  
  // Data Management
  exportData,
  getAuditLog,


  // User Management
  createUser,
  getUserDetails,
  updateUser,
  deleteUser,
  uploadUserAvatar,
  
  // Vehicle Management
  createVehicle,
  getVehicleDetails,
  updateVehicle,
  deleteVehicle,
  uploadVehicleImages,
  deleteVehicleImage,
  manageVehicleAvailability,
  transferVehicle,
  getVehiclesWithFilter

} from '../controllers/adminController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import { uploadMiddleware, handleCloudinaryUpload, handleMultipleCloudinaryUpload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authMiddleware, requireAdmin);


// ==============================================
// USER MANAGEMENT ROUTES
// ==============================================

// User CRUD operations
router.post('/users', createUser);
router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// User profile picture
router.post('/users/:id/avatar', 
  uploadMiddleware.single('avatar'),
  handleCloudinaryUpload('avatar', 'profile'),
  uploadUserAvatar
);

// ==============================================
// VEHICLE MANAGEMENT ROUTES
// ==============================================

// Vehicle CRUD operations
router.post('/vehicles', 
  uploadMiddleware.array('images', 10),
  handleMultipleCloudinaryUpload('uploadedFiles', 'vehicle'),
  createVehicle
);

router.get('/vehicles', getVehiclesWithFilter);
router.get('/vehicles/:id', getVehicleDetails);
router.put('/vehicles/:id', 
  uploadMiddleware.array('images', 10),
  handleMultipleCloudinaryUpload('uploadedFiles', 'vehicle'),
  updateVehicle
);

router.delete('/vehicles/:id', deleteVehicle);

// Vehicle images management
router.post('/vehicles/:id/images',
  uploadMiddleware.array('images', 10),
  handleMultipleCloudinaryUpload('uploadedFiles', 'vehicle'),
  uploadVehicleImages
);

router.delete('/vehicles/:id/images', deleteVehicleImage);

// Vehicle availability management
router.patch('/vehicles/:id/availability', manageVehicleAvailability);

// Vehicle transfer
router.patch('/vehicles/:id/transfer', transferVehicle);

// Dashboard
router.get('/dashboard', getAdminDashboard);
router.get('/dashboard/enhanced', getEnhancedDashboard);

// Analytics Routes
router.get('/analytics/users', getUserAnalytics);
router.get('/analytics/vendors/performance', getVendorPerformance);
router.get('/analytics/revenue', getRevenueAnalytics);
router.get('/analytics/bookings/quality', getBookingQualityMetrics);
router.get('/analytics/refunds', getRefundAnalytics);

// System Management Routes
router.get('/system/health', getSystemHealth);

// Bulk Operations Routes
router.post('/users/bulk-status', bulkUpdateUserStatus);
router.post('/vendors/bulk-verify', bulkVerifyVendors);

// Data Management Routes
router.get('/export', exportData);
router.get('/audit-log', getAuditLog);




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