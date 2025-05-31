import prisma from '../utils/prismaClient.js';
import { recordAuditLog } from '../utils/auditLogHandler.js';
import { AuditLogAction } from '@prisma/client';
import { getFileUrl, deleteFile } from '../middlewares/multer.js'; // For handling file URLs and deletions
import path from 'path'; // to extract original filename for deletion

const listingService = {
  async createListing(data, files, reqDetails = {}) {
    const { name, categoryId, price, description } = data;
    let mainImageFilename = null;
    let subImageFilenames = [];

    if (files) {
        if (files.main_image && files.main_image[0]) {
            mainImageFilename = files.main_image[0].filename;
        }
        if (files.sub_images && files.sub_images.length > 0) {
            subImageFilenames = files.sub_images.map(file => file.filename);
        }
    }
    
    const listingData = {
      name,
      price: price ? parseFloat(price) : null,
      description,
      main_image: mainImageFilename ? getFileUrl(mainImageFilename) : null,
      sub_images: subImageFilenames.map(filename => getFileUrl(filename)),
    };
    if (categoryId) {
        listingData.categoryId = parseInt(categoryId);
    }


    const newListing = await prisma.listing.create({ data: listingData });

    recordAuditLog(AuditLogAction.LISTING_CREATED, {
        userId: reqDetails.actorUserId,
        entityName: 'Listing',
        entityId: newListing.id,
        newValues: newListing,
        description: `Listing '${newListing.name || newListing.id}' created.`,
        ipAddress: reqDetails.ipAddress,
        userAgent: reqDetails.userAgent,
    });
    return newListing;
  },

  async getAllListings(filters = {}) {
    // Add filtering/pagination logic here if needed
    return prisma.listing.findMany({ include: { category: true } });
  },

  async getListingById(id) {
    const listingId = parseInt(id, 10);
    return prisma.listing.findUnique({ 
        where: { id: listingId },
        include: { category: true } 
    });
  },

  async updateListing(id, data, files, reqDetails = {}) {
    const listingId = parseInt(id, 10);
    const currentListing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!currentListing) return null;

    const { name, categoryId, price, description, removed_sub_images } = data;
    let updateData = { name, description };

    if (price !== undefined) updateData.price = parseFloat(price);
    if (categoryId !== undefined) updateData.categoryId = categoryId ? parseInt(categoryId) : null;


    let newMainImageFilename = currentListing.main_image ? path.basename(new URL(currentListing.main_image).pathname) : null;
    let currentSubImageFilenames = currentListing.sub_images.map(url => path.basename(new URL(url).pathname));


    // Handle main image update
    if (files && files.main_image && files.main_image[0]) {
        if (currentListing.main_image) { // Delete old main image if exists
            const oldMainImageFilename = path.basename(new URL(currentListing.main_image).pathname);
            deleteFile(oldMainImageFilename);
        }
        newMainImageFilename = files.main_image[0].filename;
        updateData.main_image = getFileUrl(newMainImageFilename);
    }


    // Handle sub-images: remove specified, add new
    let finalSubImageFilenames = [...currentSubImageFilenames];

    // Remove images marked for deletion
    if (removed_sub_images) {
        const imagesToRemove = Array.isArray(removed_sub_images) ? removed_sub_images : [removed_sub_images];
        imagesToRemove.forEach(imgUrlToRemove => {
            const filenameToRemove = path.basename(new URL(imgUrlToRemove).pathname);
            if (deleteFile(filenameToRemove)) {
                finalSubImageFilenames = finalSubImageFilenames.filter(fn => fn !== filenameToRemove);
            }
        });
    }
    
    // Add new sub-images
    if (files && files.sub_images && files.sub_images.length > 0) {
        const newUploadedSubImageFilenames = files.sub_images.map(file => file.filename);
        finalSubImageFilenames.push(...newUploadedSubImageFilenames);
    }
    
    updateData.sub_images = finalSubImageFilenames.map(filename => getFileUrl(filename));


    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: updateData,
    });

    recordAuditLog(AuditLogAction.LISTING_UPDATED, {
        userId: reqDetails.actorUserId,
        entityName: 'Listing',
        entityId: updatedListing.id,
        oldValues: currentListing,
        newValues: updatedListing,
        description: `Listing '${updatedListing.name || updatedListing.id}' updated.`,
        ipAddress: reqDetails.ipAddress,
        userAgent: reqDetails.userAgent,
    });
    return updatedListing;
  },

  async deleteListing(id, reqDetails = {}) {
    const listingId = parseInt(id, 10);
    const listing = await prisma.listing.findUnique({ where: { id: listingId }});
    if (!listing) return null;

    // Delete associated images from storage
    if (listing.main_image) {
        deleteFile(path.basename(new URL(listing.main_image).pathname));
    }
    if (listing.sub_images && listing.sub_images.length > 0) {
        listing.sub_images.forEach(imageUrl => {
            deleteFile(path.basename(new URL(imageUrl).pathname));
        });
    }
    
    // Prisma schema handles onDelete: SetNull for Booking.listingId
    const deletedListing = await prisma.listing.delete({ where: { id: listingId } });

    recordAuditLog(AuditLogAction.LISTING_DELETED, {
        userId: reqDetails.actorUserId,
        entityName: 'Listing',
        entityId: listing.id,
        oldValues: listing,
        description: `Listing '${listing.name || listing.id}' deleted.`,
        ipAddress: reqDetails.ipAddress,
        userAgent: reqDetails.userAgent,
    });
    return deletedListing;
  },
};

export default listingService;