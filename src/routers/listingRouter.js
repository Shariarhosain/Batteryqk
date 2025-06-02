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

// Validation rules for creating listings
const createListingValidation = [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('price').isNumeric().withMessage('Price must be a number'),
    body('mainCategoryId').isInt().withMessage('Main category ID must be an integer'),
    body('subCategoryId').optional().isInt().withMessage('Sub category ID must be an integer'),
    body('specificItemId').optional().isInt().withMessage('Specific item ID must be an integer')
];

// Validation rules for updating listings
const updateListingValidation = [
    param('id').isInt().withMessage('Listing ID must be an integer'),
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('description').optional().notEmpty().withMessage('Description cannot be empty'),
    body('price').optional().isNumeric().withMessage('Price must be a number'),
    body('mainCategoryId').optional().isInt().withMessage('Main category ID must be an integer'),
    body('subCategoryId').optional().isInt().withMessage('Sub category ID must be an integer'),
    body('specificItemId').optional().isInt().withMessage('Specific item ID must be an integer')
];

// Validation for ID parameter
const idValidation = [
    param('id').isInt().withMessage('Listing ID must be an integer')
];

// Query validation for filtering
const queryValidation = [
    query('minPrice').optional().isNumeric().withMessage('Min price must be a number'),
    query('maxPrice').optional().isNumeric().withMessage('Max price must be a number'),
    query('lang').optional().isIn(['en', 'ar']).withMessage('Language must be en or ar')
];

// Routes
router.post('/', verifyToken, listingUpload, createListingValidation, listingController.createListing);
router.get('/', queryValidation, listingController.getAllListings);
router.get('/:id', idValidation, listingController.getListingById);
router.put('/:id', verifyToken, listingUpload, updateListingValidation, listingController.updateListing);
router.delete('/:id', verifyToken, idValidation, listingController.deleteListing);

export default router;











