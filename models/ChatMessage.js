import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const chatMessageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId }, // could reference a Conversation collection
  fromUser: { type: Schema.Types.ObjectId, ref: 'User' },
  toUser: { type: Schema.Types.ObjectId, ref: 'User' },
  toVendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  message: { type: String },
  attachments: [String], // cloudinary urls
  delivered: { type: Boolean, default: false },
  readAt: Date
}, { timestamps: true });

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

export default model('ChatMessage', chatMessageSchema);
