import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const paymentSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // payer
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true }, // payee
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  gateway: { type: String, default: 'razorpay' },
  gatewayPaymentId: String,
  gatewayOrderId: String,
  gatewaySignature: String,
  paymentMethod: String, // card, upi, netbanking, wallet, etc.
  status: { 
    type: String, 
    enum: ['initiated', 'success', 'failed', 'refunded'], 
    default: 'initiated' 
  },
  paidAt: Date,
  refundDetails: {
    refundedAmount: { type: Number, default: 0 },
    refundAt: Date,
    refundTransactionId: String,
    refundStatus: String // processed, failed
  },
  meta: Schema.Types.Mixed // store raw gateway response
}, { timestamps: true });

paymentSchema.index({ gatewayPaymentId: 1 });
paymentSchema.index({ user: 1 });
paymentSchema.index({ vendor: 1 });
paymentSchema.index({ booking: 1 });

export default model('Payment', paymentSchema);