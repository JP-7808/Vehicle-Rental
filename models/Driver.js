import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const driverSchema = new Schema({
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  licenseNumber: { type: String, required: true },
  licenseDocUrl: String,
  address: String,
  isActive: { type: Boolean, default: true },
  availability: [{ // simple availability blocks or dates
    start: Date,
    end: Date
  }],
  rating: { type: Number, default: 0 },
  languages: [String],
  chargesPerHour: Number,
  createdAt: Date
}, { timestamps: true });

driverSchema.index({ phone: 1 });

export default model('Driver', driverSchema);
