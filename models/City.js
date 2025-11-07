import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const citySchema = new Schema({
  name: { type: String, required: true, unique: true },
  state: String,
  country: { type: String, default: 'India' },
  code: String,
  coordinates: { type: [Number], index: '2dsphere' } // [lng, lat]
}, { timestamps: true });

export default model('City', citySchema);
