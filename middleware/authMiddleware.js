import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Main authentication middleware
export const authMiddleware = async (req, res, next) => {
  try {
    // Get token from cookies or Authorization header
    const token = req.cookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select('-passwordHash')
      .populate('vendorProfile');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error in authentication.'
    });
  }
};

// Optional authentication middleware
export const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken || req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-passwordHash');
      req.user = user;
    }
    
    next();
  } catch (error) {
    next(); // Continue without user if token is invalid
  }
};

// Role-based middleware generator
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authentication required.'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${req.user.role} role cannot access this resource.`
      });
    }

    next();
  };
};

// Specific role middlewares
export const requireAdmin = requireRole(['admin']);
export const requireVendor = requireRole(['vendor']);
export const requireCustomer = requireRole(['customer']);
export const requireVendorOrAdmin = requireRole(['vendor', 'admin']);
export const requireCustomerOrAdmin = requireRole(['customer', 'admin']);

// Vendor profile check middleware
export const requireVendorProfile = async (req, res, next) => {
  try {
    if (req.user.role !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Vendor role required.'
      });
    }

    if (!req.user.vendorProfile) {
      return res.status(403).json({
        success: false,
        message: 'Vendor profile not setup. Please complete your vendor profile.'
      });
    }

    // Populate vendor profile if not already populated
    if (typeof req.user.vendorProfile === 'string') {
      const Vendor = (await import('../models/Vendor.js')).default;
      req.user.vendorProfile = await Vendor.findById(req.user.vendorProfile);
    }

    next();
  } catch (error) {
    console.error('Vendor profile middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error in vendor profile verification.'
    });
  }
};