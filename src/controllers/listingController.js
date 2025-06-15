import listingService from '../services/listingService.js';
import { getLanguage, translate } from '../utils/i18n.js'; // Ensure these are correctly exported from your i18n utility

import { validationResult } from 'express-validator';

const listingController = {
    async createListing(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ message: translate('validation_error', getLanguage(req), { errors: errors.array() }) });
                
            }
           // console.log('Request body:', req.uploadedImages); // Debugging log

            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            const files = req.files;
            console.log('Files received:', files); // Debugging log
            
            // Extract request details for audit logging
            const reqDetails = {
                actorUserId: req.user?.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const listing = await listingService.createListing(req.body, req.files, lang, reqDetails);
            
            res.status(201).json({
                success: true,
                message: translate('listing_created', getLanguage(req), { name: listing.name || listing.id }),
                data: listing
            });
        } catch (error) {
            console.error('Error creating listing:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async getAllListings(req, res) {
        try {
            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            
            // Extract filters from query parameters
            const filters = {};
            if (req.query.search) {
                filters.search = req.query.search;
            }

            if (req.query.page) {
                filters.page = req.query.page;
            }
            if (req.query.limit) {
                filters.limit = req.query.limit;    
            }

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
            
            if (req.query.minPrice) {
                filters.minPrice = req.query.minPrice;
            }

            if(req.query.price){
                filters.price = req.query.price;
                console.log(filters.price);
            }
            
            if (req.query.maxPrice) {
                filters.maxPrice = req.query.maxPrice;
            }
            
            if (req.query.location) {
                filters.location = Array.isArray(req.query.location)
                    ? req.query.location
                    : req.query.location.split(',');
            }
            
            if (req.query.facilities) {
                filters.facilities = Array.isArray(req.query.facilities)
                    ? req.query.facilities
                    : req.query.facilities.split(',');
            }
            
            if (req.query.agegroup) {
                filters.agegroup = Array.isArray(req.query.agegroup)
                    ? req.query.agegroup
                    : req.query.agegroup.split(',');
                    console.log(filters.agegroup);
            }
            if (req.query.rating) {
                filters.rating = req.query.rating;
            }

            const listings = await listingService.getAllListings(filters, lang);
            
            res.json({
                success: true,
                message: translate('listings_retrieved', getLanguage(req)),
                data: listings,
                count: listings.length
            });
        } catch (error) {
            console.error('Error fetching listings:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async getListingById(req, res) {
        try {
            const { id } = req.params;
            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            const files = req.files;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({
                    success: false,
                    message: translate('invalid_listing_id', getLanguage(req))
                });
            }

            const listing = await listingService.getListingById(id, lang);
            
            if (!listing) {
                return res.status(404).json({
                    success: false,
                    message: translate('listing_not_found', getLanguage(req))
                });
            }

            res.json({
                success: true,
                message: translate('listing_retrieved', getLanguage(req)),
                data: listing
            });
        } catch (error) {
            console.error('Error fetching listing:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async updateListing(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return processValidationErrors(res, errors);
            }

            const { id } = req.params;
            const lang = req.query.lang || req.headers['accept-language'] || 'en';
            const files = req.files;
            
            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({
                    success: false,
                    message: translate('invalid_listing_id', getLanguage(req))
                });
            }

            // Extract request details for audit logging
            const reqDetails = {
                actorUserId: req.user?.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const updatedListing = await listingService.updateListing(id, req.body, req.files, lang, reqDetails);
            
            if (!updatedListing) {
                return res.status(404).json({
                    success: false,
                    message: translate('listing_not_found', getLanguage(req))
                });
            }

            res.json({
                success: true,
                message: translate('listing_updated', getLanguage(req), { name: updatedListing.name || updatedListing.id }),
                data: updatedListing
            });
        } catch (error) {
            console.error('Error updating listing:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    },

    async deleteListing(req, res) {
        try {
            const { id } = req.params;
            
            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({
                    success: false,
                    message: translate('invalid_listing_id', getLanguage(req))
                });
            }

            // Extract request details for audit logging
            const reqDetails = {
                actorUserId: req.user?.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const deletedListing = await listingService.deleteListing(id, reqDetails);
            
            if (!deletedListing) {
                return res.status(404).json({
                    success: false,
                    message: translate('error_listing_not_found', getLanguage(req))
                });
            }

            res.json({
                success: true,
                message: translate('listing_deleted', getLanguage(req), { name: deletedListing.name || deletedListing.id }),
                data: deletedListing
            });
        } catch (error) {
            console.error('Error deleting listing:', error);
            res.status(500).json({
                success: false,
                message: translate('internal_server_error', getLanguage(req)),
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
};

export default listingController;
