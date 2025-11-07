import express from 'express';
import {
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  cancelBooking,
  calculateBookingPrice,
  getBookingAvailability,
  completeBooking,
  getBookingInvoice
} from '../controllers/bookingController.js';
import { authMiddleware, requireCustomer, requireVendorOrAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/calculate-price', calculateBookingPrice);
router.post('/check-availability', getBookingAvailability);

// Customer routes
router.use(authMiddleware);
router.post('/', requireCustomer, createBooking);
router.get('/', getBookings);
router.get('/:id', getBookingById);
router.get('/:id/invoice', getBookingInvoice);
router.post('/:id/cancel', cancelBooking);

// Vendor/Admin routes
router.patch('/:id/status', requireVendorOrAdmin, updateBookingStatus);
router.post('/:id/complete', requireVendorOrAdmin, completeBooking);

export default router;