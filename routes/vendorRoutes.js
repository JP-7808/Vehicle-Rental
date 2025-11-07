import express from 'express';
import {
  createVendorProfile,
  getVendorProfile,
  updateVendorProfile,
  updateVendorKYC,
  getVendorVehicles,
  getVendorBookings,
  getVendorDashboard,
  updateVendorBankDetails,
  uploadKYCDocuments,
  blockVendorDates,
  getVendorEarnings
} from '../controllers/vendorController.js';
import { authMiddleware, requireVendor } from '../middleware/authMiddleware.js';
import { uploadMiddleware } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All routes require vendor authentication
router.use(authMiddleware, requireVendor);

// Vendor profile routes
router.post('/profile', createVendorProfile);
router.get('/profile', getVendorProfile);
router.put('/profile', updateVendorProfile);
router.patch('/bank-details', updateVendorBankDetails);

// KYC routes
router.post('/kyc', updateVendorKYC);
router.post('/kyc/documents', 
  uploadMiddleware.fields([
    { name: 'idDocument', maxCount: 1 },
    { name: 'businessProof', maxCount: 1 },
    { name: 'license', maxCount: 1 }
  ]),
  uploadKYCDocuments
);

// Vehicle management
router.get('/vehicles', getVendorVehicles);

// Booking management
router.get('/bookings', getVendorBookings);

// Dashboard and analytics
router.get('/dashboard', getVendorDashboard);
router.get('/earnings', getVendorEarnings);

// Availability management
router.post('/block-dates', blockVendorDates);

export default router;