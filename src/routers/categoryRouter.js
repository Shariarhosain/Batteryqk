import express from 'express';
import categoryController from '../controllers/categoryController.js';
import verifyToken from '../middlewares/verifyToken.js'; // Typically admin routes

const router = express.Router();

// These routes are usually for admin users
router.use(verifyToken); // Protect all category routes

router.post('/', categoryController.createCategory);
router.get('/', categoryController.getAllCategories); // Can be public if needed, then move verifyToken per route
router.get('/:id', categoryController.getCategoryById);
router.put('/:id', categoryController.updateCategory);
router.delete('/:id', categoryController.deleteCategory);

// --- Granular DELETE Routes (Must be before general '/:id' routes) ---
router.delete('/sub/:id', categoryController.deleteSubCategory);
router.delete('/specific/:id', categoryController.deleteSpecificItem);

export default router;