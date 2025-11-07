import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const addressSchema = new Schema({
  city: String,
  state: String,
  country: String,
  latitude: Number,
  longitude: Number,
  addressLine: String,
  postalCode: String
}, { _id: false });

const emailVerificationSchema = new Schema({
  otp: { type: String }, // store 6-digit OTP (hashed if you prefer security)
  expiresAt: { type: Date }, // when OTP becomes invalid
  isVerified: { type: Boolean, default: false }, // email verification status
  lastSentAt: { type: Date } // for rate limiting resend
}, { _id: false });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  passwordHash: { type: String },
  role: { type: String, enum: ['customer', 'vendor', 'admin'], default: 'customer' },
  avatar: { type: String }, // cloudinary url
  address: addressSchema,
  
  // Email verification via OTP
  emailVerification: {
    type: emailVerificationSchema,
    default: () => ({})  // ✅ FIX HERE
  },

  // Optional: track login or registration metadata
  registeredAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date },
  lastSeen: { type: Date },

  kycStatus: { type: String, enum: ['not_submitted', 'pending', 'verified', 'rejected'], default: 'not_submitted' },
  kycDocuments: [{ type: String }],

  vendorProfile: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  isActive: { type: Boolean, default: true },

  preferences: {
    preferredPaymentMethod: String,
    language: { type: String, default: 'en' }
  }
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });

/* -------------------------
   🔹 OTP Helper Methods
--------------------------*/

// Generate a random 6-digit OTP and set expiry (e.g., 10 minutes)
userSchema.methods.generateEmailOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.emailVerification.otp = otp;
  this.emailVerification.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
  this.emailVerification.lastSentAt = new Date();
  return otp; // send via Nodemailer after saving
};

// Verify OTP entered by user
userSchema.methods.verifyEmailOtp = function (enteredOtp) {
  const ev = this.emailVerification;
  if (!ev || !ev.otp) return { success: false, message: 'OTP not generated.' };

  if (Date.now() > new Date(ev.expiresAt)) {
    return { success: false, message: 'OTP expired. Please request a new one.' };
  }

  if (enteredOtp !== ev.otp) {
    return { success: false, message: 'Invalid OTP.' };
  }

  // success
  ev.isVerified = true;
  ev.otp = undefined;
  ev.expiresAt = undefined;
  return { success: true, message: 'Email verified successfully.' };
};

export default model('User', userSchema);
