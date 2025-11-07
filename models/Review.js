import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const reviewSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  reviewer: { type: Schema.Types.ObjectId, ref: 'User' },
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  driver: { type: Schema.Types.ObjectId, ref: 'Driver' },
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  rating: { type: Number, min: 1, max: 5, required: true },
  title: String,
  comment: String,
  photos: [String]
}, { timestamps: true });

reviewSchema.index({ vendor: 1 });
export default model('Review', reviewSchema);
