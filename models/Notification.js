import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const notificationSchema = new Schema({
  toUser: { type: Schema.Types.ObjectId, ref: 'User' },
  toVendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  type: { type: String }, // booking_confirmed, payment_failed, refund_initiated...
  channel: { type: String, enum: ['email','sms','in_app','push'], default: 'in_app' },
  title: String,
  message: String,
  data: Schema.Types.Mixed, // additional payload
  isRead: { type: Boolean, default: false },
  sentAt: Date
}, { timestamps: true });

notificationSchema.index({ toUser: 1, isRead: 1 });

export default model('Notification', notificationSchema);
