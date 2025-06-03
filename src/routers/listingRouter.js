import express from 'express';
import listingController from '../controllers/listingController.js';
import verifyToken from '../middlewares/verifyToken.js';
import { upload } from '../middlewares/multer.js';
import { body, param, query } from 'express-validator';

const router = express.Router();

// Multer configuration for file uploads
const listingUpload = upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'sub_images', maxCount: 10 }
]);



// Routes
router.post('/', verifyToken, listingUpload, listingController.createListing);
router.get('/', verifyToken, listingController.getAllListings);
router.get('/:id', verifyToken, listingController.getListingById);
router.put('/:id', verifyToken, listingUpload, listingController.updateListing);
router.delete('/:id', verifyToken, listingController.deleteListing);

export default router;











