import express from 'express';
import {
  createVehicle,
  getVehicles, // Add this import
  getVehicleById,
  updateVehicle,
  deleteVehicle,
  uploadVehicleImages,
  deleteVehicleImage,
  getVehicleAvailability,
  updateVehicleAvailability,
  searchVehicles
} from '../controllers/vehicleController.js';
import { authMiddleware, requireVendor, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import { uploadMiddleware, handleMultipleCloudinaryUpload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public routes
router.get('/', searchVehicles);
router.get('/:id', optionalAuthMiddleware, getVehicleById);
router.get('/:id/availability', getVehicleAvailability);

// Vendor protected routes
router.use(authMiddleware, requireVendor);

// Add the getVehicles route for vendors
router.get('/vendor/vehicles', getVehicles); // This route is for vendors to see their vehicles
router.post('/', createVehicle);
router.put('/:id', updateVehicle);
router.delete('/:id', deleteVehicle);
router.post('/:id/images', 
  uploadMiddleware.array('images', 10),
  handleMultipleCloudinaryUpload('images', 'vehicles'),
  uploadVehicleImages
);
router.delete('/:id/images/:imageIndex', deleteVehicleImage);
router.patch('/:id/availability', updateVehicleAvailability);

export default router;