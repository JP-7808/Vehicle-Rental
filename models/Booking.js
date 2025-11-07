import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const bookingSchema = new Schema({
  bookingRef: { type: String, index: true, unique: true }, // generate like BOOK_<timestamp>_<rand>
  customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  driver: { type: Schema.Types.ObjectId, ref: 'Driver' }, // optional
  pickup: {
    city: String,
    locationName: String,
    datetime: { type: Date, required: true }
  },
  dropoff: {
    city: String,
    locationName: String,
    datetime: { type: Date, required: true }
  },
  bookingType: { type: String, enum: ['self-drive','with-driver'], default: 'self-drive' },
  duration: { // computed - days/hours
    days: Number,
    hours: Number
  },
  priceBreakdown: {
    baseAmount: Number,
    driverAmount: Number,
    taxes: Number,
    discount: Number,
    deposit: Number,
    totalPayable: Number
  },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
  promoCode: { type: Schema.Types.ObjectId, ref: 'PromoCode' },
  status: {
    type: String,
    enum: ['pending_payment','confirmed','checked_out','in_progress','completed','cancelled','no_show','driver_unavailable','refunded'],
    default: 'pending_payment'
  },
  cancellation: {
    cancelledBy: { type: String, enum: ['customer','vendor','admin'] },
    cancelledAt: Date,
    cancellationFee: Number,
    reason: String
  },
  penalties: {
    lateFee: Number,
    damageDeduction: Number,
    notes: String
  },
  depositRefund: {
    status: { type: String, enum: ['pending','initiated','completed','rejected'], default: 'pending' },
    amount: Number,
    initiatedAt: Date,
    completedAt: Date,
    refundTransactionId: String
  },
  createdByIP: String,
  notes: String
}, { timestamps: true });

// Index to quickly find bookings for a vehicle in a timeframe
bookingSchema.index({ vehicle: 1, 'pickup.datetime': 1, 'dropoff.datetime': 1 });

// Static helper (app-level) - check for overlapping bookings
bookingSchema.statics.isVehicleAvailable = async function(vehicleId, start, end) {
  // application should call this before confirming booking
  return !(await this.exists({
    vehicle: vehicleId,
    status: { $in: ['confirmed','checked_out','in_progress'] },
    $or: [
      { 'pickup.datetime': { $lt: end }, 'dropoff.datetime': { $gt: start } }
    ]
  }));
};

export default model('Booking', bookingSchema);
