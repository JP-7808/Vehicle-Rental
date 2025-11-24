import Vendor from '../models/Vendor.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Booking from '../models/Booking.js';
import Transaction from '../models/Transaction.js';
import { cloudinaryUpload, extractPublicId } from '../config/cloudinary.js';

// Create vendor profile
export const createVendorProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Check if vendor profile already exists
    const existingVendor = await Vendor.findOne({ user: userId });
    if (existingVendor) {
      return res.status(400).json({
        success: false,
        message: 'Vendor profile already exists'
      });
    }

    const {
      companyName,
      address,
      contactPhone,
      contactEmail,
      bankDetails
    } = req.body;

    const vendor = new Vendor({
      user: userId,
      companyName,
      address,
      contactPhone: contactPhone || req.user.phone,
      contactEmail: contactEmail || req.user.email,
      bankDetails,
      createdAt: new Date()
    });

    await vendor.save();

    // Update user role to vendor
    await User.findByIdAndUpdate(userId, { 
      role: 'vendor',
      vendorProfile: vendor._id 
    });

    res.status(201).json({
      success: true,
      message: 'Vendor profile created successfully',
      data: { vendor }
    });
  } catch (error) {
    console.error('Create vendor profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create vendor profile'
    });
  }
};

// Get vendor profile
// Get vendor profile
export const getVendorProfile = async (req, res) => {
  try {
    console.log('Fetching vendor profile for user:', req.user._id);
    
    const vendor = await Vendor.findOne({ user: req.user._id })
      .populate('user', 'name email phone avatar')
      .select('-__v');

    if (!vendor) {
      console.log('Vendor profile not found for user:', req.user._id);
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found. Please create a vendor profile first.'
      });
    }

    console.log('Vendor profile found:', vendor._id);
    
    res.json({
      success: true,
      data: { vendor }
    });
  } catch (error) {
    console.error('Get vendor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor profile'
    });
  }
};

// Update vendor profile
export const updateVendorProfile = async (req, res) => {
  try {
    const {
      companyName,
      address,
      contactPhone,
      contactEmail
    } = req.body;

    const vendor = await Vendor.findOneAndUpdate(
      { user: req.user._id },
      {
        companyName,
        address,
        contactPhone,
        contactEmail
      },
      { new: true, runValidators: true }
    ).populate('user', 'name email phone avatar');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Vendor profile updated successfully',
      data: { vendor }
    });
  } catch (error) {
    console.error('Update vendor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor profile'
    });
  }
};

// Update vendor KYC
export const updateVendorKYC = async (req, res) => {
  try {
    const { idType, idNumber, notes } = req.body;

    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    vendor.kyc = {
      idType,
      idNumber,
      submittedAt: new Date(),
      status: 'pending',
      notes
    };

    await vendor.save();

    // Update user KYC status
    await User.findByIdAndUpdate(req.user._id, {
      kycStatus: 'pending'
    });

    res.json({
      success: true,
      message: 'KYC submitted successfully',
      data: { kyc: vendor.kyc }
    });
  } catch (error) {
    console.error('Update vendor KYC error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit KYC'
    });
  }
};

// Upload KYC documents
export const uploadKYCDocuments = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const uploadedUrls = {};

    // Upload ID document
    if (req.files.idDocument) {
      const result = await cloudinaryUpload(req.files.idDocument[0], 'kyc');
      uploadedUrls.idDocumentUrl = result.secure_url;
    }

    // Upload business proof
    if (req.files.businessProof) {
      const result = await cloudinaryUpload(req.files.businessProof[0], 'kyc');
      uploadedUrls.businessProofUrl = result.secure_url;
    }

    // Upload license
    if (req.files.license) {
      const result = await cloudinaryUpload(req.files.license[0], 'kyc');
      uploadedUrls.licenseUrl = result.secure_url;
    }

    // Update vendor KYC with document URLs
    vendor.kyc = {
      ...vendor.kyc,
      ...uploadedUrls,
      submittedAt: new Date(),
      status: 'pending'
    };

    await vendor.save();

    res.json({
      success: true,
      message: 'KYC documents uploaded successfully',
      data: { kyc: vendor.kyc }
    });
  } catch (error) {
    console.error('Upload KYC documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload KYC documents'
    });
  }
};

// Update vendor bank details
export const updateVendorBankDetails = async (req, res) => {
  try {
    const { accountName, accountNumber, ifsc, upiId } = req.body;

    const vendor = await Vendor.findOneAndUpdate(
      { user: req.user._id },
      {
        bankDetails: {
          accountName,
          accountNumber,
          ifsc,
          upiId
        }
      },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Bank details updated successfully',
      data: { bankDetails: vendor.bankDetails }
    });
  } catch (error) {
    console.error('Update bank details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bank details'
    });
  }
};

// Get vendor vehicles
export const getVendorVehicles = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    let query = { vendor: vendor._id };
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

    const vehicles = await Vehicle.find(query)
      .populate('vendor', 'companyName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Vehicle.countDocuments(query);

    res.json({
      success: true,
      data: {
        vehicles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get vendor vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor vehicles'
    });
  }
};

// Get vendor bookings
export const getVendorBookings = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const { page = 1, limit = 10, status, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    let query = { vendor: vendor._id };
    
    if (status) query.status = status;
    if (startDate && endDate) {
      query['pickup.datetime'] = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const bookings = await Booking.find(query)
      .populate('customer', 'name email phone')
      .populate('vehicle', 'title vehicleType make model')
      .populate('driver', 'name phone')
      .populate('payment')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get vendor bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor bookings'
    });
  }
};

// Get vendor dashboard data
export const getVendorDashboard = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get total vehicles
    const totalVehicles = await Vehicle.countDocuments({ vendor: vendor._id });
    const activeVehicles = await Vehicle.countDocuments({ 
      vendor: vendor._id, 
      isActive: true 
    });

    // Get booking statistics
    const totalBookings = await Booking.countDocuments({ vendor: vendor._id });
    const recentBookings = await Booking.countDocuments({ 
      vendor: vendor._id,
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Get revenue statistics
    const revenueData = await Transaction.aggregate([
      {
        $match: {
          vendor: vendor._id,
          type: 'payout',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          averageRevenue: { $avg: '$amount' }
        }
      }
    ]);

    // Get booking status distribution
    const bookingStatus = await Booking.aggregate([
      {
        $match: { vendor: vendor._id }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const dashboardData = {
      overview: {
        totalVehicles,
        activeVehicles,
        totalBookings,
        recentBookings,
        totalRevenue: revenueData[0]?.totalRevenue || 0,
        averageRevenue: revenueData[0]?.averageRevenue || 0
      },
      bookingStatus,
      vendor: {
        companyName: vendor.companyName,
        rating: vendor.rating,
        isVerified: vendor.isVerified,
        kycStatus: vendor.kyc?.status
      }
    };

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Get vendor dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
};

// Get vendor earnings
export const getVendorEarnings = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const { period = 'month' } = req.query;
    let startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }

    const earnings = await Transaction.aggregate([
      {
        $match: {
          vendor: vendor._id,
          type: 'payout',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          totalEarnings: { $sum: '$amount' },
          transactionCount: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    const totalEarnings = earnings.reduce((sum, item) => sum + item.totalEarnings, 0);

    res.json({
      success: true,
      data: {
        earnings,
        totalEarnings,
        period
      }
    });
  } catch (error) {
    console.error('Get vendor earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings data'
    });
  }
};

// Block vendor dates
// Block vendor dates
export const blockVendorDates = async (req, res) => {
  try {
    const { dates, reason } = req.body;

    if (!dates || !Array.isArray(dates)) {
      return res.status(400).json({
        success: false,
        message: 'Dates array is required'
      });
    }

    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    // Validate dates and create new blocked dates
    const newBlockedDates = dates.map(dateString => {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid date: ${dateString}`);
      }
      return {
        date: date,
        reason: reason || 'Vendor unavailable'
      };
    });

    // Check for duplicate dates
    const existingDates = vendor.blockedDates.map(bd => bd.date.toISOString().split('T')[0]);
    const duplicates = newBlockedDates.filter(newDate => 
      existingDates.includes(newDate.date.toISOString().split('T')[0])
    );

    if (duplicates.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Some dates are already blocked: ${duplicates.map(d => d.date.toISOString().split('T')[0]).join(', ')}`
      });
    }

    // Add new blocked dates
    vendor.blockedDates = [...vendor.blockedDates, ...newBlockedDates];
    
    // Sort blocked dates by date
    vendor.blockedDates.sort((a, b) => a.date - b.date);
    
    await vendor.save();

    res.json({
      success: true,
      message: 'Dates blocked successfully',
      data: { 
        blockedDates: vendor.blockedDates.map(bd => ({
          date: bd.date,
          reason: bd.reason,
          id: bd._id
        }))
      }
    });
  } catch (error) {
    console.error('Block vendor dates error:', error);
    
    if (error.message.includes('Invalid date')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to block dates'
    });
  }
};

// Remove blocked date
export const removeBlockedDate = async (req, res) => {
  try {
    const { dateId } = req.params;

    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    // Find the blocked date by ID
    const blockedDateIndex = vendor.blockedDates.findIndex(bd => bd._id.toString() === dateId);
    
    if (blockedDateIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Blocked date not found'
      });
    }

    // Remove the blocked date
    vendor.blockedDates.splice(blockedDateIndex, 1);
    await vendor.save();

    res.json({
      success: true,
      message: 'Date unblocked successfully',
      data: { 
        blockedDates: vendor.blockedDates.map(bd => ({
          date: bd.date,
          reason: bd.reason,
          id: bd._id
        }))
      }
    });
  } catch (error) {
    console.error('Remove blocked date error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock date'
    });
  }
};

// Update vendor settings
export const updateVendorSettings = async (req, res) => {
  try {
    const { isActive, contactPhone, contactEmail } = req.body;

    const vendor = await Vendor.findOneAndUpdate(
      { user: req.user._id },
      {
        isActive,
        contactPhone,
        contactEmail
      },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    res.json({
      success: true,
      message: 'Vendor settings updated successfully',
      data: { vendor }
    });
  } catch (error) {
    console.error('Update vendor settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor settings'
    });
  }
};

// Get vendor reviews
export const getVendorReviews = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ vendor: vendor._id })
      .populate('reviewer', 'name avatar')
      .populate('vehicle', 'title')
      .populate('booking')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Review.countDocuments({ vendor: vendor._id });

    // Calculate average rating
    const ratingStats = await Review.aggregate([
      {
        $match: { vendor: vendor._id }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratingDistribution: {
            $push: '$rating'
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        reviews,
        ratingStats: ratingStats[0] || {
          averageRating: 0,
          totalReviews: 0,
          ratingDistribution: []
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get vendor reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor reviews'
    });
  }
};

// Update vehicle availability blocks
export const updateVehicleAvailabilityBlocks = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const { vehicleId, availabilityBlocks } = req.body;

    const vehicle = await Vehicle.findOne({
      _id: vehicleId,
      vendor: vendor._id
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or access denied'
      });
    }

    vehicle.availabilityBlocks = availabilityBlocks;
    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle availability blocks updated successfully',
      data: { availabilityBlocks: vehicle.availabilityBlocks }
    });
  } catch (error) {
    console.error('Update vehicle availability blocks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle availability blocks'
    });
  }
};