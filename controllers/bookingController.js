import Booking from '../models/Booking.js';
import Vehicle from '../models/Vehicle.js';
import User from '../models/User.js';
import Vendor from '../models/Vendor.js';
import Payment from '../models/Payment.js';
import PromoCode from '../models/PromoCode.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';

// Calculate booking price
export const calculateBookingPrice = async (req, res) => {
  try {
    const {
      vehicleId,
      pickupDateTime,
      dropoffDateTime,
      promoCode,
      bookingType = 'self-drive',
      driverRequired = false
    } = req.body;

    if (!vehicleId || !pickupDateTime || !dropoffDateTime) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID, pickup date, and dropoff date are required'
      });
    }

    const vehicle = await Vehicle.findById(vehicleId).populate('vendor');
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const pickup = new Date(pickupDateTime);
    const dropoff = new Date(dropoffDateTime);
    
    // Calculate duration in hours and days
    const durationMs = dropoff - pickup;
    const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));
    const durationDays = Math.ceil(durationHours / 24);

    // Calculate base amount
    let baseAmount = 0;
    if (durationDays >= 30 && vehicle.pricing.monthlyDiscountPercent > 0) {
      // Monthly rate with discount
      const monthlyRate = vehicle.pricing.baseDaily * 30;
      const discount = monthlyRate * (vehicle.pricing.monthlyDiscountPercent / 100);
      baseAmount = monthlyRate - discount;
    } else if (durationDays >= 7 && vehicle.pricing.weeklyDiscountPercent > 0) {
      // Weekly rate with discount
      const weeklyRate = vehicle.pricing.baseDaily * 7;
      const discount = weeklyRate * (vehicle.pricing.weeklyDiscountPercent / 100);
      baseAmount = weeklyRate - discount;
    } else {
      // Daily rate
      baseAmount = vehicle.pricing.baseDaily * durationDays;
    }

    // Add hourly charges if any
    if (durationHours % 24 > 0 && vehicle.pricing.extraHourCharge > 0) {
      baseAmount += vehicle.pricing.extraHourCharge * (durationHours % 24);
    }

    // Driver charges
    let driverAmount = 0;
    if (bookingType === 'with-driver' || driverRequired) {
      // Calculate driver charges based on hours
      driverAmount = 100 * durationHours; // ₹100 per hour as base rate
    }

    // Calculate taxes (18% GST)
    const taxes = (baseAmount + driverAmount) * 0.18;

    // Deposit amount
    const depositAmount = vehicle.pricing.depositAmount || 0;

    // Apply promo code discount
    let discount = 0;
    let promoCodeDetails = null;

    if (promoCode) {
      promoCodeDetails = await PromoCode.findOne({ 
        code: promoCode.toUpperCase(),
        isActive: true,
        validFrom: { $lte: new Date() },
        validTill: { $gte: new Date() }
      });

      if (promoCodeDetails) {
        if (promoCodeDetails.discountType === 'percentage') {
          discount = baseAmount * (promoCodeDetails.discountValue / 100);
          // Apply max discount if specified
          if (promoCodeDetails.maxDiscountAmount && discount > promoCodeDetails.maxDiscountAmount) {
            discount = promoCodeDetails.maxDiscountAmount;
          }
        } else {
          discount = promoCodeDetails.discountValue;
        }
      }
    }

    const totalPayable = baseAmount + driverAmount + taxes + depositAmount - discount;

    const priceBreakdown = {
      baseAmount,
      driverAmount,
      taxes: Math.round(taxes),
      discount: Math.round(discount),
      deposit: depositAmount,
      totalPayable: Math.round(totalPayable),
      duration: {
        days: durationDays,
        hours: durationHours
      }
    };

    res.json({
      success: true,
      data: {
        priceBreakdown,
        vehicle: {
          id: vehicle._id,
          title: vehicle.title,
          vehicleType: vehicle.vehicleType,
          image: vehicle.images[0]
        },
        promoCode: promoCodeDetails
      }
    });
  } catch (error) {
    console.error('Calculate booking price error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate booking price'
    });
  }
};

// Check booking availability
export const getBookingAvailability = async (req, res) => {
  try {
    const { vehicleId, pickupDateTime, dropoffDateTime } = req.body;

    if (!vehicleId || !pickupDateTime || !dropoffDateTime) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID, pickup date, and dropoff date are required'
      });
    }

    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const pickup = new Date(pickupDateTime);
    const dropoff = new Date(dropoffDateTime);

    // Check vehicle availability
    const isAvailable = await Booking.isVehicleAvailable(vehicleId, pickup, dropoff);

    // Check vehicle's own availability blocks
    const hasAvailabilityBlock = vehicle.availabilityBlocks.some(block => {
      return block.start <= dropoff && block.end >= pickup;
    });

    const available = isAvailable && !hasAvailabilityBlock;

    res.json({
      success: true,
      data: {
        available,
        vehicleId,
        dates: { pickup, dropoff },
        message: available ? 
          'Vehicle is available for the selected dates' : 
          'Vehicle is not available for the selected dates'
      }
    });
  } catch (error) {
    console.error('Check booking availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check booking availability'
    });
  }
};

// Create booking
export const createBooking = async (req, res) => {
  try {
    const {
      vehicleId,
      pickup,
      dropoff,
      bookingType,
      driverId,
      promoCode,
      notes
    } = req.body;

    // Validate required fields
    if (!vehicleId || !pickup || !dropoff || !pickup.datetime || !dropoff.datetime) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID, pickup, and dropoff details are required'
      });
    }

    const vehicle = await Vehicle.findById(vehicleId).populate('vendor');
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const pickupDateTime = new Date(pickup.datetime);
    const dropoffDateTime = new Date(dropoff.datetime);

    // Check availability
    const isAvailable = await Booking.isVehicleAvailable(vehicleId, pickupDateTime, dropoffDateTime);
    if (!isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is not available for the selected dates'
      });
    }

    // Calculate price
    const priceResponse = await calculateBookingPrice({
      vehicleId,
      pickupDateTime,
      dropoffDateTime,
      promoCode,
      bookingType,
      driverRequired: !!driverId
    });

    if (!priceResponse.success) {
      return res.status(400).json(priceResponse);
    }

    const { priceBreakdown, promoCode: promoCodeDetails } = priceResponse.data;

    // Generate booking reference
    const bookingRef = `BOOK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create booking
    const booking = new Booking({
      bookingRef,
      customer: req.user._id,
      vendor: vehicle.vendor._id,
      vehicle: vehicleId,
      driver: driverId,
      pickup: {
        ...pickup,
        datetime: pickupDateTime
      },
      dropoff: {
        ...dropoff,
        datetime: dropoffDateTime
      },
      bookingType: bookingType || 'self-drive',
      duration: priceBreakdown.duration,
      priceBreakdown,
      promoCode: promoCodeDetails ? promoCodeDetails._id : null,
      notes,
      createdByIP: req.ip
    });

    await booking.save();

    // Create notification for vendor
    await Notification.create({
      toVendor: vehicle.vendor._id,
      type: 'new_booking',
      title: 'New Booking Received',
      message: `New booking #${bookingRef} for ${vehicle.title}`,
      data: { bookingId: booking._id }
    });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking,
        paymentRequired: true
      }
    });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create booking'
    });
  }
};

// Get bookings for user
export const getBookings = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    
    // Determine query based on user role
    if (req.user.role === 'customer') {
      query.customer = req.user._id;
    } else if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (vendor) {
        query.vendor = vendor._id;
      } else {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found'
        });
      }
    }
    // Admin can see all bookings

    if (status) {
      query.status = status;
    }

    const bookings = await Booking.find(query)
      .populate('customer', 'name email phone')
      .populate('vendor', 'companyName contactPhone')
      .populate('vehicle', 'title vehicleType images make model')
      .populate('driver', 'name phone')
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
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
};

// Get booking by ID
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

    // Check access permissions
    if (req.user.role === 'customer' && booking.customer._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (!vendor || booking.vendor._id.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
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

// Update booking status
export const updateBookingStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check vendor access
    if (req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (!vendor || booking.vendor.toString() !== vendor._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    const previousStatus = booking.status;
    booking.status = status;

    // Handle status-specific logic
    if (status === 'cancelled') {
      booking.cancellation = {
        cancelledBy: req.user.role,
        cancelledAt: new Date(),
        reason
      };
    } else if (status === 'completed') {
      // Handle deposit refund
      if (booking.priceBreakdown.deposit > 0) {
        booking.depositRefund = {
          status: 'pending',
          amount: booking.priceBreakdown.deposit
        };
      }
    }

    await booking.save();

    // Create notification for customer
    await Notification.create({
      toUser: booking.customer,
      type: 'booking_status_updated',
      title: 'Booking Status Updated',
      message: `Your booking #${booking.bookingRef} status changed from ${previousStatus} to ${status}`,
      data: { bookingId: booking._id, previousStatus, newStatus: status }
    });

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

// Cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const { reason } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user can cancel this booking
    if (req.user.role === 'customer' && booking.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if booking can be cancelled
    const cancellableStatuses = ['pending_payment', 'confirmed'];
    if (!cancellableStatuses.includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Booking cannot be cancelled in ${booking.status} status`
      });
    }

    // Calculate cancellation fee based on cancellation time
    const pickupTime = new Date(booking.pickup.datetime);
    const now = new Date();
    const hoursUntilPickup = (pickupTime - now) / (1000 * 60 * 60);

    let cancellationFee = 0;
    if (hoursUntilPickup < 24) {
      cancellationFee = booking.priceBreakdown.baseAmount * 0.5; // 50% if less than 24 hours
    } else if (hoursUntilPickup < 48) {
      cancellationFee = booking.priceBreakdown.baseAmount * 0.25; // 25% if less than 48 hours
    }

    booking.status = 'cancelled';
    booking.cancellation = {
      cancelledBy: req.user.role,
      cancelledAt: new Date(),
      cancellationFee,
      reason
    };

    await booking.save();

    // Create notification for vendor
    await Notification.create({
      toVendor: booking.vendor,
      type: 'booking_cancelled',
      title: 'Booking Cancelled',
      message: `Booking #${booking.bookingRef} has been cancelled`,
      data: { bookingId: booking._id, cancelledBy: req.user.role }
    });

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { 
        booking,
        cancellationFee,
        refundAmount: booking.priceBreakdown.totalPayable - cancellationFee
      }
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
};

// Complete booking
export const completeBooking = async (req, res) => {
  try {
    const { penalties, notes } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check vendor access
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor || booking.vendor.toString() !== vendor._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (booking.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be in progress to complete'
      });
    }

    booking.status = 'completed';
    booking.penalties = penalties || {};
    booking.notes = notes;

    // Calculate final amount with penalties
    const finalAmount = booking.priceBreakdown.totalPayable + 
                       (penalties?.lateFee || 0) + 
                       (penalties?.damageDeduction || 0);

    await booking.save();

    // Create transaction for final settlement
    if (finalAmount !== booking.priceBreakdown.totalPayable) {
      await Transaction.create({
        type: 'adjustment',
        relatedBooking: booking._id,
        vendor: booking.vendor,
        amount: finalAmount - booking.priceBreakdown.totalPayable,
        meta: { penalties, notes }
      });
    }

    res.json({
      success: true,
      message: 'Booking completed successfully',
      data: { booking, finalAmount }
    });
  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete booking'
    });
  }
};

// Get booking invoice
export const getBookingInvoice = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customer', 'name email phone address')
      .populate('vendor', 'companyName contactPhone contactEmail address')
      .populate('vehicle', 'title vehicleType make model registrationNumber')
      .populate('payment');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check access permissions
    if (req.user.role === 'customer' && booking.customer._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const invoice = {
      invoiceNumber: booking.bookingRef,
      issueDate: new Date(),
      bookingDate: booking.createdAt,
      customer: booking.customer,
      vendor: booking.vendor,
      vehicle: booking.vehicle,
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      priceBreakdown: booking.priceBreakdown,
      status: booking.status,
      payment: booking.payment
    };

    res.json({
      success: true,
      data: { invoice }
    });
  } catch (error) {
    console.error('Get booking invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice'
    });
  }
};