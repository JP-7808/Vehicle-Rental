import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Vendor from '../models/Vendor.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import { 
  createRazorpayOrder, 
  verifyPaymentSignature, 
  getPaymentDetails,
  createRefund 
} from '../config/razorpay.js';

// Create payment order
export const createPaymentOrder = async (req, res) => {
  try {
    const { bookingId, amount, currency = 'INR' } = req.body;

    if (!bookingId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and amount are required'
      });
    }

    // Verify booking exists and belongs to user
    const booking = await Booking.findOne({
      _id: bookingId,
      customer: req.user._id
    }).populate('vehicle vendor');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or access denied'
      });
    }

    // Check if payment already exists for this booking
    const existingPayment = await Payment.findOne({ booking: bookingId });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment already exists for this booking',
        data: { payment: existingPayment }
      });
    }

    // Verify amount matches booking total
    const bookingTotal = booking.priceBreakdown.totalPayable;
    if (Math.abs(amount - bookingTotal) > 1) { // Allow small rounding differences
      return res.status(400).json({
        success: false,
        message: `Payment amount (${amount}) does not match booking total (${bookingTotal})`
      });
    }

    // Create Razorpay order
    const orderResult = await createRazorpayOrder(
      amount, 
      currency, 
      `booking_${bookingId}`
    );

    if (!orderResult.success) {
      return res.status(400).json({
        success: false,
        message: orderResult.error
      });
    }

    // Create payment record in database
    const payment = new Payment({
      booking: bookingId,
      user: req.user._id,
      vendor: booking.vendor._id,
      amount: amount,
      currency: currency,
      gatewayOrderId: orderResult.order.id,
      status: 'initiated'
    });

    await payment.save();

    // Update booking with payment reference
    booking.payment = payment._id;
    await booking.save();

    res.json({
      success: true,
      message: 'Payment order created successfully',
      data: {
        order: orderResult.order,
        payment: {
          id: payment._id,
          amount: payment.amount,
          currency: payment.currency
        },
        razorpayKey: process.env.RAZORPAY_KEY_ID
      }
    });
  } catch (error) {
    console.error('Create payment order error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create payment order'
    });
  }
};

// Verify payment
export const verifyPayment = async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      paymentId 
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment verification data'
      });
    }

    // Verify payment signature
    const isSignatureValid = verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Get payment details from database
    const payment = await Payment.findById(paymentId)
      .populate('booking')
      .populate('user')
      .populate('vendor');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Verify payment belongs to user
    if (payment.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get payment details from Razorpay
    const paymentDetails = await getPaymentDetails(razorpay_payment_id);
    if (!paymentDetails.success) {
      return res.status(400).json({
        success: false,
        message: paymentDetails.error
      });
    }

    const razorpayPayment = paymentDetails.payment;

    // Update payment record
    payment.gatewayPaymentId = razorpay_payment_id;
    payment.gatewayOrderId = razorpay_order_id;
    payment.gatewaySignature = razorpay_signature;
    payment.paymentMethod = razorpayPayment.method;
    payment.status = razorpayPayment.status === 'captured' ? 'success' : 'failed';
    payment.paidAt = new Date();
    payment.meta = razorpayPayment;

    await payment.save();

    // Update booking status
    if (payment.status === 'success') {
      const booking = await Booking.findById(payment.booking._id);
      if (booking) {
        booking.status = 'confirmed';
        await booking.save();

        // Create transaction record
        await Transaction.create({
          type: 'payment',
          referenceId: payment._id,
          relatedBooking: booking._id,
          user: payment.user._id,
          vendor: payment.vendor._id,
          amount: payment.amount,
          currency: payment.currency,
          meta: {
            gateway: 'razorpay',
            paymentId: razorpay_payment_id,
            method: razorpayPayment.method
          }
        });

        // Create notification for vendor
        await Notification.create({
          toVendor: payment.vendor._id,
          type: 'payment_received',
          title: 'Payment Received',
          message: `Payment of ₹${payment.amount} received for booking #${booking.bookingRef}`,
          data: { 
            bookingId: booking._id, 
            paymentId: payment._id,
            amount: payment.amount 
          }
        });

        // Create notification for customer
        await Notification.create({
          toUser: payment.user._id,
          type: 'payment_success',
          title: 'Payment Successful',
          message: `Your payment of ₹${payment.amount} for booking #${booking.bookingRef} was successful`,
          data: { 
            bookingId: booking._id, 
            paymentId: payment._id 
          }
        });
      }
    } else {
      // Handle failed payment
      const booking = await Booking.findById(payment.booking._id);
      if (booking) {
        booking.status = 'pending_payment';
        await booking.save();

        // Create notification for customer
        await Notification.create({
          toUser: payment.user._id,
          type: 'payment_failed',
          title: 'Payment Failed',
          message: `Your payment for booking #${booking.bookingRef} failed. Please try again.`,
          data: { 
            bookingId: booking._id, 
            paymentId: payment._id 
          }
        });
      }
    }

    res.json({
      success: true,
      message: `Payment ${payment.status === 'success' ? 'verified successfully' : 'failed'}`,
      data: {
        payment: {
          id: payment._id,
          status: payment.status,
          amount: payment.amount,
          paidAt: payment.paidAt,
          method: payment.paymentMethod
        },
        booking: payment.booking ? {
          id: payment.booking._id,
          status: payment.booking.status,
          bookingRef: payment.booking.bookingRef
        } : null
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify payment'
    });
  }
};

// Get payment details
export const getPaymentDetails = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('booking')
      .populate('user', 'name email')
      .populate('vendor', 'companyName');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check access permissions
    if (req.user.role === 'customer' && payment.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (!vendor || payment.vendor._id.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.json({
      success: true,
      data: { payment }
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details'
    });
  }
};

// Get payment history
export const getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    // Filter by user role
    if (req.user.role === 'customer') {
      query.user = req.user._id;
    } else if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (vendor) {
        query.vendor = vendor._id;
      } else {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }
    }

    // Additional filters
    if (status) query.status = status;
    if (type) query.type = type;

    const payments = await Payment.find(query)
      .populate('booking', 'bookingRef pickup dropoff')
      .populate('user', 'name email')
      .populate('vendor', 'companyName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Payment.countDocuments(query);

    // Calculate summary statistics
    const summary = await Payment.aggregate([
      {
        $match: query
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        payments,
        summary,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
};

// Initiate refund
export const initiateRefund = async (req, res) => {
  try {
    const { amount, reason, speed = 'normal' } = req.body;

    const payment = await Payment.findById(req.params.id)
      .populate('booking')
      .populate('user')
      .populate('vendor');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check vendor access
    if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (!vendor || payment.vendor._id.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Validate refund conditions
    if (payment.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Can only refund successful payments'
      });
    }

    if (payment.refundDetails?.refundedAmount) {
      const remainingAmount = payment.amount - payment.refundDetails.refundedAmount;
      if (remainingAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Payment already fully refunded'
        });
      }
    }

    const refundAmount = amount || payment.amount;

    // Create refund with Razorpay
    const refundResult = await createRefund(
      payment.gatewayPaymentId,
      refundAmount,
      speed
    );

    if (!refundResult.success) {
      return res.status(400).json({
        success: false,
        message: refundResult.error
      });
    }

    const razorpayRefund = refundResult.refund;

    // Update payment refund details
    const currentRefundedAmount = payment.refundDetails?.refundedAmount || 0;
    const newRefundedAmount = currentRefundedAmount + (razorpayRefund.amount / 100);

    payment.refundDetails = {
      refundedAmount: newRefundedAmount,
      refundAt: new Date(),
      refundTransactionId: razorpayRefund.id,
      refundStatus: razorpayRefund.status
    };

    // If fully refunded, update payment status
    if (newRefundedAmount >= payment.amount) {
      payment.status = 'refunded';
    }

    await payment.save();

    // Update booking status if fully refunded
    if (newRefundedAmount >= payment.amount) {
      const booking = await Booking.findById(payment.booking._id);
      if (booking) {
        booking.status = 'refunded';
        await booking.save();
      }
    }

    // Create transaction record for refund
    await Transaction.create({
      type: 'refund',
      referenceId: payment._id,
      relatedBooking: payment.booking._id,
      user: payment.user._id,
      vendor: payment.vendor._id,
      amount: -(razorpayRefund.amount / 100), // Negative amount for refund
      currency: payment.currency,
      meta: {
        gateway: 'razorpay',
        refundId: razorpayRefund.id,
        reason: reason
      }
    });

    // Create notification for customer
    await Notification.create({
      toUser: payment.user._id,
      type: 'refund_initiated',
      title: 'Refund Initiated',
      message: `Refund of ₹${razorpayRefund.amount / 100} has been initiated for your payment`,
      data: { 
        paymentId: payment._id, 
        refundId: razorpayRefund.id,
        amount: razorpayRefund.amount / 100 
      }
    });

    res.json({
      success: true,
      message: 'Refund initiated successfully',
      data: {
        refund: {
          id: razorpayRefund.id,
          amount: razorpayRefund.amount / 100,
          status: razorpayRefund.status,
          speed: razorpayRefund.speed_processed
        },
        payment: {
          id: payment._id,
          refundedAmount: newRefundedAmount,
          status: payment.status
        }
      }
    });
  } catch (error) {
    console.error('Initiate refund error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate refund'
    });
  }
};

// Handle Razorpay webhook
export const handlePaymentWebhook = async (req, res) => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'];
    const webhookBody = JSON.stringify(req.body);

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBody)
      .digest('hex');

    if (webhookSignature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const event = req.body;
    console.log('Received Razorpay webhook:', event.event);

    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;

      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity);
        break;

      case 'refund.processed':
        await handleRefundProcessed(event.payload.refund.entity);
        break;

      default:
        console.log('Unhandled webhook event:', event.event);
    }

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
};

// Helper function: Handle payment captured webhook
const handlePaymentCaptured = async (paymentEntity) => {
  try {
    const payment = await Payment.findOne({ 
      gatewayPaymentId: paymentEntity.id 
    }).populate('booking user vendor');

    if (payment && payment.status !== 'success') {
      payment.status = 'success';
      payment.paidAt = new Date();
      payment.paymentMethod = paymentEntity.method;
      payment.meta = paymentEntity;
      await payment.save();

      // Update booking status
      if (payment.booking) {
        const booking = await Booking.findById(payment.booking._id);
        if (booking) {
          booking.status = 'confirmed';
          await booking.save();
        }
      }

      // Create transaction record
      await Transaction.create({
        type: 'payment',
        referenceId: payment._id,
        relatedBooking: payment.booking?._id,
        user: payment.user._id,
        vendor: payment.vendor._id,
        amount: payment.amount,
        currency: payment.currency,
        meta: {
          gateway: 'razorpay',
          paymentId: paymentEntity.id,
          method: paymentEntity.method
        }
      });

      console.log(`Payment ${paymentEntity.id} captured and processed`);
    }
  } catch (error) {
    console.error('Error handling payment captured:', error);
  }
};

// Helper function: Handle payment failed webhook
const handlePaymentFailed = async (paymentEntity) => {
  try {
    const payment = await Payment.findOne({ 
      gatewayPaymentId: paymentEntity.id 
    }).populate('booking user');

    if (payment && payment.status === 'initiated') {
      payment.status = 'failed';
      payment.meta = paymentEntity;
      await payment.save();

      // Update booking status
      if (payment.booking) {
        const booking = await Booking.findById(payment.booking._id);
        if (booking) {
          booking.status = 'pending_payment';
          await booking.save();
        }
      }

      console.log(`Payment ${paymentEntity.id} marked as failed`);
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
};

// Helper function: Handle refund processed webhook
const handleRefundProcessed = async (refundEntity) => {
  try {
    const payment = await Payment.findOne({ 
      'refundDetails.refundTransactionId': refundEntity.id 
    }).populate('booking user vendor');

    if (payment) {
      payment.refundDetails.refundStatus = refundEntity.status;
      await payment.save();

      console.log(`Refund ${refundEntity.id} processed for payment ${payment._id}`);
    }
  } catch (error) {
    console.error('Error handling refund processed:', error);
  }
};