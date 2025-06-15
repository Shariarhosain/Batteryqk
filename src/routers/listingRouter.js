import express from 'express';
import listingController from '../controllers/listingController.js';
import verifyToken from '../middlewares/verifyToken.js';
import { uploadImages } from '../middlewares/img.js';

const router = express.Router();

// // Middleware to handle image upload
// const handleImageUpload = async (req, res, next) => {
//     if (req.files) {
//         try {
//             // Pass the entire files object to uploadImageFromClient
//             const result = await uploadImageFromClient(req.files);
//             if (result.success) {
//                 req.uploadedImages = result.data;
//             } else {
//                 return res.status(400).json({ error: result.error });
//             }
//         } catch (error) {
//             return res.status(400).json({ error: error.message });
//         }
//     }
//     next();
// };

router.post('/', verifyToken, uploadImages, listingController.createListing);
router.get('/', verifyToken, listingController.getAllListings);
router.get('/:id', verifyToken, listingController.getListingById);
router.put('/:id', verifyToken, uploadImages, listingController.updateListing);
router.delete('/:id', verifyToken, listingController.deleteListing);

export default router;
