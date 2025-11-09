import Razorpay from 'razorpay';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Razorpay instance
export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Verify Razorpay payment signature
export const verifyPaymentSignature = (orderId, paymentId, signature) => {
  try {
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    return generatedSignature === signature;
  } catch (error) {
    console.error('Error verifying payment signature:', error);
    return false;
  }
};

// Create Razorpay order
export const createRazorpayOrder = async (amount, currency = 'INR', receipt = null) => {
  try {
    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency: currency,
      receipt: receipt || `receipt_${Date.now()}`,
      payment_capture: 1, // Auto capture payment
    };

    const order = await razorpay.orders.create(options);
    return {
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
      }
    };
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    return {
      success: false,
      error: error.error?.description || 'Failed to create payment order'
    };
  }
};

// Fetch payment details from Razorpay
export const fetchPaymentDetails = async (paymentId) => { // Renamed from getPaymentDetails
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return {
      success: true,
      payment
    };
  } catch (error) {
    console.error('Error fetching payment details:', error);
    return {
      success: false,
      error: error.error?.description || 'Failed to fetch payment details'
    };
  }
};

// Refund payment
export const createRefund = async (paymentId, amount = null, speed = 'normal') => {
  try {
    const refundData = {
      payment_id: paymentId,
      speed: speed // normal or opti
    };

    if (amount) {
      refundData.amount = Math.round(amount * 100); // Convert to paise
    }

    const refund = await razorpay.payments.refund(paymentId, refundData);
    return {
      success: true,
      refund
    };
  } catch (error) {
    console.error('Error creating refund:', error);
    return {
      success: false,
      error: error.error?.description || 'Failed to create refund'
    };
  }
};

// Fetch refund details
export const fetchRefundDetails = async (refundId) => {
  try {
    const refund = await razorpay.refunds.fetch(refundId);
    return {
      success: true,
      refund
    };
  } catch (error) {
    console.error('Error fetching refund details:', error);
    return {
      success: false,
      error: error.error?.description || 'Failed to fetch refund details'
    };
  }
};

export default razorpay;