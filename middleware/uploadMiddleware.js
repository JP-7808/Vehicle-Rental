import multer from 'multer';
import path from 'path';
import { cloudinaryUpload } from '../config/cloudinary.js';

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter function
// File filter function
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const allowedDocTypes = /pdf|doc|docx/;

  const ext = path.extname(file.originalname).toLowerCase();
  const isImage = allowedImageTypes.test(ext);
  const isDoc = allowedDocTypes.test(ext);

  // Extract the route path
  const routePath = req.route?.path || '';
  const method = req.method;

  // Determine upload context
  const isProfileUpload = routePath.includes('profile') && method === 'PATCH';
  const isVehicleUpload = routePath.includes('images') && method === 'POST'; // Key Fix
  const isKYCDocument = ['idDocument', 'businessProof', 'license'].includes(file.fieldname);

  if (isProfileUpload && isImage) {
    return cb(null, true);
  }

  if (isVehicleUpload && isImage) {
    return cb(null, true); // Allow vehicle image uploads
  }

  if (isKYCDocument && (isImage || isDoc)) {
    return cb(null, true);
  }

  cb(new Error('Invalid file type or upload context'), false);
};

// Configure multer
export const uploadMiddleware = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: fileFilter
});

// Middleware to handle upload to Cloudinary
export const handleCloudinaryUpload = (fieldName, folder) => {
  return async (req, res, next) => {
    try {
      if (!req.file) {
        return next();
      }

      const result = await cloudinaryUpload(req.file, folder);
      
      if (fieldName === 'multiple') {
        if (!req.body.uploadedFiles) {
          req.body.uploadedFiles = [];
        }
        req.body.uploadedFiles.push(result.secure_url);
      } else {
        req.body[fieldName] = result.secure_url;
      }

      next();
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'File upload failed'
      });
    }
  };
};

// Multiple files upload handler
export const handleMultipleCloudinaryUpload = (fieldName, folder, maxCount = 5) => {
  return async (req, res, next) => {
    try {
      if (!req.files || req.files.length === 0) {
        return next();
      }

      const uploadPromises = req.files.map(file => 
        cloudinaryUpload(file, folder)
      );

      const results = await Promise.all(uploadPromises);
      req.body[fieldName] = results.map(result => result.secure_url);

      next();
    } catch (error) {
      console.error('Multiple Cloudinary upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'File upload failed'
      });
    }
  };
};