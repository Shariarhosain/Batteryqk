import bookingService from '../services/bookingService.js';
import { getLanguage, translate } from '../utils/i18n.js';
import { validationResult } from 'express-validator';

const bookingController = {
    async createBooking(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ 
                    message: translate('validation_error', getLanguage(req), { errors: errors.array() }) 
                });
            }

            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            const userUid = req.user?.uid;
            
            if (!userUid) {
                return res.status(401).json({
                    success: false,
                    message: translate('unauthorized_no_permission', getLanguage(req))
                });
            }

            // Extract request details for audit logging
            const reqDetails = {
                actorUserId: req.user?.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const booking = await bookingService.createBooking(req.body, userUid, lang, reqDetails);
            
            res.status(201).json({
                success: true,
                message: translate('booking_created', getLanguage(req)),
                data: booking
            });
        } catch (error) {
            console.error('Error creating booking:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async getAllBookings(req, res) {
        try {
            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            
            // Extract filters from query parameters
            const filters = {};
            
            if (req.query.page) filters.page = req.query.page;
            if (req.query.limit) filters.limit = req.query.limit;
            if (req.query.date) filters.date = req.query.date;
            if (req.query.agegroup) filters.agegroup = req.query.agegroup;
            if (req.query.status) filters.status = req.query.status;
            if (req.query.listingId) filters.listingId = req.query.listingId;

            if (req.query.mainCategoryIds) {
                filters.mainCategoryIds = Array.isArray(req.query.mainCategoryIds) 
                    ? req.query.mainCategoryIds 
                    : req.query.mainCategoryIds.split(',');
            }
            
            if (req.query.subCategoryIds) {
                filters.subCategoryIds = Array.isArray(req.query.subCategoryIds)
                    ? req.query.subCategoryIds
                    : req.query.subCategoryIds.split(',');
            }
            
            if (req.query.specificItemIds) {
                filters.specificItemIds = Array.isArray(req.query.specificItemIds)
                    ? req.query.specificItemIds
                    : req.query.specificItemIds.split(',');
            }
            
            if (req.query.minPrice) filters.minPrice = req.query.minPrice;
            if (req.query.maxPrice) filters.maxPrice = req.query.maxPrice;
            
            if (req.query.location) {
                filters.location = Array.isArray(req.query.location)
                    ? req.query.location
                    : req.query.location.split(',');
            }

            const result = await bookingService.getAllBookings(filters, lang);
            
            res.json({
                success: true,
                message: translate('bookings_retrieved', getLanguage(req)),
                data: result.bookings,
                pagination: result.pagination
            });
        } catch (error) {
            console.error('Error fetching bookings:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async getBookingById(req, res) {
        try {
            const { id } = req.params;
            const lang = req.query.lang || req.headers['accept-language'] || 'en';

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({
                    success: false,
                    message: translate('invalid_booking_id', getLanguage(req))
                });
            }

            const booking = await bookingService.getBookingById(id, lang);
            
            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: translate('booking_not_found', getLanguage(req))
                });
            }

            res.json({
                success: true,
                message: translate('booking_retrieved', getLanguage(req)),
                data: booking
            });
        } catch (error) {
            console.error('Error fetching booking:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async getUserBookings(req, res) {
        try {
            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            const userUid = req.user?.uid;
            
            if (!userUid) {
                return res.status(401).json({
                    success: false,
                    message: translate('unauthorized', getLanguage(req))
                });
            }

            const bookings = await bookingService.getBookingsByUserUid(userUid, lang);
            
            res.json({
                success: true,
                message: translate('user_bookings_retrieved', getLanguage(req)),
                data: bookings,
                count: bookings.length
            });
        } catch (error) {
            console.error('Error fetching user bookings:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async updateBooking(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ 
                    message: translate('validation_error', getLanguage(req), { errors: errors.array() }) 
                });
            }

            const { id } = req.params;
            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            
            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({
                    success: false,
                    message: translate('invalid_booking_id', getLanguage(req))
                });
            }

            // Extract request details for audit logging
            const reqDetails = {
                actorUserId: req.user?.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const updatedBooking = await bookingService.updateBooking(id, req.body, lang, reqDetails);
            
            if (!updatedBooking) {
                return res.status(404).json({
                    success: false,
                    message: translate('booking_not_found', getLanguage(req))
                });
            }

            res.json({
                success: true,
                message: translate('booking_updated', getLanguage(req)),
                data: updatedBooking
            });
        } catch (error) {
            console.error('Error updating booking:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async deleteBooking(req, res) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({
                    success: false,
                    message: translate('invalid_booking_id', getLanguage(req))
                });
            }

            // Extract request details for audit logging
            const reqDetails = {
                actorUserId: req.user?.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const deletedBooking = await bookingService.deleteBooking(id, reqDetails);
            
            if (!deletedBooking) {
                return res.status(404).json({
                    success: false,
                    message: translate('booking_not_found', getLanguage(req))
                });
            }

            res.json({
                success: true,
                message: translate('booking_deleted', getLanguage(req)),
                data: deletedBooking
            });
        } catch (error) {
            console.error('Error deleting booking:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
};

export default bookingController;