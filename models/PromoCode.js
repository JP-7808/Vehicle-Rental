import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const promoSchema = new Schema({
  code: { type: String, unique: true, required: true, uppercase: true, trim: true },
  description: String,
  discountType: { type: String, enum: ['percentage','flat'], default: 'percentage' },
  discountValue: Number,
  minBookingAmount: Number,
  maxDiscountAmount: Number,
  validFrom: Date,
  validTill: Date,
  usageLimitPerUser: Number,
  totalUsageLimit: Number,
  usedCount: { type: Number, default: 0 },
  applicableVehicleTypes: [String], // e.g., ['car','bike']
  applicableCities: [String],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default model('PromoCode', promoSchema);
