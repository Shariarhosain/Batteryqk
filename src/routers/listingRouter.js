import express from 'express';
import listingController from '../controllers/listingController.js';
import verifyToken from '../middlewares/verifyToken.js';
import { upload } from '../middlewares/multer.js'; // Import multer upload middleware

const router = express.Router();

// For creating listings, expect multipart/form-data
// 'main_image' for single file, 'sub_images' for multiple (e.g., up to 5)
const listingUpload = upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'sub_images', maxCount: 10 } // Max 10 sub-images
]);

router.post('/', verifyToken, listingUpload, listingController.createListing);
router.get('/', listingController.getAllListings); // Publicly viewable
router.get('/:id', listingController.getListingById); // Publicly viewable

router.put('/:id', verifyToken, listingUpload, listingController.updateListing);
router.delete('/:id', verifyToken, listingController.deleteListing);

export default router;