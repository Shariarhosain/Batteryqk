import listingService from '../services/listingService.js';
import { getLanguage, translate } from '../utils/i18n.js';
import { UPLOAD_DIR } from '../middlewares/multer.js'; // For serving static files if needed
import fs from 'fs'; // For deleting files if an operation fails mid-way (more complex rollback)
import path from 'path';

const listingController = {
  async createListing(req, res, next) {
    const lang = getLanguage(req);
    try {
      const reqDetails = {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          actorUserId: req.user?.id // Assuming creator is logged in user
      };
      // req.files will be populated by multer: e.g., { main_image: [file1], sub_images: [file2, file3] }
      const newListing = await listingService.createListing(req.body, req.files, reqDetails);
      res.status(201).json({
        message: translate('listing_created', lang, { name: newListing.name || newListing.id }),
        data: newListing
      });
    } catch (error) {
      // If listing creation fails after files are uploaded, you might want to delete them.
      // This is a simplified cleanup. For robust solutions, use transaction-like patterns or cleanup jobs.
      if (req.files) {
        if (req.files.main_image) req.files.main_image.forEach(file => fs.unlink(path.join(UPLOAD_DIR, file.filename), err => { if (err) console.error("Cleanup failed for main image:", file.filename, err);}));
        if (req.files.sub_images) req.files.sub_images.forEach(file => fs.unlink(path.join(UPLOAD_DIR, file.filename), err => { if (err) console.error("Cleanup failed for sub image:", file.filename, err);}));
      }
      next(error);
    }
  },

  async getAllListings(req, res, next) {
    try {
      // Pass query params for filtering if implemented in service
      const listings = await listingService.getAllListings(req.query);
      res.status(200).json(listings);
    } catch (error) {
      next(error);
    }
  },

  async getListingById(req, res, next) {
    const lang = getLanguage(req);
    try {
      const listing = await listingService.getListingById(req.params.id);
      if (!listing) {
        return res.status(404).json({ message: translate('listing_not_found', lang) });
      }
      res.status(200).json(listing);
    } catch (error) {
      next(error);
    }
  },

  async updateListing(req, res, next) {
    const lang = getLanguage(req);
    try {
      const reqDetails = {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          actorUserId: req.user?.id
      };
      // req.body might contain 'removed_sub_images' as an array of URLs/filenames to delete.
      // req.files for new/updated images.
      const updatedListing = await listingService.updateListing(req.params.id, req.body, req.files, reqDetails);
      if (!updatedListing) {
        return res.status(404).json({ message: translate('listing_not_found', lang) });
      }
      res.status(200).json({
        message: translate('listing_updated', lang, { name: updatedListing.name || updatedListing.id }),
        data: updatedListing
      });
    } catch (error) {
       // Basic cleanup if update fails after new files uploaded
      if (req.files) {
        if (req.files.main_image) req.files.main_image.forEach(file => fs.unlink(path.join(UPLOAD_DIR, file.filename), err => { if (err) console.error("Cleanup failed for main image:", file.filename, err);}));
        if (req.files.sub_images) req.files.sub_images.forEach(file => fs.unlink(path.join(UPLOAD_DIR, file.filename), err => { if (err) console.error("Cleanup failed for sub image:", file.filename, err);}));
      }
      next(error);
    }
  },

  async deleteListing(req, res, next) {
    const lang = getLanguage(req);
    try {
      const reqDetails = {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          actorUserId: req.user?.id
      };
      const deletedListing = await listingService.deleteListing(req.params.id, reqDetails);
      if (!deletedListing) {
        return res.status(404).json({ message: translate('listing_not_found', lang) });
      }
      res.status(200).json({ message: translate('listing_deleted', lang) });
    } catch (error) {
      next(error);
    }
  },
};

export default listingController;