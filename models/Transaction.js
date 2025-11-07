import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const txnSchema = new Schema({
  type: { type: String, enum: ['payment','payout','refund','fee','adjustment'], required: true },
  referenceId: String, // payment id / refund id
  relatedBooking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  meta: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

txnSchema.index({ type: 1, createdAt: -1 });

export default model('Transaction', txnSchema);
