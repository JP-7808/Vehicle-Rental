import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const kycSchema = new Schema({
  idType: String, // e.g., 'Aadhaar', 'Passport'
  idNumber: String,
  idDocumentUrl: String,
  businessProofUrl: String,
  licenseUrl: String,
  submittedAt: Date,
  verifiedAt: Date,
  status: { type: String, enum: ['pending','verified','rejected'], default: 'pending' },
  notes: String
}, { _id: false });

const vendorSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // owner
  companyName: String,
  address: {
    city: String,
    state: String,
    country: String,
    addressLine: String,
    postalCode: String
  },
  contactPhone: String,
  contactEmail: String,
  rating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  kyc: kycSchema,
  isVerified: { type: Boolean, default: false },
  bankDetails: {
    accountName: String,
    accountNumber: String,
    ifsc: String,
    upiId: String
  },
  createdAt: Date,
  isActive: { type: Boolean, default: true },
  blockedDates: [{ type: Date }] // vendor holidays / unavailability
}, { timestamps: true });

vendorSchema.index({ 'address.city': 1 });

export default model('Vendor', vendorSchema);
