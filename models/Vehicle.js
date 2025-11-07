import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const pricingSchema = new Schema({
  baseDaily: { type: Number, required: true }, // base per day
  baseHourly: Number,
  weeklyDiscountPercent: { type: Number, default: 0 },
  monthlyDiscountPercent: { type: Number, default: 0 },
  extraHourCharge: { type: Number, default: 0 },
  depositAmount: { type: Number, default: 0 }
}, { _id: false });

const policySchema = new Schema({
  fuelPolicy: { type: String, enum: ['full-to-full','pay-per-km','prepaid'], default: 'full-to-full' },
  ageRequirements: { // minimum age
    minForSelfDrive: Number,
    minForTwoWheeler: Number
  },
  licenseRequired: { type: Boolean, default: true },
  allowedKmPerDay: Number,
  extraKmCharge: Number,
  locationRestrictions: {
    allowedStates: [String],
    allowedCities: [String]
  },
  termsAndConditions: String
}, { _id: false });

const locationSchema = new Schema({
  city: { type: String, required: true },
  locationName: String,
  coordinates: { type: [Number], index: '2dsphere' } // [lng, lat]
}, { _id: false });

const availabilityBlockSchema = new Schema({
  start: Date,
  end: Date,
  reason: String // e.g., maintenance, vendor blocked
}, { _id: false });

const vehicleSchema = new Schema({
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
  title: { type: String, required: true }, // e.g., "Toyota Innova Crysta"
  description: String,
  vehicleType: { type: String, enum: ['bike','car','bicycle','bus','truck'], required: true },
  make: String,
  model: String,
  year: Number,
  registrationNumber: String,
  images: [String], // cloudinary urls
  seats: Number,
  transmission: { type: String, enum: ['manual','automatic','n/a'], default: 'manual' },
  fuelType: { type: String, enum: ['petrol','diesel','electric','other'] },
  currentOdometerKm: Number,
  pricing: pricingSchema,
  policy: policySchema,
  locations: [locationSchema],
  availabilityBlocks: [availabilityBlockSchema], // vendor blocks/unavailable
  isActive: { type: Boolean, default: true },
  createdAt: Date,
  metadata: {
    tags: [String],
    vin: String
  }
}, { timestamps: true });

// Common index to search vehicles by city & type
vehicleSchema.index({ 'locations.city': 1, vehicleType: 1, isActive: 1 });

export default model('Vehicle', vehicleSchema);
