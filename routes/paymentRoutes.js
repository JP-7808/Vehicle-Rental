import express from 'express';
import {
  createPaymentOrder,
  verifyPayment,
  getPaymentDetails,
  initiateRefund,
  getPaymentHistory,
  getPaymentById,
  handlePaymentWebhook
} from '../controllers/paymentController.js';
import { authMiddleware, requireCustomer, requireVendorOrAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Customer routes
router.post('/create-order', authMiddleware, requireCustomer, createPaymentOrder);
router.post('/verify', authMiddleware, requireCustomer, verifyPayment);
router.get('/history', authMiddleware, getPaymentHistory);
router.get('/:id', authMiddleware, getPaymentById);

// Vendor/Admin routes
router.post('/:id/refund', authMiddleware, requireVendorOrAdmin, initiateRefund);

// Webhook route (no auth required)
router.post('/webhook', handlePaymentWebhook);

export default router;