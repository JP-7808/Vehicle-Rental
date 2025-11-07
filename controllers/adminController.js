import User from '../models/User.js';
import Vendor from '../models/Vendor.js';
import Vehicle from '../models/Vehicle.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Transaction from '../models/Transaction.js';
import PromoCode from '../models/PromoCode.js';
import Notification from '../models/Notification.js';
import { createRefund } from '../config/razorpay.js';

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
    const user = await User.findById(req.params.id)
      .select('-passwordHash')
      .populate('vendorProfile');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's bookings if any
    const userBookings = await Booking.find({ customer: user._id })
      .populate('vehicle', 'title vehicleType')
      .populate('vendor', 'companyName')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        user,
        recentBookings: userBookings
      }
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
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