import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import streamifier from 'streamifier';

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload options for different types
const uploadOptions = {
  profile: {
    folder: 'vehicle-rental/profiles',
    transformation: [
      { width: 200, height: 200, crop: 'fill', gravity: 'face' },
      { quality: 'auto' },
      { format: 'webp' }
    ]
  },
  vehicle: {
    folder: 'vehicle-rental/vehicles',
    transformation: [
      { width: 800, height: 600, crop: 'limit' },
      { quality: 'auto' },
      { format: 'webp' }
    ]
  },
  kyc: {
    folder: 'vehicle-rental/kyc-documents',
    transformation: [
      { quality: 'auto' },
      { format: 'auto' }
    ]
  },
  general: {
    folder: 'vehicle-rental/general',
    transformation: [
      { quality: 'auto' },
      { format: 'auto' }
    ]
  }
};

// Upload stream function
const uploadStream = (buffer, options) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Main upload function
export const cloudinaryUpload = async (file, type = 'general') => {
  try {
    const options = uploadOptions[type] || uploadOptions.general;
    
    const result = await uploadStream(file.buffer, {
      ...options,
      resource_type: 'auto', // Automatically detect image, video, etc.
    });

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error(`Failed to upload file to Cloudinary: ${error.message}`);
  }
};

// Delete file from Cloudinary
export const cloudinaryDelete = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error(`Failed to delete file from Cloudinary: ${error.message}`);
  }
};

// Extract public_id from Cloudinary URL
export const extractPublicId = (url) => {
  const matches = url.match(/\/upload\/(?:v\d+\/)?([^\.]+)/);
  return matches ? matches[1] : null;
};

// Upload multiple files
export const cloudinaryUploadMultiple = async (files, type = 'general') => {
  try {
    const uploadPromises = files.map(file => cloudinaryUpload(file, type));
    const results = await Promise.all(uploadPromises);
    return results;
  } catch (error) {
    console.error('Multiple Cloudinary upload error:', error);
    throw error;
  }
};

export default cloudinary;