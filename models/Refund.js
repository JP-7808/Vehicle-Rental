import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const refundSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
  initiatedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // typically admin or system
  amount: { type: Number, required: true },
  reason: String,
  status: { type: String, enum: ['pending','processing','completed','failed'], default: 'pending' },
  initiatedAt: { type: Date, default: Date.now },
  completedAt: Date,
  gatewayRefundId: String,
  notes: String
}, { timestamps: true });

export default model('Refund', refundSchema);
