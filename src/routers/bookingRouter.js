import express from 'express';
import bookingController from '../controllers/bookingController.js';
import verifyToken from '../middlewares/verifyToken.js';
import { body, param, query } from 'express-validator';

const router = express.Router();


// Routes
router.post('/', verifyToken, bookingController.createBooking);
router.get('/', verifyToken, bookingController.getAllBookings);
router.get('/user', verifyToken, bookingController.getUserBookings);
router.get('/:id', verifyToken, bookingController.getBookingById);
router.put('/:id', verifyToken, bookingController.updateBooking);
router.delete('/:id', verifyToken, bookingController.deleteBooking);

export default router;