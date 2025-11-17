import User from '../models/User.js';
import Vendor from '../models/Vendor.js';
import Vehicle from '../models/Vehicle.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Transaction from '../models/Transaction.js';
import PromoCode from '../models/PromoCode.js';
import Notification from '../models/Notification.js';
import Review from '../models/Review.js';
import Driver from '../models/Driver.js';
import City from '../models/City.js';
import { createRefund, fetchPaymentDetails } from '../config/razorpay.js';
import { cloudinaryUpload, cloudinaryDelete } from '../config/cloudinary.js';

// Admin Dashboard
export const getAdminDashboard = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get total counts
    const totalUsers = await User.countDocuments();
    const totalVendors = await Vendor.countDocuments();
    const totalVehicles = await Vehicle.countDocuments();
    const totalBookings = await Booking.countDocuments();

    // Get recent counts (last 30 days)
    const recentUsers = await User.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });
    const recentBookings = await Booking.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    // Revenue statistics
    const revenueData = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          averageRevenue: { $avg: '$amount' },
          bookingCount: { $sum: 1 }
        }
      }
    ]);

    // Booking status distribution
    const bookingStatus = await Booking.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Vendor verification status
    const vendorStatus = await Vendor.aggregate([
      {
        $group: {
          _id: '$kyc.status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent activities
    const recentActivities = await Booking.find()
      .populate('customer', 'name')
      .populate('vehicle', 'title')
      .sort({ createdAt: -1 })
      .limit(10);

    const dashboardData = {
      overview: {
        totalUsers,
        totalVendors,
        totalVehicles,
        totalBookings,
        recentUsers,
        recentBookings,
        totalRevenue: revenueData[0]?.totalRevenue || 0,
        averageRevenue: revenueData[0]?.averageRevenue || 0
      },
      charts: {
        bookingStatus,
        vendorStatus
      },
      recentActivities
    };

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
};

// User Management
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, status, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (role) query.role = role;
    if (status) query.isActive = status === 'active';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-passwordHash')
      .populate('vendorProfile')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

export const getUserById = async (req, res) => {
  try {
    const user = await User.findBy20
      .findById(req.params.id)
      .select('-passwordHash')
      .populate({
        path: 'vendorProfile',
        select: 'companyName contactPhone rating ratingCount isVerified'
      });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // ---- recent bookings (unchanged) ----
    const userBookings = await Booking.find({ customer: user._id })
      .populate('vehicle', 'title vehicleType')
      .populate('vendor', 'companyName')
      .sort({ createdAt: -1 })
      .limit(10);

    // ---- OPTIONAL: vendor's vehicles (separate query) ----
    let vendorVehicles = [];
    if (user.role === 'vendor' && user.vendorProfile) {
      vendorVehicles = await Vehicle.find({ vendor: user.vendorProfile._id })
        .select('title vehicleType images seats transmission')
        .limit(5);
    }

    res.json({
      success: true,
      data: { user, recentBookings: userBookings, vendorVehicles }
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};

export const updateUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create notification for user
    await Notification.create({
      toUser: user._id,
      type: 'account_status_updated',
      title: 'Account Status Updated',
      message: `Your account has been ${isActive ? 'activated' : 'deactivated'} by admin`,
      data: { isActive }
    });

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: { user }
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;

    if (!['customer', 'vendor', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If changing to vendor, check if vendor profile exists
    if (role === 'vendor' && !user.vendorProfile) {
      // Create a basic vendor profile
      const vendor = new Vendor({
        user: user._id,
        companyName: `${user.name}'s Business`,
        contactPhone: user.phone,
        contactEmail: user.email,
        createdAt: new Date()
      });

      await vendor.save();
      user.vendorProfile = vendor._id;
      await user.save();
    }

    res.json({
      success: true,
      message: `User role updated to ${role} successfully`,
      data: { user }
    });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user role'
    });
  }
};

// Vendor Management
export const getAllVendors = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, kycStatus, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (status) query.isActive = status === 'active';
    if (kycStatus) query['kyc.status'] = kycStatus;
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { contactEmail: { $regex: search, $options: 'i' } }
      ];
    }

    const vendors = await Vendor.find(query)
      .populate('user', 'name email phone avatar')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Vendor.countDocuments(query);

    res.json({
      success: true,
      data: {
        vendors,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendors'
    });
  }
};

export const getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .populate('user', 'name email phone avatar address')
      .populate({
        path: 'user',
        populate: {
          path: 'vendorProfile',
          model: 'Vendor'
        }
      });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Get vendor's vehicles
    const vendorVehicles = await Vehicle.find({ vendor: vendor._id })
      .sort({ createdAt: -1 });

    // Get vendor's bookings
    const vendorBookings = await Booking.find({ vendor: vendor._id })
      .populate('customer', 'name email')
      .populate('vehicle', 'title')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get vendor's earnings
    const earnings = await Payment.aggregate([
      {
        $match: {
          vendor: vendor._id,
          status: 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          totalBookings: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        vendor,
        statistics: {
          totalVehicles: vendorVehicles.length,
          totalBookings: vendorBookings.length,
          totalEarnings: earnings[0]?.totalEarnings || 0
        },
        recentVehicles: vendorVehicles.slice(0, 5),
        recentBookings: vendorBookings
      }
    });
  } catch (error) {
    console.error('Get vendor by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor'
    });
  }
};

export const updateVendorStatus = async (req, res) => {
  try {
    const { isActive, isVerified } = req.body;

    const updates = {};
    if (isActive !== undefined) updates.isActive = isActive;
    if (isVerified !== undefined) updates.isVerified = isVerified;

    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    ).populate('user');

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Update user's vendor status
    if (vendor.user) {
      await User.findByIdAndUpdate(vendor.user._id, {
        isActive: isActive !== undefined ? isActive : vendor.user.isActive
      });
    }

    // Create notification for vendor
    if (vendor.user) {
      await Notification.create({
        toUser: vendor.user._id,
        type: 'vendor_status_updated',
        title: 'Vendor Status Updated',
        message: `Your vendor account has been ${isActive ? 'activated' : 'deactivated'} by admin`,
        data: { isActive, isVerified }
      });
    }

    res.json({
      success: true,
      message: 'Vendor status updated successfully',
      data: { vendor }
    });
  } catch (error) {
    console.error('Update vendor status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vendor status'
    });
  }
};

export const verifyVendorKYC = async (req, res) => {
  try {
    const { notes } = req.body;

    const vendor = await Vendor.findById(req.params.id).populate('user');
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    if (!vendor.kyc) {
      return res.status(400).json({
        success: false,
        message: 'Vendor has not submitted KYC'
      });
    }

    vendor.kyc.status = 'verified';
    vendor.kyc.verifiedAt = new Date();
    vendor.kyc.notes = notes || vendor.kyc.notes;
    vendor.isVerified = true;

    await vendor.save();

    // Update user KYC status
    await User.findByIdAndUpdate(vendor.user._id, {
      kycStatus: 'verified'
    });

    // Create notification for vendor
    await Notification.create({
      toUser: vendor.user._id,
      type: 'kyc_verified',
      title: 'KYC Verified',
      message: 'Your KYC documents have been verified successfully',
      data: { vendorId: vendor._id }
    });

    res.json({
      success: true,
      message: 'Vendor KYC verified successfully',
      data: { vendor }
    });
  } catch (error) {
    console.error('Verify vendor KYC error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify vendor KYC'
    });
  }
};

export const rejectVendorKYC = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const vendor = await Vendor.findById(req.params.id).populate('user');
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    if (!vendor.kyc) {
      return res.status(400).json({
        success: false,
        message: 'Vendor has not submitted KYC'
      });
    }

    vendor.kyc.status = 'rejected';
    vendor.kyc.notes = reason;
    vendor.isVerified = false;

    await vendor.save();

    // Update user KYC status
    await User.findByIdAndUpdate(vendor.user._id, {
      kycStatus: 'rejected'
    });

    // Create notification for vendor
    await Notification.create({
      toUser: vendor.user._id,
      type: 'kyc_rejected',
      title: 'KYC Rejected',
      message: `Your KYC documents were rejected: ${reason}`,
      data: { vendorId: vendor._id, reason }
    });

    res.json({
      success: true,
      message: 'Vendor KYC rejected successfully',
      data: { vendor }
    });
  } catch (error) {
    console.error('Reject vendor KYC error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject vendor KYC'
    });
  }
};

// Vehicle Management
export const getAllVehicles = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, vehicleType, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (vehicleType) query.vehicleType = vehicleType;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { make: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
        { registrationNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const vehicles = await Vehicle.find(query)
      .populate('vendor', 'companyName contactPhone')
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
    console.error('Get all vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
};

export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id)
      .populate('vendor', 'companyName contactPhone contactEmail address');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Get vehicle's bookings
    const vehicleBookings = await Booking.find({ vehicle: vehicle._id })
      .populate('customer', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        vehicle,
        recentBookings: vehicleBookings
      }
    });
  } catch (error) {
    console.error('Get vehicle by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle'
    });
  }
};

export const updateVehicleStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    const vehicle = await Vehicle.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).populate('vendor');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Create notification for vendor
    if (vehicle.vendor && vehicle.vendor.user) {
      await Notification.create({
        toVendor: vehicle.vendor._id,
        type: 'vehicle_status_updated',
        title: 'Vehicle Status Updated',
        message: `Your vehicle "${vehicle.title}" has been ${isActive ? 'activated' : 'deactivated'} by admin`,
        data: { vehicleId: vehicle._id, isActive }
      });
    }

    res.json({
      success: true,
      message: `Vehicle ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: { vehicle }
    });
  } catch (error) {
    console.error('Update vehicle status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle status'
    });
  }
};

// Booking Management
export const getAllBookings = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, dateFrom, dateTo, search } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (status) query.status = status;
    if (dateFrom && dateTo) {
      query.createdAt = {
        $gte: new Date(dateFrom),
        $lte: new Date(dateTo)
      };
    }
    if (search) {
      query.$or = [
        { bookingRef: { $regex: search, $options: 'i' } },
        { 'pickup.city': { $regex: search, $options: 'i' } }
      ];
    }

    const bookings = await Booking.find(query)
      .populate('customer', 'name email phone')
      .populate('vendor', 'companyName')
      .populate('vehicle', 'title vehicleType')
      .populate('payment')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

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
    console.error('Get all bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
};

export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customer', 'name email phone address')
      .populate('vendor', 'companyName contactPhone contactEmail address')
      .populate('vehicle', 'title vehicleType images make model registrationNumber pricing policy')
      .populate('driver', 'name phone licenseNumber')
      .populate('payment')
      .populate('promoCode');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: { booking }
    });
  } catch (error) {
    console.error('Get booking by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking'
    });
  }
};

export const updateBookingStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;

    const booking = await Booking.findById(req.params.id)
      .populate('customer')
      .populate('vendor');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const previousStatus = booking.status;
    booking.status = status;

    if (status === 'cancelled') {
      booking.cancellation = {
        cancelledBy: 'admin',
        cancelledAt: new Date(),
        reason: reason || 'Cancelled by admin'
      };
    }

    await booking.save();

    // Create notifications
    if (booking.customer) {
      await Notification.create({
        toUser: booking.customer._id,
        type: 'booking_status_updated',
        title: 'Booking Status Updated',
        message: `Your booking #${booking.bookingRef} status changed from ${previousStatus} to ${status} by admin`,
        data: { bookingId: booking._id, previousStatus, newStatus: status }
      });
    }

    if (booking.vendor) {
      await Notification.create({
        toVendor: booking.vendor._id,
        type: 'booking_status_updated',
        title: 'Booking Status Updated',
        message: `Booking #${booking.bookingRef} status changed from ${previousStatus} to ${status} by admin`,
        data: { bookingId: booking._id, previousStatus, newStatus: status }
      });
    }

    res.json({
      success: true,
      message: 'Booking status updated successfully',
      data: { booking }
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status'
    });
  }
};

export const cancelBookingAdmin = async (req, res) => {
  try {
    const { reason, refundAmount } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required'
      });
    }

    const booking = await Booking.findById(req.params.id)
      .populate('customer')
      .populate('vendor')
      .populate('payment');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const cancellableStatuses = ['pending_payment', 'confirmed'];
    if (!cancellableStatuses.includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Booking cannot be cancelled in ${booking.status} status`
      });
    }

    booking.status = 'cancelled';
    booking.cancellation = {
      cancelledBy: 'admin',
      cancelledAt: new Date(),
      cancellationFee: 0, // Admin cancellation usually has no fee
      reason
    };

    await booking.save();

    // Process refund if payment exists and was successful
    if (booking.payment && booking.payment.status === 'success' && refundAmount > 0) {
      // This would integrate with your refund logic
      // For now, we'll just update the payment record
      booking.payment.refundDetails = {
        refundedAmount: refundAmount,
        refundAt: new Date(),
        refundStatus: 'processed'
      };
      await booking.payment.save();
    }

    // Create notifications
    if (booking.customer) {
      await Notification.create({
        toUser: booking.customer._id,
        type: 'booking_cancelled',
        title: 'Booking Cancelled',
        message: `Your booking #${booking.bookingRef} has been cancelled by admin. Reason: ${reason}`,
        data: { bookingId: booking._id, reason, refundAmount }
      });
    }

    if (booking.vendor) {
      await Notification.create({
        toVendor: booking.vendor._id,
        type: 'booking_cancelled',
        title: 'Booking Cancelled',
        message: `Booking #${booking.bookingRef} has been cancelled by admin`,
        data: { bookingId: booking._id, reason }
      });
    }

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { 
        booking,
        refundAmount: refundAmount || 0
      }
    });
  } catch (error) {
    console.error('Cancel booking admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
};

// Payment Management
export const getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, dateFrom, dateTo } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (status) query.status = status;
    if (dateFrom && dateTo) {
      query.createdAt = {
        $gte: new Date(dateFrom),
        $lte: new Date(dateTo)
      };
    }

    const payments = await Payment.find(query)
      .populate('booking', 'bookingRef')
      .populate('user', 'name email')
      .populate('vendor', 'companyName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Payment.countDocuments(query);

    // Payment summary
    const summary = await Payment.aggregate([
      {
        $match: query
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        payments,
        summary,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments'
    });
  }
};

export const getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('booking')
      .populate('user', 'name email phone')
      .populate('vendor', 'companyName contactEmail');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      data: { payment }
    });
  } catch (error) {
    console.error('Get payment by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment'
    });
  }
};

export const initiateAdminRefund = async (req, res) => {
  try {
    const { amount, reason, speed = 'normal' } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Refund reason is required'
      });
    }

    const payment = await Payment.findById(req.params.id)
      .populate('user')
      .populate('vendor')
      .populate('booking');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Can only refund successful payments'
      });
    }

    const refundAmount = amount || payment.amount;

    // Create refund with Razorpay
    const refundResult = await createRefund(
      payment.gatewayPaymentId,
      refundAmount,
      speed
    );

    if (!refundResult.success) {
      return res.status(400).json({
        success: false,
        message: refundResult.error
      });
    }

    const razorpayRefund = refundResult.refund;

    // Update payment refund details
    const currentRefundedAmount = payment.refundDetails?.refundedAmount || 0;
    const newRefundedAmount = currentRefundedAmount + (razorpayRefund.amount / 100);

    payment.refundDetails = {
      refundedAmount: newRefundedAmount,
      refundAt: new Date(),
      refundTransactionId: razorpayRefund.id,
      refundStatus: razorpayRefund.status
    };

    if (newRefundedAmount >= payment.amount) {
      payment.status = 'refunded';
    }

    await payment.save();

    // Update booking status if fully refunded
    if (newRefundedAmount >= payment.amount && payment.booking) {
      const booking = await Booking.findById(payment.booking._id);
      if (booking) {
        booking.status = 'refunded';
        await booking.save();
      }
    }

    // Create transaction record
    await Transaction.create({
      type: 'refund',
      referenceId: payment._id,
      relatedBooking: payment.booking?._id,
      user: payment.user._id,
      vendor: payment.vendor._id,
      amount: -(razorpayRefund.amount / 100),
      currency: payment.currency,
      meta: {
        gateway: 'razorpay',
        refundId: razorpayRefund.id,
        reason,
        initiatedBy: 'admin'
      }
    });

    // Create notification for user
    if (payment.user) {
      await Notification.create({
        toUser: payment.user._id,
        type: 'refund_initiated',
        title: 'Refund Initiated',
        message: `Refund of ₹${razorpayRefund.amount / 100} has been initiated by admin. Reason: ${reason}`,
        data: { 
          paymentId: payment._id, 
          refundId: razorpayRefund.id,
          amount: razorpayRefund.amount / 100,
          reason
        }
      });
    }

    res.json({
      success: true,
      message: 'Refund initiated successfully',
      data: {
        refund: {
          id: razorpayRefund.id,
          amount: razorpayRefund.amount / 100,
          status: razorpayRefund.status
        },
        payment: {
          id: payment._id,
          refundedAmount: newRefundedAmount,
          status: payment.status
        }
      }
    });
  } catch (error) {
    console.error('Initiate admin refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate refund'
    });
  }
};

// Analytics & Reports
export const getSystemAnalytics = async (req, res) => {
  try {
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

    // User growth
    const userGrowth = await User.aggregate([
      {
        $match: {
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
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Revenue analytics
    const revenueAnalytics = await Payment.aggregate([
      {
        $match: {
          status: 'success',
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
          revenue: { $sum: '$amount' },
          bookings: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Vehicle type distribution
    const vehicleDistribution = await Vehicle.aggregate([
      {
        $group: {
          _id: '$vehicleType',
          count: { $sum: 1 }
        }
      }
    ]);

    // Top vendors by revenue
    const topVendors = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$vendor',
          revenue: { $sum: '$amount' },
          bookings: { $sum: 1 }
        }
      },
      {
        $sort: { revenue: -1 }
      },
      {
        $limit: 10
      },
      {
        $lookup: {
          from: 'vendors',
          localField: '_id',
          foreignField: '_id',
          as: 'vendor'
        }
      },
      {
        $unwind: '$vendor'
      },
      {
        $project: {
          'vendor.companyName': 1,
          revenue: 1,
          bookings: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        userGrowth,
        revenueAnalytics,
        vehicleDistribution,
        topVendors,
        period
      }
    });
  } catch (error) {
    console.error('Get system analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system analytics'
    });
  }
};

export const generateFinancialReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Total revenue
    const revenueData = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    // Revenue by payment method
    const revenueByMethod = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          revenue: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Refunds summary
    const refundsSummary = await Payment.aggregate([
      {
        $match: {
          'refundDetails.refundedAmount': { $gt: 0 },
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalRefunds: { $sum: '$refundDetails.refundedAmount' },
          refundCount: { $sum: 1 }
        }
      }
    ]);

    const report = {
      period: {
        startDate: startDate || 'All time',
        endDate: endDate || 'Present'
      },
      summary: {
        totalRevenue: revenueData[0]?.totalRevenue || 0,
        totalTransactions: revenueData[0]?.totalTransactions || 0,
        totalRefunds: refundsSummary[0]?.totalRefunds || 0,
        refundCount: refundsSummary[0]?.refundCount || 0,
        netRevenue: (revenueData[0]?.totalRevenue || 0) - (refundsSummary[0]?.totalRefunds || 0)
      },
      breakdown: {
        byPaymentMethod: revenueByMethod
      }
    };

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Generate financial report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate financial report'
    });
  }
};

export const getUserGrowthReport = async (req, res) => {
  try {
    const { period = 'year' } = req.query;
    let startDate = new Date();

    switch (period) {
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalUsers: { $sum: 1 },
          customers: {
            $sum: { $cond: [{ $eq: ['$role', 'customer'] }, 1, 0] }
          },
          vendors: {
            $sum: { $cond: [{ $eq: ['$role', 'vendor'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        userGrowth,
        period
      }
    });
  } catch (error) {
    console.error('Get user growth report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate user growth report'
    });
  }
};

export const getBookingTrends = async (req, res) => {
  try {
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

    const bookingTrends = await Booking.aggregate([
      {
        $match: {
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
          totalBookings: { $sum: 1 },
          confirmedBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          completedBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cancelledBookings: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          totalRevenue: {
            $sum: {
              $cond: [
                { $in: ['$status', ['confirmed', 'completed']] },
                '$priceBreakdown.totalPayable',
                0
              ]
            }
          }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        bookingTrends,
        period
      }
    });
  } catch (error) {
    console.error('Get booking trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate booking trends report'
    });
  }
};

// System Settings
const systemSettings = {
  platformName: 'Vehicle Rental System',
  platformCommission: 15, // percentage
  maxVehiclesPerVendor: 50,
  minBookingHours: 1,
  maxBookingDays: 30,
  cancellationPolicy: {
    freeCancellationHours: 48,
    cancellationFeePercentage: 50
  },
  contact: {
    supportEmail: 'support@vehiclerental.com',
    supportPhone: '+91-9876543210',
    address: '123 Main Street, Mumbai, India'
  }
};

export const getSystemSettings = async (req, res) => {
  try {
    res.json({
      success: true,
      data: systemSettings
    });
  } catch (error) {
    console.error('Get system settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system settings'
    });
  }
};

export const updateSystemSettings = async (req, res) => {
  try {
    const updates = req.body;

    // Update system settings (in a real app, you'd save to database)
    Object.keys(updates).forEach(key => {
      if (systemSettings[key] !== undefined) {
        if (typeof systemSettings[key] === 'object' && systemSettings[key] !== null) {
          systemSettings[key] = { ...systemSettings[key], ...updates[key] };
        } else {
          systemSettings[key] = updates[key];
        }
      }
    });

    res.json({
      success: true,
      message: 'System settings updated successfully',
      data: systemSettings
    });
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update system settings'
    });
  }
};

// Promo Code Management
export const createPromoCode = async (req, res) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      minBookingAmount,
      maxDiscountAmount,
      validFrom,
      validTill,
      usageLimitPerUser,
      totalUsageLimit,
      applicableVehicleTypes,
      applicableCities
    } = req.body;

    // Check if promo code already exists
    const existingPromo = await PromoCode.findOne({ code: code.toUpperCase() });
    if (existingPromo) {
      return res.status(400).json({
        success: false,
        message: 'Promo code already exists'
      });
    }

    const promoCode = new PromoCode({
      code: code.toUpperCase(),
      description,
      discountType,
      discountValue,
      minBookingAmount,
      maxDiscountAmount,
      validFrom: new Date(validFrom),
      validTill: new Date(validTill),
      usageLimitPerUser,
      totalUsageLimit,
      applicableVehicleTypes,
      applicableCities
    });

    await promoCode.save();

    res.status(201).json({
      success: true,
      message: 'Promo code created successfully',
      data: { promoCode }
    });
  } catch (error) {
    console.error('Create promo code error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create promo code'
    });
  }
};

export const getAllPromoCodes = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    let query = {};

    if (status === 'active') {
      query.isActive = true;
      query.validFrom = { $lte: new Date() };
      query.validTill = { $gte: new Date() };
    } else if (status === 'expired') {
      query.validTill = { $lt: new Date() };
    } else if (status === 'inactive') {
      query.isActive = false;
    }

    const promoCodes = await PromoCode.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await PromoCode.countDocuments(query);

    res.json({
      success: true,
      data: {
        promoCodes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get all promo codes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch promo codes'
    });
  }
};

export const updatePromoCode = async (req, res) => {
  try {
    const updates = req.body;

    const promoCode = await PromoCode.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!promoCode) {
      return res.status(404).json({
        success: false,
        message: 'Promo code not found'
      });
    }

    res.json({
      success: true,
      message: 'Promo code updated successfully',
      data: { promoCode }
    });
  } catch (error) {
    console.error('Update promo code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update promo code'
    });
  }
};

export const deletePromoCode = async (req, res) => {
  try {
    const promoCode = await PromoCode.findByIdAndDelete(req.params.id);

    if (!promoCode) {
      return res.status(404).json({
        success: false,
        message: 'Promo code not found'
      });
    }

    res.json({
      success: true,
      message: 'Promo code deleted successfully'
    });
  } catch (error) {
    console.error('Delete promo code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete promo code'
    });
  }
};


// Enhanced Dashboard with Real-time Metrics
export const getEnhancedDashboard = async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(today.setDate(today.getDate() - 7));
    const startOfMonth = new Date(today.setMonth(today.getMonth() - 1));

    // Real-time metrics
    const [
      todayBookings,
      todayRevenue,
      pendingKYC,
      pendingRefunds,
      activeBookings,
      lowStockVehicles
    ] = await Promise.all([
      // Today's bookings
      Booking.countDocuments({
        createdAt: { $gte: startOfToday }
      }),
      // Today's revenue
      Payment.aggregate([
        {
          $match: {
            status: 'success',
            createdAt: { $gte: startOfToday }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]),
      // Pending KYC approvals
      Vendor.countDocuments({ 'kyc.status': 'pending' }),
      // Pending refunds
      Payment.countDocuments({
        'refundDetails.refundStatus': 'pending'
      }),
      // Active bookings (in progress)
      Booking.countDocuments({
        status: { $in: ['confirmed', 'checked_out', 'in_progress'] }
      }),
      // Vehicles with low availability (less than 3 available days in next week)
      Vehicle.countDocuments({
        isActive: true,
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: '$availabilityBlocks',
                  as: 'block',
                  cond: {
                    $and: [
                      { $gte: ['$$block.start', startOfToday] },
                      { $lte: ['$$block.start', startOfWeek] }
                    ]
                  }
                }
              }
            },
            3
          ]
        }
      })
    ]);

    // Weekly performance
    const weeklyPerformance = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfWeek }
        }
      },
      {
        $group: {
          _id: {
            $dayOfWeek: '$createdAt'
          },
          bookings: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $in: ['$status', ['confirmed', 'completed']] },
                '$priceBreakdown.totalPayable',
                0
              ]
            }
          }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Top performing cities
    const topCities = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth },
          status: { $in: ['confirmed', 'completed'] }
        }
      },
      {
        $group: {
          _id: '$pickup.city',
          bookings: { $sum: 1 },
          revenue: { $sum: '$priceBreakdown.totalPayable' }
        }
      },
      {
        $sort: { revenue: -1 }
      },
      {
        $limit: 5
      }
    ]);

    // Vehicle type performance
    const vehiclePerformance = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth },
          status: { $in: ['confirmed', 'completed'] }
        }
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicle',
          foreignField: '_id',
          as: 'vehicleData'
        }
      },
      {
        $unwind: '$vehicleData'
      },
      {
        $group: {
          _id: '$vehicleData.vehicleType',
          bookings: { $sum: 1 },
          revenue: { $sum: '$priceBreakdown.totalPayable' },
          averageRating: { $avg: '$vehicleData.rating' }
        }
      }
    ]);

    const dashboardData = {
      realTimeMetrics: {
        todayBookings,
        todayRevenue: todayRevenue[0]?.total || 0,
        pendingKYC,
        pendingRefunds,
        activeBookings,
        lowStockVehicles
      },
      weeklyPerformance,
      topCities,
      vehiclePerformance
    };

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Enhanced dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch enhanced dashboard data'
    });
  }
};

// Advanced User Analytics
export const getUserAnalytics = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const userAnalytics = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $facet: {
          // Registration trends
          registrationTrends: [
            {
              $group: {
                _id: {
                  date: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$createdAt'
                    }
                  },
                  role: '$role'
                },
                count: { $sum: 1 }
              }
            },
            {
              $sort: { '_id.date': 1 }
            }
          ],
          // User engagement
          engagement: [
            {
              $lookup: {
                from: 'bookings',
                localField: '_id',
                foreignField: 'customer',
                as: 'userBookings'
              }
            },
            {
              $project: {
                role: 1,
                bookingCount: { $size: '$userBookings' },
                lastLogin: 1,
                isActive: 1
              }
            },
            {
              $group: {
                _id: '$role',
                totalUsers: { $sum: 1 },
                activeUsers: {
                  $sum: { $cond: ['$isActive', 1, 0] }
                },
                usersWithBookings: {
                  $sum: { $cond: [{ $gt: ['$bookingCount', 0] }, 1, 0] }
                },
                averageBookings: { $avg: '$bookingCount' }
              }
            }
          ],
          // Geographic distribution
          geographic: [
            {
              $match: {
                'address.city': { $exists: true, $ne: '' }
              }
            },
            {
              $group: {
                _id: '$address.city',
                userCount: { $sum: 1 }
              }
            },
            {
              $sort: { userCount: -1 }
            },
            {
              $limit: 10
            }
          ]
        }
      }
    ]);

    res.json({
      success: true,
      data: userAnalytics[0],
      period
    });
  } catch (error) {
    console.error('User analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user analytics'
    });
  }
};

// Vendor Performance Analysis
export const getVendorPerformance = async (req, res) => {
  try {
    const { period = 'month', metric = 'revenue' } = req.query;
    let startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const vendorPerformance = await Vendor.aggregate([
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'vendor',
          as: 'vendorPayments'
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: '_id',
          foreignField: 'vendor',
          as: 'vendorBookings'
        }
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: '_id',
          foreignField: 'vendor',
          as: 'vendorVehicles'
        }
      },
      {
        $lookup: {
          from: 'reviews',
          localField: '_id',
          foreignField: 'vendor',
          as: 'vendorReviews'
        }
      },
      {
        $project: {
          companyName: 1,
          contactEmail: 1,
          rating: 1,
          ratingCount: 1,
          isVerified: 1,
          isActive: 1,
          totalRevenue: {
            $sum: {
              $map: {
                input: '$vendorPayments',
                as: 'payment',
                in: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$$payment.status', 'success'] },
                        { $gte: ['$$payment.createdAt', startDate] }
                      ]
                    },
                    '$$payment.amount',
                    0
                  ]
                }
              }
            }
          },
          totalBookings: {
            $size: {
              $filter: {
                input: '$vendorBookings',
                as: 'booking',
                cond: { $gte: ['$$booking.createdAt', startDate] }
              }
            }
          },
          activeVehicles: {
            $size: {
              $filter: {
                input: '$vendorVehicles',
                as: 'vehicle',
                cond: { $eq: ['$$vehicle.isActive', true] }
              }
            }
          },
          averageRating: { $avg: '$vendorReviews.rating' },
          responseRate: {
            $cond: [
              { $gt: [{ $size: '$vendorReviews' }, 0] },
              {
                $divide: [
                  {
                    $size: {
                      $filter: {
                        input: '$vendorReviews',
                        as: 'review',
                        cond: { $ifNull: ['$$review.vendorResponse', false] }
                      }
                    }
                  },
                  { $size: '$vendorReviews' }
                ]
              },
              0
            ]
          },
          completionRate: {
            $cond: [
              { $gt: [{ $size: '$vendorBookings' }, 0] },
              {
                $divide: [
                  {
                    $size: {
                      $filter: {
                        input: '$vendorBookings',
                        as: 'booking',
                        cond: { $eq: ['$$booking.status', 'completed'] }
                      }
                    }
                  },
                  { $size: '$vendorBookings' }
                ]
              },
              0
            ]
          }
        }
      },
      {
        $sort: metric === 'revenue' ? { totalRevenue: -1 } : 
               metric === 'bookings' ? { totalBookings: -1 } : 
               { averageRating: -1 }
      },
      {
        $limit: 20
      }
    ]);

    res.json({
      success: true,
      data: vendorPerformance,
      period,
      metric
    });
  } catch (error) {
    console.error('Vendor performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vendor performance data'
    });
  }
};

// Revenue Analytics with Advanced Metrics
export const getRevenueAnalytics = async (req, res) => {
  try {
    const { period = 'month', breakdown = 'daily' } = req.query;
    let startDate = new Date();
    let groupFormat = '%Y-%m-%d';

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        groupFormat = breakdown === 'daily' ? '%Y-%m-%d' : '%Y-%U';
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        groupFormat = '%Y-%m';
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        groupFormat = '%Y-%m';
        break;
    }

    const revenueAnalytics = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: startDate }
        }
      },
      {
        $facet: {
          // Time-based revenue
          timeSeries: [
            {
              $group: {
                _id: {
                  date: {
                    $dateToString: {
                      format: groupFormat,
                      date: '$createdAt'
                    }
                  }
                },
                revenue: { $sum: '$amount' },
                transactions: { $sum: 1 },
                averageValue: { $avg: '$amount' }
              }
            },
            {
              $sort: { '_id.date': 1 }
            }
          ],
          // Payment method breakdown
          paymentMethods: [
            {
              $group: {
                _id: '$paymentMethod',
                revenue: { $sum: '$amount' },
                count: { $sum: 1 }
              }
            }
          ],
          // Vehicle type revenue
          vehicleTypes: [
            {
              $lookup: {
                from: 'bookings',
                localField: 'booking',
                foreignField: '_id',
                as: 'bookingData'
              }
            },
            {
              $unwind: '$bookingData'
            },
            {
              $lookup: {
                from: 'vehicles',
                localField: 'bookingData.vehicle',
                foreignField: '_id',
                as: 'vehicleData'
              }
            },
            {
              $unwind: '$vehicleData'
            },
            {
              $group: {
                _id: '$vehicleData.vehicleType',
                revenue: { $sum: '$amount' },
                bookings: { $sum: 1 }
              }
            }
          ],
          // City-wise revenue
          cities: [
            {
              $lookup: {
                from: 'bookings',
                localField: 'booking',
                foreignField: '_id',
                as: 'bookingData'
              }
            },
            {
              $unwind: '$bookingData'
            },
            {
              $group: {
                _id: '$bookingData.pickup.city',
                revenue: { $sum: '$amount' },
                bookings: { $sum: 1 }
              }
            },
            {
              $sort: { revenue: -1 }
            },
            {
              $limit: 10
            }
          ]
        }
      }
    ]);

    // Calculate growth metrics
    const previousPeriodStart = new Date(startDate);
    const periodDuration = new Date().getTime() - startDate.getTime();
    previousPeriodStart.setTime(previousPeriodStart.getTime() - periodDuration);

    const previousRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: {
            $gte: previousPeriodStart,
            $lt: startDate
          }
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amount' },
          transactions: { $sum: 1 }
        }
      }
    ]);

    const currentRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$amount' },
          transactions: { $sum: 1 }
        }
      }
    ]);

    const previousRev = previousRevenue[0]?.revenue || 0;
    const currentRev = currentRevenue[0]?.revenue || 0;
    const revenueGrowth = previousRev > 0 ? ((currentRev - previousRev) / previousRev) * 100 : 100;

    res.json({
      success: true,
      data: {
        analytics: revenueAnalytics[0],
        metrics: {
          currentRevenue: currentRev,
          previousRevenue: previousRev,
          revenueGrowth,
          currentTransactions: currentRevenue[0]?.transactions || 0,
          previousTransactions: previousRevenue[0]?.transactions || 0
        },
        period,
        breakdown
      }
    });
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch revenue analytics'
    });
  }
};

// Booking Quality Analysis
export const getBookingQualityMetrics = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    let startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const qualityMetrics = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $facet: {
          // Status distribution
          statusAnalysis: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalAmount: {
                  $sum: '$priceBreakdown.totalPayable'
                }
              }
            }
          ],
          // Cancellation analysis
          cancellationAnalysis: [
            {
              $match: {
                status: 'cancelled'
              }
            },
            {
              $group: {
                _id: '$cancellation.cancelledBy',
                count: { $sum: 1 },
                totalLostRevenue: {
                  $sum: '$priceBreakdown.totalPayable'
                },
                averageCancellationTime: {
                  $avg: {
                    $subtract: [
                      '$cancellation.cancelledAt',
                      '$createdAt'
                    ]
                  }
                }
              }
            }
          ],
          // Duration analysis
          durationAnalysis: [
            {
              $match: {
                status: { $in: ['confirmed', 'completed'] }
              }
            },
            {
              $group: {
                _id: null,
                averageDuration: { $avg: '$duration.days' },
                minDuration: { $min: '$duration.days' },
                maxDuration: { $max: '$duration.days' },
                popularDuration: {
                  $max: {
                    $cond: [
                      { $gte: ['$duration.days', 1] },
                      '$duration.days',
                      null
                    ]
                  }
                }
              }
            }
          ],
          // Late returns and penalties
          penaltyAnalysis: [
            {
              $match: {
                'penalties.lateFee': { $gt: 0 }
              }
            },
            {
              $group: {
                _id: null,
                totalPenalties: { $sum: '$penalties.lateFee' },
                averagePenalty: { $avg: '$penalties.lateFee' },
                count: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    // Customer satisfaction from reviews
    const satisfactionMetrics = await Review.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
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
      },
      {
        $project: {
          averageRating: 1,
          totalReviews: 1,
          fiveStar: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'rating',
                cond: { $eq: ['$$rating', 5] }
              }
            }
          },
          fourStar: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'rating',
                cond: { $eq: ['$$rating', 4] }
              }
            }
          },
          threeStar: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'rating',
                cond: { $eq: ['$$rating', 3] }
              }
            }
          },
          twoStar: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'rating',
                cond: { $eq: ['$$rating', 2] }
              }
            }
          },
          oneStar: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                as: 'rating',
                cond: { $eq: ['$$rating', 1] }
              }
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        bookingMetrics: qualityMetrics[0],
        satisfactionMetrics: satisfactionMetrics[0] || {},
        period
      }
    });
  } catch (error) {
    console.error('Booking quality metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking quality metrics'
    });
  }
};

// Advanced Refund Management
export const getRefundAnalytics = async (req, res) => {
  try {
    const { period = 'month', status } = req.query;
    let startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const refundQuery = {
      'refundDetails.refundedAmount': { $gt: 0 }
    };

    if (status) {
      refundQuery['refundDetails.refundStatus'] = status;
    }

    const refundAnalytics = await Payment.aggregate([
      {
        $match: {
          ...refundQuery,
          createdAt: { $gte: startDate }
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'booking',
          foreignField: '_id',
          as: 'bookingData'
        }
      },
      {
        $unwind: '$bookingData'
      },
      {
        $facet: {
          // Refund trends
          trends: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$refundDetails.refundAt'
                  }
                },
                totalRefunds: { $sum: '$refundDetails.refundedAmount' },
                count: { $sum: 1 },
                averageRefund: { $avg: '$refundDetails.refundedAmount' }
              }
            },
            {
              $sort: { '_id': 1 }
            }
          ],
          // Refund reasons
          reasons: [
            {
              $lookup: {
                from: 'bookings',
                localField: 'booking',
                foreignField: '_id',
                as: 'bookingInfo'
              }
            },
            {
              $unwind: '$bookingInfo'
            },
            {
              $group: {
                _id: '$bookingInfo.cancellation.reason',
                totalAmount: { $sum: '$refundDetails.refundedAmount' },
                count: { $sum: 1 }
              }
            },
            {
              $sort: { totalAmount: -1 }
            }
          ],
          // Refund performance
          performance: [
            {
              $group: {
                _id: '$refundDetails.refundStatus',
                totalAmount: { $sum: '$refundDetails.refundedAmount' },
                count: { $sum: 1 },
                averageProcessingTime: {
                  $avg: {
                    $subtract: [
                      '$refundDetails.refundAt',
                      '$createdAt'
                    ]
                  }
                }
              }
            }
          ]
        }
      }
    ]);

    // Calculate refund rate
    const totalPayments = await Payment.countDocuments({
      status: 'success',
      createdAt: { $gte: startDate }
    });

    const refundedPayments = await Payment.countDocuments({
      ...refundQuery,
      createdAt: { $gte: startDate }
    });

    const refundRate = totalPayments > 0 ? (refundedPayments / totalPayments) * 100 : 0;

    res.json({
      success: true,
      data: {
        analytics: refundAnalytics[0],
        metrics: {
          totalPayments,
          refundedPayments,
          refundRate: Math.round(refundRate * 100) / 100,
          period
        }
      }
    });
  } catch (error) {
    console.error('Refund analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch refund analytics'
    });
  }
};

// System Health Monitoring
export const getSystemHealth = async (req, res) => {
  try {
    const healthMetrics = await Promise.all([
      // Database connectivity
      mongoose.connection.db.admin().ping(),
      // Collection counts
      User.countDocuments(),
      Vehicle.countDocuments(),
      Booking.countDocuments(),
      Payment.countDocuments(),
      // Recent errors (you might want to log errors in a separate collection)
      Notification.countDocuments({
        type: 'system_error',
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }),
      // Pending tasks
      Booking.countDocuments({ status: 'pending_payment' }),
      Vendor.countDocuments({ 'kyc.status': 'pending' }),
      Payment.countDocuments({ 'refundDetails.refundStatus': 'pending' })
    ]);

    const [dbStatus, userCount, vehicleCount, bookingCount, paymentCount, recentErrors, pendingPayments, pendingKYC, pendingRefunds] = healthMetrics;

    // Performance metrics (simplified - in production, use proper monitoring)
    const performanceMetrics = {
      database: {
        status: dbStatus.ok === 1 ? 'healthy' : 'unhealthy',
        responseTime: '≤50ms' // This would come from actual monitoring
      },
      api: {
        averageResponseTime: '120ms',
        uptime: '99.9%',
        lastIncident: '2024-01-15'
      },
      paymentGateway: {
        status: 'operational',
        successRate: '99.2%'
      }
    };

    const systemHealth = {
      metrics: {
        userCount,
        vehicleCount,
        bookingCount,
        paymentCount,
        recentErrors,
        pendingTasks: {
          payments: pendingPayments,
          kyc: pendingKYC,
          refunds: pendingRefunds
        }
      },
      performance: performanceMetrics,
      alerts: recentErrors > 10 ? 'High error rate detected' : 'All systems normal',
      lastChecked: new Date()
    };

    res.json({
      success: true,
      data: systemHealth
    });
  } catch (error) {
    console.error('System health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system health metrics'
    });
  }
};

// Bulk Operations
export const bulkUpdateUserStatus = async (req, res) => {
  try {
    const { userIds, isActive, reason } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User IDs array is required'
      });
    }

    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { isActive }
    );

    // Create notifications for affected users
    const notifications = userIds.map(userId => ({
      toUser: userId,
      type: 'account_status_updated',
      title: 'Account Status Updated',
      message: `Your account has been ${isActive ? 'activated' : 'deactivated'} by admin. ${reason || ''}`,
      data: { isActive, reason }
    }));

    await Notification.insertMany(notifications);

    res.json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} users`,
      data: {
        modifiedCount: result.modifiedCount,
        totalSelected: userIds.length
      }
    });
  } catch (error) {
    console.error('Bulk update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update user status'
    });
  }
};

export const bulkVerifyVendors = async (req, res) => {
  try {
    const { vendorIds, notes } = req.body;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vendor IDs array is required'
      });
    }

    const result = await Vendor.updateMany(
      { _id: { $in: vendorIds } },
      {
        'kyc.status': 'verified',
        'kyc.verifiedAt': new Date(),
        'kyc.notes': notes,
        isVerified: true
      }
    );

    // Update user KYC status
    const vendors = await Vendor.find({ _id: { $in: vendorIds } });
    const userIds = vendors.map(v => v.user);

    await User.updateMany(
      { _id: { $in: userIds } },
      { kycStatus: 'verified' }
    );

    // Create notifications
    const notifications = vendors.map(vendor => ({
      toUser: vendor.user,
      type: 'kyc_verified',
      title: 'KYC Verified',
      message: 'Your KYC documents have been verified successfully',
      data: { vendorId: vendor._id }
    }));

    await Notification.insertMany(notifications);

    res.json({
      success: true,
      message: `Successfully verified ${result.modifiedCount} vendors`,
      data: {
        modifiedCount: result.modifiedCount,
        totalSelected: vendorIds.length
      }
    });
  } catch (error) {
    console.error('Bulk verify vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk verify vendors'
    });
  }
};

// Data Export functionality
export const exportData = async (req, res) => {
  try {
    const { type, format = 'json', startDate, endDate } = req.query;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Export type is required'
      });
    }

    let data;
    const dateFilter = startDate && endDate ? {
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    } : {};

    switch (type) {
      case 'users':
        data = await User.find(dateFilter).select('-passwordHash');
        break;
      case 'vendors':
        data = await Vendor.find(dateFilter).populate('user', 'name email');
        break;
      case 'bookings':
        data = await Booking.find(dateFilter)
          .populate('customer', 'name email')
          .populate('vendor', 'companyName')
          .populate('vehicle', 'title');
        break;
      case 'payments':
        data = await Payment.find(dateFilter)
          .populate('user', 'name email')
          .populate('vendor', 'companyName')
          .populate('booking', 'bookingRef');
        break;
      case 'transactions':
        data = await Transaction.find(dateFilter)
          .populate('user', 'name email')
          .populate('vendor', 'companyName');
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type'
        });
    }

    // Set headers for download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${type}_export_${timestamp}.${format}`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    res.json({
      success: true,
      data: data,
      metadata: {
        type,
        format,
        recordCount: data.length,
        exportedAt: new Date(),
        dateRange: { startDate, endDate }
      }
    });
  } catch (error) {
    console.error('Data export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data'
    });
  }
};

// Audit Log (simplified version)
export const getAuditLog = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, adminId, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    // In a real implementation, you'd have an AuditLog collection
    // For now, we'll use combined data from different collections
    const [userChanges, vendorChanges, bookingChanges, paymentChanges] = await Promise.all([
      User.find({}, 'name email role isActive updatedAt')
        .sort({ updatedAt: -1 })
        .limit(10),
      Vendor.find({}, 'companyName isVerified updatedAt')
        .sort({ updatedAt: -1 })
        .limit(10),
      Booking.find({}, 'bookingRef status updatedAt')
        .sort({ updatedAt: -1 })
        .limit(15),
      Payment.find({}, 'amount status refundDetails updatedAt')
        .sort({ updatedAt: -1 })
        .limit(15)
    ]);

    // Combine and format audit log entries
    const auditLog = [
      ...userChanges.map(user => ({
        timestamp: user.updatedAt,
        action: 'USER_UPDATE',
        target: `User: ${user.name}`,
        details: `Role: ${user.role}, Active: ${user.isActive}`,
        admin: 'system' // In real implementation, track admin who made changes
      })),
      ...vendorChanges.map(vendor => ({
        timestamp: vendor.updatedAt,
        action: 'VENDOR_UPDATE',
        target: `Vendor: ${vendor.companyName}`,
        details: `Verified: ${vendor.isVerified}`,
        admin: 'system'
      })),
      ...bookingChanges.map(booking => ({
        timestamp: booking.updatedAt,
        action: 'BOOKING_UPDATE',
        target: `Booking: ${booking.bookingRef}`,
        details: `Status: ${booking.status}`,
        admin: 'system'
      })),
      ...paymentChanges.map(payment => ({
        timestamp: payment.updatedAt,
        action: 'PAYMENT_UPDATE',
        target: `Payment: ${payment._id}`,
        details: `Amount: ₹${payment.amount}, Status: ${payment.status}`,
        admin: 'system'
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
     .slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: {
        auditLog,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: auditLog.length
        }
      }
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit log'
    });
  }
};









// ==============================================
// USER MANAGEMENT - COMPLETE CRUD OPERATIONS
// ==============================================

// Create new user (admin can create users of any type)
export const createUser = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role,
      address,
      kycStatus,
      preferences
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    // Create user
    const user = new User({
      name,
      email,
      phone,
      passwordHash: password, // In production, hash this password
      role: role || 'customer',
      address,
      kycStatus: kycStatus || 'not_submitted',
      preferences,
      emailVerification: {
        isVerified: true // Admin created users are auto-verified
      }
    });

    await user.save();

    // If user is vendor, create vendor profile
    if (role === 'vendor') {
      const vendor = new Vendor({
        user: user._id,
        companyName: `${name}'s Business`,
        contactPhone: phone,
        contactEmail: email,
        address: address,
        createdAt: new Date()
      });

      await vendor.save();
      
      // Update user with vendor profile reference
      user.vendorProfile = vendor._id;
      await user.save();
    }

    // Remove password hash from response
    const userResponse = user.toObject();
    delete userResponse.passwordHash;

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user: userResponse }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create user'
    });
  }
};

// Get user with detailed information
export const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-passwordHash')
      .populate('vendorProfile')
      .populate({
        path: 'vendorProfile',
        populate: {
          path: 'vehicles',
          model: 'Vehicle'
        }
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's bookings, reviews, and other related data
    const [bookings, payments, reviews] = await Promise.all([
      Booking.find({ customer: user._id })
        .populate('vehicle', 'title vehicleType images')
        .populate('vendor', 'companyName')
        .sort({ createdAt: -1 })
        .limit(10),
      Payment.find({ user: user._id })
        .populate('booking', 'bookingRef')
        .sort({ createdAt: -1 })
        .limit(10),
      Review.find({ reviewer: user._id })
        .populate('vehicle', 'title')
        .populate('vendor', 'companyName')
        .sort({ createdAt: -1 })
        .limit(10)
    ]);

    // If user is vendor, get vendor-specific data
    let vendorData = null;
    if (user.role === 'vendor' && user.vendorProfile) {
      const vendor = await Vendor.findById(user.vendorProfile._id)
        .populate('vehicles')
        .populate({
          path: 'vehicles',
          populate: {
            path: 'bookings',
            model: 'Booking'
          }
        });

      vendorData = {
        totalVehicles: vendor.vehicles?.length || 0,
        totalEarnings: await Payment.aggregate([
          {
            $match: {
              vendor: user.vendorProfile._id,
              status: 'success'
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' }
            }
          }
        ]),
        activeBookings: await Booking.countDocuments({
          vendor: user.vendorProfile._id,
          status: { $in: ['confirmed', 'checked_out', 'in_progress'] }
        })
      };
    }

    res.json({
      success: true,
      data: {
        user,
        statistics: {
          totalBookings: bookings.length,
          totalPayments: payments.length,
          totalReviews: reviews.length,
          ...vendorData
        },
        recentBookings: bookings,
        recentPayments: payments,
        recentReviews: reviews
      }
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user details'
    });
  }
};

// Update user details
export const updateUser = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      role,
      address,
      kycStatus,
      isActive,
      preferences
    } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check for duplicate email/phone
    if (email || phone) {
      const duplicateQuery = {
        _id: { $ne: user._id },
        $or: []
      };

      if (email) duplicateQuery.$or.push({ email });
      if (phone) duplicateQuery.$or.push({ phone });

      const duplicateUser = await User.findOne(duplicateQuery);
      if (duplicateUser) {
        return res.status(400).json({
          success: false,
          message: 'Another user with this email or phone already exists'
        });
      }
    }

    // Update user fields
    const updateFields = {};
    if (name) updateFields.name = name;
    if (email) updateFields.email = email;
    if (phone) updateFields.phone = phone;
    if (role) updateFields.role = role;
    if (address) updateFields.address = address;
    if (kycStatus) updateFields.kycStatus = kycStatus;
    if (typeof isActive === 'boolean') updateFields.isActive = isActive;
    if (preferences) updateFields.preferences = { ...user.preferences, ...preferences };

    // Handle role change to vendor
    if (role === 'vendor' && user.role !== 'vendor') {
      const existingVendor = await Vendor.findOne({ user: user._id });
      if (!existingVendor) {
        const vendor = new Vendor({
          user: user._id,
          companyName: `${user.name}'s Business`,
          contactPhone: user.phone,
          contactEmail: user.email,
          address: user.address,
          createdAt: new Date()
        });
        await vendor.save();
        updateFields.vendorProfile = vendor._id;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    ).select('-passwordHash');

    // Create notification for user
    await Notification.create({
      toUser: user._id,
      type: 'profile_updated',
      title: 'Profile Updated',
      message: 'Your profile has been updated by administrator',
      data: { updatedFields: Object.keys(updateFields) }
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update user'
    });
  }
};

// Delete user (soft delete)
export const deleteUser = async (req, res) => {
  try {
    const { hardDelete = false, reason } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (hardDelete) {
      // Hard delete - remove user completely (use with caution)
      await User.findByIdAndDelete(req.params.id);
      
      // Also delete vendor profile if exists
      if (user.vendorProfile) {
        await Vendor.findByIdAndDelete(user.vendorProfile);
      }

      // Delete user's bookings, payments, etc. (cascade delete)
      await Booking.deleteMany({ customer: user._id });
      await Payment.deleteMany({ user: user._id });
      await Review.deleteMany({ reviewer: user._id });
    } else {
      // Soft delete - mark as inactive
      user.isActive = false;
      user.deactivatedAt = new Date();
      user.deactivationReason = reason || 'Deleted by admin';
      await user.save();
    }

    res.json({
      success: true,
      message: `User ${hardDelete ? 'permanently deleted' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

// Upload user profile picture
export const uploadUserAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete old avatar from Cloudinary if exists
    if (user.avatar) {
      const publicId = user.avatar.split('/').pop().split('.')[0];
      await cloudinaryDelete(`vehicle-rental/profiles/${publicId}`);
    }

    // Upload new avatar
    const result = await cloudinaryUpload(req.file, 'profile');
    
    user.avatar = result.secure_url;
    await user.save();

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      data: { avatar: user.avatar }
    });
  } catch (error) {
    console.error('Upload user avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture'
    });
  }
};

// ==============================================
// VEHICLE MANAGEMENT - COMPLETE CRUD OPERATIONS
// ==============================================

// Create vehicle (admin can create for any vendor or independently)
export const createVehicle = async (req, res) => {
  try {
    const {
      vendorId, // Optional - if admin wants to assign to specific vendor
      title,
      description,
      vehicleType,
      make,
      model,
      year,
      registrationNumber,
      seats,
      transmission,
      fuelType,
      currentOdometerKm,
      pricing,
      policy,
      locations,
      metadata
    } = req.body;

    // Validate required fields
    if (!title || !vehicleType || !pricing?.baseDaily) {
      return res.status(400).json({
        success: false,
        message: 'Title, vehicle type, and base daily price are required'
      });
    }

    let vendor = null;

    // If vendorId is provided, assign to that vendor
    if (vendorId) {
      vendor = await Vendor.findById(vendorId);
      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: 'Vendor not found'
        });
      }
    } else {
      // Create a system vendor for admin-owned vehicles
      vendor = await Vendor.findOne({ companyName: 'System Vehicles' });
      if (!vendor) {
        const systemUser = await User.findOne({ email: 'admin@vehiclerental.com' });
        vendor = new Vendor({
          user: systemUser?._id,
          companyName: 'System Vehicles',
          contactPhone: '+91-0000000000',
          contactEmail: 'system@vehiclerental.com',
          isVerified: true,
          isActive: true,
          createdAt: new Date()
        });
        await vendor.save();
      }
    }

    // Check for duplicate registration number
    if (registrationNumber) {
      const existingVehicle = await Vehicle.findOne({ registrationNumber });
      if (existingVehicle) {
        return res.status(400).json({
          success: false,
          message: 'Vehicle with this registration number already exists'
        });
      }
    }

    // Handle image uploads
    const images = req.body.uploadedFiles || [];

    const vehicle = new Vehicle({
      vendor: vendor._id,
      title,
      description,
      vehicleType,
      make,
      model,
      year: year || new Date().getFullYear(),
      registrationNumber,
      images,
      seats: seats || (vehicleType === 'car' ? 5 : vehicleType === 'bike' ? 2 : 1),
      transmission: transmission || 'manual',
      fuelType: fuelType || 'petrol',
      currentOdometerKm: currentOdometerKm || 0,
      pricing: {
        baseDaily: pricing.baseDaily,
        baseHourly: pricing.baseHourly || pricing.baseDaily / 24,
        weeklyDiscountPercent: pricing.weeklyDiscountPercent || 0,
        monthlyDiscountPercent: pricing.monthlyDiscountPercent || 0,
        extraHourCharge: pricing.extraHourCharge || pricing.baseDaily / 24,
        depositAmount: pricing.depositAmount || pricing.baseDaily * 2
      },
      policy: {
        fuelPolicy: policy?.fuelPolicy || 'full-to-full',
        ageRequirements: {
          minForSelfDrive: policy?.ageRequirements?.minForSelfDrive || 21,
          minForTwoWheeler: policy?.ageRequirements?.minForTwoWheeler || 18
        },
        licenseRequired: policy?.licenseRequired !== false,
        allowedKmPerDay: policy?.allowedKmPerDay || 200,
        extraKmCharge: policy?.extraKmCharge || 10,
        locationRestrictions: {
          allowedStates: policy?.locationRestrictions?.allowedStates || [],
          allowedCities: policy?.locationRestrictions?.allowedCities || []
        },
        termsAndConditions: policy?.termsAndConditions || 'Standard terms and conditions apply'
      },
      locations: locations || [],
      metadata: metadata || {},
      isActive: true,
      createdAt: new Date()
    });

    await vehicle.save();

    // Update vendor's vehicles array
    await Vendor.findByIdAndUpdate(vendor._id, {
      $push: { vehicles: vehicle._id }
    });

    res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: { vehicle }
    });
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create vehicle'
    });
  }
};

// Get vehicle with complete details
export const getVehicleDetails = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id)
      .populate('vendor', 'companyName contactPhone contactEmail rating')
      .populate({
        path: 'vendor',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Get vehicle statistics
    const [bookings, reviews, earnings] = await Promise.all([
      Booking.find({ vehicle: vehicle._id })
        .populate('customer', 'name email')
        .sort({ createdAt: -1 })
        .limit(10),
      Review.find({ vehicle: vehicle._id })
        .populate('reviewer', 'name')
        .sort({ createdAt: -1 })
        .limit(10),
      Payment.aggregate([
        {
          $lookup: {
            from: 'bookings',
            localField: 'booking',
            foreignField: '_id',
            as: 'bookingData'
          }
        },
        {
          $unwind: '$bookingData'
        },
        {
          $match: {
            'bookingData.vehicle': vehicle._id,
            status: 'success'
          }
        },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: '$amount' },
            totalBookings: { $sum: 1 }
          }
        }
      ])
    ]);

    // Calculate availability for next 30 days
    const availability = await calculateVehicleAvailability(vehicle._id);

    res.json({
      success: true,
      data: {
        vehicle,
        statistics: {
          totalBookings: bookings.length,
          totalReviews: reviews.length,
          totalEarnings: earnings[0]?.totalEarnings || 0,
          successRate: bookings.length > 0 ? 
            (bookings.filter(b => b.status === 'completed').length / bookings.length) * 100 : 0
        },
        recentBookings: bookings,
        recentReviews: reviews,
        availability
      }
    });
  } catch (error) {
    console.error('Get vehicle details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle details'
    });
  }
};

// Update vehicle details
export const updateVehicle = async (req, res) => {
  try {
    const {
      title,
      description,
      vehicleType,
      make,
      model,
      year,
      registrationNumber,
      seats,
      transmission,
      fuelType,
      currentOdometerKm,
      pricing,
      policy,
      locations,
      isActive,
      metadata
    } = req.body;

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Check for duplicate registration number
    if (registrationNumber && registrationNumber !== vehicle.registrationNumber) {
      const existingVehicle = await Vehicle.findOne({ registrationNumber });
      if (existingVehicle) {
        return res.status(400).json({
          success: false,
          message: 'Another vehicle with this registration number already exists'
        });
      }
    }

    // Update fields
    const updateFields = {};
    if (title) updateFields.title = title;
    if (description !== undefined) updateFields.description = description;
    if (vehicleType) updateFields.vehicleType = vehicleType;
    if (make) updateFields.make = make;
    if (model) updateFields.model = model;
    if (year) updateFields.year = year;
    if (registrationNumber) updateFields.registrationNumber = registrationNumber;
    if (seats) updateFields.seats = seats;
    if (transmission) updateFields.transmission = transmission;
    if (fuelType) updateFields.fuelType = fuelType;
    if (currentOdometerKm) updateFields.currentOdometerKm = currentOdometerKm;
    if (typeof isActive === 'boolean') updateFields.isActive = isActive;
    if (metadata) updateFields.metadata = { ...vehicle.metadata, ...metadata };

    // Update nested objects
    if (pricing) {
      updateFields.pricing = { ...vehicle.pricing, ...pricing };
    }

    if (policy) {
      updateFields.policy = { ...vehicle.policy, ...policy };
    }

    if (locations) {
      updateFields.locations = locations;
    }

    // Handle image updates
    if (req.body.uploadedFiles) {
      updateFields.images = [...vehicle.images, ...req.body.uploadedFiles];
    }

    const updatedVehicle = await Vehicle.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    ).populate('vendor');

    // Notify vendor about vehicle update
    if (updatedVehicle.vendor?.user) {
      await Notification.create({
        toUser: updatedVehicle.vendor.user,
        type: 'vehicle_updated',
        title: 'Vehicle Updated',
        message: `Vehicle "${updatedVehicle.title}" has been updated by admin`,
        data: { vehicleId: updatedVehicle._id, updatedFields: Object.keys(updateFields) }
      });
    }

    res.json({
      success: true,
      message: 'Vehicle updated successfully',
      data: { vehicle: updatedVehicle }
    });
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update vehicle'
    });
  }
};

// Delete vehicle
export const deleteVehicle = async (req, res) => {
  try {
    const { hardDelete = false, reason } = req.body;

    const vehicle = await Vehicle.findById(req.params.id).populate('vendor');
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    if (hardDelete) {
      // Hard delete - remove vehicle completely
      
      // Delete images from Cloudinary
      for (const imageUrl of vehicle.images) {
        try {
          const publicId = imageUrl.split('/').pop().split('.')[0];
          await cloudinaryDelete(`vehicle-rental/vehicles/${publicId}`);
        } catch (error) {
          console.error('Error deleting image from Cloudinary:', error);
        }
      }

      await Vehicle.findByIdAndDelete(req.params.id);
      
      // Remove from vendor's vehicles array
      if (vehicle.vendor) {
        await Vendor.findByIdAndUpdate(vehicle.vendor._id, {
          $pull: { vehicles: vehicle._id }
        });
      }
    } else {
      // Soft delete - mark as inactive
      vehicle.isActive = false;
      vehicle.deactivationReason = reason || 'Deleted by admin';
      await vehicle.save();
    }

    res.json({
      success: true,
      message: `Vehicle ${hardDelete ? 'permanently deleted' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vehicle'
    });
  }
};

// Upload vehicle images
export const uploadVehicleImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Upload images to Cloudinary
    const uploadPromises = req.files.map(file => 
      cloudinaryUpload(file, 'vehicle')
    );
    
    const results = await Promise.all(uploadPromises);
    const newImageUrls = results.map(result => result.secure_url);

    // Update vehicle with new images
    vehicle.images = [...vehicle.images, ...newImageUrls];
    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle images uploaded successfully',
      data: { 
        newImages: newImageUrls,
        totalImages: vehicle.images.length
      }
    });
  } catch (error) {
    console.error('Upload vehicle images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload vehicle images'
    });
  }
};

// Delete vehicle image
export const deleteVehicleImage = async (req, res) => {
  try {
    const { imageUrl } = req.body;

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Remove image from array
    vehicle.images = vehicle.images.filter(img => img !== imageUrl);
    await vehicle.save();

    // Delete from Cloudinary
    try {
      const publicId = imageUrl.split('/').pop().split('.')[0];
      await cloudinaryDelete(`vehicle-rental/vehicles/${publicId}`);
    } catch (error) {
      console.error('Error deleting image from Cloudinary:', error);
    }

    res.json({
      success: true,
      message: 'Vehicle image deleted successfully',
      data: { remainingImages: vehicle.images.length }
    });
  } catch (error) {
    console.error('Delete vehicle image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vehicle image'
    });
  }
};

// Manage vehicle availability
export const manageVehicleAvailability = async (req, res) => {
  try {
    const { availabilityBlocks, action = 'add' } = req.body;

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    if (action === 'add') {
      // Add availability blocks
      vehicle.availabilityBlocks = [
        ...vehicle.availabilityBlocks,
        ...availabilityBlocks.map(block => ({
          start: new Date(block.start),
          end: new Date(block.end),
          reason: block.reason || 'Admin block'
        }))
      ];
    } else if (action === 'remove') {
      // Remove specific availability blocks
      vehicle.availabilityBlocks = vehicle.availabilityBlocks.filter(block => 
        !availabilityBlocks.some(removeBlock => 
          new Date(removeBlock.start).getTime() === new Date(block.start).getTime() &&
          new Date(removeBlock.end).getTime() === new Date(block.end).getTime()
        )
      );
    } else if (action === 'replace') {
      // Replace all availability blocks
      vehicle.availabilityBlocks = availabilityBlocks.map(block => ({
        start: new Date(block.start),
        end: new Date(block.end),
        reason: block.reason || 'Admin block'
      }));
    }

    await vehicle.save();

    res.json({
      success: true,
      message: `Vehicle availability ${action}ed successfully`,
      data: { availabilityBlocks: vehicle.availabilityBlocks }
    });
  } catch (error) {
    console.error('Manage vehicle availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to manage vehicle availability'
    });
  }
};

// Transfer vehicle to different vendor
export const transferVehicle = async (req, res) => {
  try {
    const { newVendorId } = req.body;

    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const newVendor = await Vendor.findById(newVendorId);
    if (!newVendor) {
      return res.status(404).json({
        success: false,
        message: 'New vendor not found'
      });
    }

    const oldVendorId = vehicle.vendor;

    // Update vehicle vendor
    vehicle.vendor = newVendorId;
    await vehicle.save();

    // Update vendor arrays
    await Vendor.findByIdAndUpdate(oldVendorId, {
      $pull: { vehicles: vehicle._id }
    });

    await Vendor.findByIdAndUpdate(newVendorId, {
      $push: { vehicles: vehicle._id }
    });

    // Notify both vendors
    const [oldVendor, updatedVehicle] = await Promise.all([
      Vendor.findById(oldVendorId).populate('user'),
      Vehicle.findById(vehicle._id).populate('vendor')
    ]);

    if (oldVendor?.user) {
      await Notification.create({
        toUser: oldVendor.user._id,
        type: 'vehicle_transferred',
        title: 'Vehicle Transferred',
        message: `Vehicle "${vehicle.title}" has been transferred to another vendor`,
        data: { vehicleId: vehicle._id, newVendor: newVendor.companyName }
      });
    }

    if (updatedVehicle.vendor?.user) {
      await Notification.create({
        toUser: updatedVehicle.vendor.user._id,
        type: 'vehicle_received',
        title: 'Vehicle Received',
        message: `Vehicle "${vehicle.title}" has been assigned to your vendor account`,
        data: { vehicleId: vehicle._id }
      });
    }

    res.json({
      success: true,
      message: 'Vehicle transferred successfully',
      data: { 
        vehicle: updatedVehicle,
        oldVendor: oldVendor?.companyName,
        newVendor: newVendor.companyName
      }
    });
  } catch (error) {
    console.error('Transfer vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to transfer vehicle'
    });
  }
};

// ==============================================
// HELPER FUNCTIONS
// ==============================================

// Calculate vehicle availability for next 30 days
const calculateVehicleAvailability = async (vehicleId) => {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const bookings = await Booking.find({
    vehicle: vehicleId,
    status: { $in: ['confirmed', 'checked_out', 'in_progress'] },
    $or: [
      { 'pickup.datetime': { $lt: endDate }, 'dropoff.datetime': { $gt: startDate } }
    ]
  });

  const availability = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const isAvailable = !bookings.some(booking => {
      const pickup = new Date(booking.pickup.datetime);
      const dropoff = new Date(booking.dropoff.datetime);
      return currentDate >= pickup && currentDate <= dropoff;
    });

    availability.push({
      date: dateStr,
      available: isAvailable
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return availability;
};

// Get vehicles with advanced filtering
export const getVehiclesWithFilter = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      vehicleType,
      vendorId,
      city,
      minPrice,
      maxPrice,
      transmission,
      fuelType,
      seats,
      status,
      search
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    // Build filter query
    if (vehicleType) query.vehicleType = vehicleType;
    if (vendorId) query.vendor = vendorId;
    if (transmission) query.transmission = transmission;
    if (fuelType) query.fuelType = fuelType;
    if (seats) query.seats = { $gte: parseInt(seats) };
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

    // City filter
    if (city) {
      query['locations.city'] = { $regex: city, $options: 'i' };
    }

    // Price filter
    if (minPrice || maxPrice) {
      query['pricing.baseDaily'] = {};
      if (minPrice) query['pricing.baseDaily'].$gte = parseInt(minPrice);
      if (maxPrice) query['pricing.baseDaily'].$lte = parseInt(maxPrice);
    }

    // Search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { make: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
        { registrationNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const vehicles = await Vehicle.find(query)
      .populate('vendor', 'companyName contactPhone rating')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Vehicle.countDocuments(query);

    // Get aggregation data for statistics
    const stats = await Vehicle.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$vehicleType',
          count: { $sum: 1 },
          averagePrice: { $avg: '$pricing.baseDaily' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        vehicles,
        statistics: stats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get vehicles with filter error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
};