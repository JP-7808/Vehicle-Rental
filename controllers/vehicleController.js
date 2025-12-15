import Vehicle from '../models/Vehicle.js';
import Vendor from '../models/Vendor.js';
import Booking from '../models/Booking.js';
import { cloudinaryDelete, extractPublicId } from '../config/cloudinary.js';

// Get all vehicles (for vendors to see their vehicles)
export const getVehicles = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const { page = 1, limit = 10, status, search } = req.query;
    const skip = (page - 1) * limit;

    let query = { vendor: vendor._id };

    // Filter by status
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

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
      .populate('vendor', 'companyName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Vehicle.countDocuments(query);

    // Get vehicle statistics
    const stats = await Vehicle.aggregate([
      {
        $match: { vendor: vendor._id }
      },
      {
        $group: {
          _id: null,
          totalVehicles: { $sum: 1 },
          activeVehicles: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          inactiveVehicles: {
            $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        vehicles,
        statistics: stats[0] || {
          totalVehicles: 0,
          activeVehicles: 0,
          inactiveVehicles: 0
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
    console.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
};

// Search vehicles (Public route)
export const searchVehicles = async (req, res) => {
  try {
    const {
      city,
      vehicleType,
      make,
      model,
      minPrice,
      maxPrice,
      transmission,
      fuelType,
      seats,
      startDate,
      endDate,
      page = 1,
      limit = 12,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { isActive: true };

    // Location filter
    if (city) {
      query['locations.city'] = new RegExp(city, 'i');
    }

    // Vehicle type filter
    if (vehicleType) {
      query.vehicleType = vehicleType;
    }

    // Make and model filters
    if (make) query.make = new RegExp(make, 'i');
    if (model) query.model = new RegExp(model, 'i');

    // Transmission filter
    if (transmission) query.transmission = transmission;

    // Fuel type filter
    if (fuelType) query.fuelType = fuelType;

    // Seats filter
    if (seats) query.seats = { $gte: parseInt(seats) };

    // Price range filter
    if (minPrice || maxPrice) {
      query['pricing.baseDaily'] = {};
      if (minPrice) query['pricing.baseDaily'].$gte = parseInt(minPrice);
      if (maxPrice) query['pricing.baseDaily'].$lte = parseInt(maxPrice);
    }

    // Availability filter
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Find vehicles that don't have overlapping bookings
      const overlappingBookings = await Booking.find({
        status: { $in: ['confirmed', 'checked_out', 'in_progress'] },
        $or: [
          { 'pickup.datetime': { $lt: end }, 'dropoff.datetime': { $gt: start } }
        ]
      }).distinct('vehicle');

      query._id = { $nin: overlappingBookings };

      // Also check vehicle's own availability blocks
      query.$and = [
        {
          $or: [
            { availabilityBlocks: { $size: 0 } },
            {
              availabilityBlocks: {
                $not: {
                  $elemMatch: {
                    start: { $lte: end },
                    end: { $gte: start }
                  }
                }
              }
            }
          ]
        }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const vehicles = await Vehicle.find(query)
      .populate('vendor', 'companyName rating ratingCount contactPhone')
      .skip(skip)
      .limit(parseInt(limit))
      .sort(sort);

    const total = await Vehicle.countDocuments(query);

    // Calculate total pages
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        vehicles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages
        },
        filters: {
          city,
          vehicleType,
          make,
          model,
          minPrice,
          maxPrice,
          transmission,
          fuelType,
          seats,
          startDate,
          endDate
        }
      }
    });
  } catch (error) {
    console.error('Search vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search vehicles'
    });
  }
};


// Get distinct cities for autocomplete
export const searchCities = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 1) {
      return res.json({
        success: true,
        data: []
      });
    }

    const regex = new RegExp(q.trim(), 'i');

    // Find distinct cities where vehicles are active
    const cities = await Vehicle.distinct('locations.city', {
      isActive: true,
      'locations.city': { $regex: regex }
    });

    // Optional: sort alphabetically and limit results
    const sortedCities = cities
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 10); // Limit to 10 suggestions

    res.json({
      success: true,
      data: sortedCities
    });
  } catch (error) {
    console.error('Search cities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cities'
    });
  }
};


// Get vehicle by ID
export const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id)
      .populate('vendor', 'companyName rating ratingCount contactPhone contactEmail address');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // If user is authenticated and is the vendor, include additional info
    if (req.user && req.user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: req.user._id });
      if (vendor && vehicle.vendor._id.toString() === vendor._id.toString()) {
        // Include booking statistics for vendor
        const bookingStats = await Booking.aggregate([
          {
            $match: { vehicle: vehicle._id }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]);

        vehicle._doc.bookingStats = bookingStats;
      }
    }

    res.json({
      success: true,
      data: { vehicle }
    });
  } catch (error) {
    console.error('Get vehicle by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle'
    });
  }
};

// Create vehicle
export const createVehicle = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

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
      metadata
    } = req.body;

    // Check if registration number already exists
    if (registrationNumber) {
      const existingVehicle = await Vehicle.findOne({ registrationNumber });
      if (existingVehicle) {
        return res.status(400).json({
          success: false,
          message: 'Vehicle with this registration number already exists'
        });
      }
    }

    const vehicle = new Vehicle({
      vendor: vendor._id,
      title,
      description,
      vehicleType,
      make,
      model,
      year,
      registrationNumber,
      seats,
      transmission: transmission || 'manual',
      fuelType,
      currentOdometerKm: currentOdometerKm || 0,
      pricing,
      policy,
      locations,
      metadata,
      createdAt: new Date()
    });

    await vehicle.save();

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

// Update vehicle
export const updateVehicle = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      vendor: vendor._id
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or access denied'
      });
    }

    const updates = { ...req.body };
    
    // Don't allow updating vendor field
    delete updates.vendor;
    
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) {
        vehicle[key] = updates[key];
      }
    });

    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle updated successfully',
      data: { vehicle }
    });
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle'
    });
  }
};

// Delete vehicle (soft delete)
export const deleteVehicle = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      vendor: vendor._id
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or access denied'
      });
    }

    // Soft delete by setting isActive to false
    vehicle.isActive = false;
    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle deleted successfully'
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
// Upload vehicle images
export const uploadVehicleImages = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      vendor: vendor._id
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or access denied'
      });
    }

    // If no files were uploaded, return current images
    if (!req.body.images || !Array.isArray(req.body.images) || req.body.images.length === 0) {
      return res.json({
        success: true,
        message: 'No new images uploaded',
        data: { images: vehicle.images }
      });
    }

    // Append new image URLs to existing images array
    const newImageUrls = req.body.images;
    vehicle.images = [...vehicle.images, ...newImageUrls];

    // Optional: limit total images (e.g., max 10)
    const MAX_IMAGES = 10;
    if (vehicle.images.length > MAX_IMAGES) {
      // Remove oldest images if exceeding limit
      vehicle.images = vehicle.images.slice(-MAX_IMAGES);
    }

    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle images uploaded successfully',
      data: { images: vehicle.images }
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
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      vendor: vendor._id
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or access denied'
      });
    }

    const imageIndex = parseInt(req.params.imageIndex);
    if (imageIndex < 0 || imageIndex >= vehicle.images.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image index'
      });
    }

    const imageUrl = vehicle.images[imageIndex];
    
    // Delete from Cloudinary
    try {
      const publicId = extractPublicId(imageUrl);
      if (publicId) {
        await cloudinaryDelete(publicId);
      }
    } catch (cloudinaryError) {
      console.error('Cloudinary delete error:', cloudinaryError);
      // Continue with deletion from database even if Cloudinary fails
    }

    // Remove from array
    vehicle.images.splice(imageIndex, 1);
    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle image deleted successfully',
      data: { images: vehicle.images }
    });
  } catch (error) {
    console.error('Delete vehicle image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vehicle image'
    });
  }
};

// Get vehicle availability
export const getVehicleAvailability = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Check availability
    const isAvailable = await Booking.isVehicleAvailable(vehicle._id, start, end);

    // Check vehicle's own availability blocks
    const hasAvailabilityBlock = vehicle.availabilityBlocks.some(block => {
      return block.start <= end && block.end >= start;
    });

    const available = isAvailable && !hasAvailabilityBlock;

    res.json({
      success: true,
      data: {
        available,
        vehicleId: vehicle._id,
        dates: { start, end },
        availabilityBlocks: vehicle.availabilityBlocks,
        message: available ? 
          'Vehicle is available for the selected dates' : 
          'Vehicle is not available for the selected dates'
      }
    });
  } catch (error) {
    console.error('Get vehicle availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check vehicle availability'
    });
  }
};

// Update vehicle availability
export const updateVehicleAvailability = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ user: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      vendor: vendor._id
    });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or access denied'
      });
    }

    const { availabilityBlocks } = req.body;

    if (availabilityBlocks) {
      vehicle.availabilityBlocks = availabilityBlocks;
    }

    await vehicle.save();

    res.json({
      success: true,
      message: 'Vehicle availability updated successfully',
      data: { availabilityBlocks: vehicle.availabilityBlocks }
    });
  } catch (error) {
    console.error('Update vehicle availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle availability'
    });
  }
};