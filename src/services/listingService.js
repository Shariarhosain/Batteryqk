import prisma from '../utils/prismaClient.js';
import { recordAuditLog } from '../utils/auditLogHandler.js';
import { AuditLogAction } from '@prisma/client';
import { getFileUrl, deleteFile } from '../middlewares/multer.js';
import path from 'path';
import { createClient } from "redis";
import * as deepl from "deepl-node";

// --- DeepL Configuration ---
const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY || "YOUR_DEEPL_AUTH_KEY_HERE";
if (DEEPL_AUTH_KEY === "YOUR_DEEPL_AUTH_KEY_HERE") {
    console.warn("DeepL Auth Key is a placeholder. AR translations may not work. Please configure process.env.DEEPL_AUTH_KEY.");
}
const deeplClient = DEEPL_AUTH_KEY !== "YOUR_DEEPL_AUTH_KEY_HERE" ? new deepl.Translator(DEEPL_AUTH_KEY) : null;

// --- Redis Configuration ---
const REDIS_URL = process.env.REDIS_URL || "redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:PORT";
const AR_CACHE_EXPIRATION = 60 * 60 * 24 * 30; // 30 days

const redisClient = createClient({
    url: REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries >= 3) return false;
            return Math.min(retries * 200, 5000);
        },
    },
});

redisClient.on('error', (err) => console.error('Redis: Listing Cache - Error ->', err.message));

(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('Redis: Listing Cache - Could not connect ->', err.message);
    }
})();

const cacheKeys = {
    listingAr: (listingId) => `listing:${listingId}:ar`,
    allListingsAr: (filterHash = '') => `listings:all${filterHash}:ar`,
};

// --- Helper Functions ---
async function translateText(text, targetLang, sourceLang = null) {
    if (!deeplClient || !text || typeof text !== 'string') {
        return text;
    }
    try {
        const result = await deeplClient.translateText(text, sourceLang, targetLang);
        return result.text;
    } catch (error) {
        console.error(`DeepL Translation error: ${error.message}`);
        return text;
    }
}

async function translateArrayFields(arr, targetLang, sourceLang = null) {
    if (!arr || !Array.isArray(arr)) return arr;
    return await Promise.all(arr.map(item => translateText(item, targetLang, sourceLang)));
}

async function translateListingFields(listing, targetLang, sourceLang = null) {
    if (!listing) return listing;
    
    const translatedListing = { ...listing };
    
    // Translate text fields
    if (listing.name) {
        translatedListing.name = await translateText(listing.name, targetLang, sourceLang);
    }
    if (listing.description) {
        translatedListing.description = await translateText(listing.description, targetLang, sourceLang);
    }
    
    // Translate array fields
    if (listing.agegroup) {
        translatedListing.agegroup = await translateArrayFields(listing.agegroup, targetLang, sourceLang);
    }
    if (listing.location) {
        translatedListing.location = await translateArrayFields(listing.location, targetLang, sourceLang);
    }
    if (listing.facilities) {
        translatedListing.facilities = await translateArrayFields(listing.facilities, targetLang, sourceLang);
    }
    if (listing.operatingHours) {
        translatedListing.operatingHours = await translateArrayFields(listing.operatingHours, targetLang, sourceLang);
    }
    
    // Translate category data if present
    if (listing.selectedMainCategories) {
        translatedListing.selectedMainCategories = await Promise.all(
            listing.selectedMainCategories.map(async (cat) => ({
                ...cat,
                name: await translateText(cat.name, targetLang, sourceLang)
            }))
        );
    }
    if (listing.selectedSubCategories) {
        translatedListing.selectedSubCategories = await Promise.all(
            listing.selectedSubCategories.map(async (cat) => ({
                ...cat,
                name: await translateText(cat.name, targetLang, sourceLang)
            }))
        );
    }
    if (listing.selectedSpecificItems) {
        translatedListing.selectedSpecificItems = await Promise.all(
            listing.selectedSpecificItems.map(async (item) => ({
                ...item,
                name: await translateText(item.name, targetLang, sourceLang)
            }))
        );
    }
    
    return translatedListing;
}

function createFilterHash(filters) {
    const sortedFilters = Object.keys(filters).sort().reduce((result, key) => {
        result[key] = filters[key];
        return result;
    }, {});
    return JSON.stringify(sortedFilters);
}

const listingService = {
  async createListing(data, files, lang = "en", reqDetails = {}) {
    const { name, price, description, agegroup, location, facilities, operatingHours, 
            mainCategoryIds, subCategoryIds, specificItemIds } = data;
    
    let originalData = { ...data };
    let mainImageFilename = null;
    let subImageFilenames = [];

    // Handle file uploads (images don't get translated)
    if (files) {
        if (files.main_image && files.main_image[0]) {
            mainImageFilename = files.main_image[0].filename;
        }
        if (files.sub_images && files.sub_images.length > 0) {
            subImageFilenames = files.sub_images.map(file => file.filename);
        }
    }

    // Prepare data for database (always store in English)
    let listingData = {
        price: price ? parseFloat(price) : null,
        main_image: mainImageFilename ? getFileUrl(mainImageFilename) : null,
        sub_images: subImageFilenames.map(filename => getFileUrl(filename)),
    };

    // Translate text fields if input is Arabic
    if (lang === "ar" && deeplClient) {
        listingData.name = name ? await translateText(name, "EN-US", "AR") : null;
        listingData.description = description ? await translateText(description, "EN-US", "AR") : null;
        listingData.agegroup = agegroup ? await translateArrayFields(agegroup, "EN-US", "AR") : [];
        listingData.location = location ? await translateArrayFields(location, "EN-US", "AR") : [];
        listingData.facilities = facilities ? await translateArrayFields(facilities, "EN-US", "AR") : [];
        listingData.operatingHours = operatingHours ? await translateArrayFields(operatingHours, "EN-US", "AR") : [];
    } else {
        listingData.name = name || null;
        listingData.description = description || null;
        listingData.agegroup = agegroup || [];
        listingData.location = location || [];
        listingData.facilities = facilities || [];
        listingData.operatingHours = operatingHours || [];
    }

    // Create listing
    const newListing = await prisma.listing.create({ 
        data: listingData,
        include: {
            selectedMainCategories: true,
            selectedSubCategories: true,
            selectedSpecificItems: true
        }
    });

    // Connect categories if provided
    if (mainCategoryIds && mainCategoryIds.length > 0) {
        await prisma.listing.update({
            where: { id: newListing.id },
            data: {
                selectedMainCategories: {
                    connect: mainCategoryIds.map(id => ({ id: parseInt(id) }))
                }
            }
        });
    }

    if (subCategoryIds && subCategoryIds.length > 0) {
        await prisma.listing.update({
            where: { id: newListing.id },
            data: {
                selectedSubCategories: {
                    connect: subCategoryIds.map(id => ({ id: parseInt(id) }))
                }
            }
        });
    }

    if (specificItemIds && specificItemIds.length > 0) {
        await prisma.listing.update({
            where: { id: newListing.id },
            data: {
                selectedSpecificItems: {
                    connect: specificItemIds.map(id => ({ id: parseInt(id) }))
                }
            }
        });
    }

    // Get the complete listing with relations
    const completeListing = await prisma.listing.findUnique({
        where: { id: newListing.id },
        include: {
            selectedMainCategories: true,
            selectedSubCategories: true,
            selectedSpecificItems: true
        }
    });

    // Cache Arabic version if needed
    if (redisClient.isReady) {
        try {
            let arListing;
            if (lang === "ar") {
                // Original input was Arabic - use original data with IDs
                arListing = {
                    ...completeListing,
                    name: originalData.name,
                    description: originalData.description,
                    agegroup: originalData.agegroup || [],
                    location: originalData.location || [],
                    facilities: originalData.facilities || [],
                    operatingHours: originalData.operatingHours || []
                };
            } else {
                // Original input was English - translate to Arabic
                arListing = await translateListingFields(completeListing, "AR", "EN");
            }

            await redisClient.setEx(
                cacheKeys.listingAr(newListing.id),
                AR_CACHE_EXPIRATION,
                JSON.stringify(arListing)
            );
            console.log(`Redis: AR Cache - Cached new listing ${newListing.id}`);
        } catch (cacheError) {
            console.error("Redis: AR Cache - Listing caching error ->", cacheError.message);
        }
    }

    recordAuditLog(AuditLogAction.LISTING_CREATED, {
        userId: reqDetails.actorUserId,
        entityName: 'Listing',
        entityId: newListing.id,
        newValues: completeListing,
        description: `Listing '${completeListing.name || completeListing.id}' created.`,
        ipAddress: reqDetails.ipAddress,
        userAgent: reqDetails.userAgent,
    });

    // Return appropriate language version
    if (lang === "ar") {
        return lang === "ar" && originalData.name ? {
            ...completeListing,
            name: originalData.name,
            description: originalData.description,
            agegroup: originalData.agegroup || [],
            location: originalData.location || [],
            facilities: originalData.facilities || [],
            operatingHours: originalData.operatingHours || []
        } : await translateListingFields(completeListing, "AR", "EN");
    }

    return completeListing;
  },

async getAllListings(filters = {}, lang = "en") {
    const filterHash = createFilterHash(filters);
    const cacheKey = cacheKeys.allListingsAr(filterHash);

    // Check Redis cache for Arabic
    if (lang === "ar" && redisClient.isReady) {
            try {
                    const cachedListings = await redisClient.get(cacheKey);
                    if (cachedListings) {
                            console.log("Redis: AR Cache - Fetched all listings from cache");
                            return JSON.parse(cachedListings);
                    }
            } catch (cacheError) {
                    console.error("Redis: AR Cache - Error fetching listings ->", cacheError.message);
            }
    }

    // Build where clause for filtering
    let whereClause = { isActive: true };

    // Filter by main categories
    if (filters.mainCategoryIds && filters.mainCategoryIds.length > 0) {
            whereClause.selectedMainCategories = {
                    some: {
                            id: { in: filters.mainCategoryIds.map(id => parseInt(id)) }
                    }
            };
    }

    // Filter by sub categories
    if (filters.subCategoryIds && filters.subCategoryIds.length > 0) {
            whereClause.selectedSubCategories = {
                    some: {
                            id: { in: filters.subCategoryIds.map(id => parseInt(id)) }
                    }
            };
    }

    // Filter by specific items
    if (filters.specificItemIds && filters.specificItemIds.length > 0) {
            whereClause.selectedSpecificItems = {
                    some: {
                            id: { in: filters.specificItemIds.map(id => parseInt(id)) }
                    }
            };
    }

    // Price range filter
    if (filters.minPrice || filters.maxPrice) {
            whereClause.price = {};
            if (filters.minPrice) whereClause.price.gte = parseFloat(filters.minPrice);
            if (filters.maxPrice) whereClause.price.lte = parseFloat(filters.maxPrice);
    }

    // Location filter - support multiple locations
    if (filters.location) {
            const locations = Array.isArray(filters.location) ? filters.location : [filters.location];
            whereClause.location = {
                    hasSome: locations
            };
    }

    // Facilities filter - support multiple facilities
    if (filters.facilities && filters.facilities.length > 0) {
            const facilitiesArray = Array.isArray(filters.facilities) ? filters.facilities : [filters.facilities];
            whereClause.facilities = {
                    hasSome: facilitiesArray
            };
    }

    // Age group filter - support multiple age groups
    if (filters.agegroup && filters.agegroup.length > 0) {
            const ageGroupArray = Array.isArray(filters.agegroup) ? filters.agegroup : [filters.agegroup];
            whereClause.agegroup = {
                    hasSome: ageGroupArray
            };
    }

    const listings = await prisma.listing.findMany({
            where: whereClause,
            include: {
                    selectedMainCategories: true,
                    selectedSubCategories: true,
                    selectedSpecificItems: true
            },
            orderBy: { createdAt: 'desc' }
    });

    let result = listings;

    // Translate to Arabic if needed
    if (lang === "ar" && deeplClient) {
            result = await Promise.all(
                    listings.map(listing => translateListingFields(listing, "AR", "EN"))
            );

            // Cache the Arabic results
            if (redisClient.isReady) {
                    try {
                            await redisClient.setEx(cacheKey, AR_CACHE_EXPIRATION, JSON.stringify(result));
                            console.log("Redis: AR Cache - Cached all listings");
                    } catch (cacheError) {
                            console.error("Redis: AR Cache - Error caching listings ->", cacheError.message);
                    }
            }
    }

    return result;
},

  async getListingById(id, lang = "en") {
    const listingId = parseInt(id, 10);

    // Check Redis cache for Arabic
    if (lang === "ar" && redisClient.isReady) {
        try {
            const cachedListing = await redisClient.get(cacheKeys.listingAr(listingId));
            if (cachedListing) {
                console.log(`Redis: AR Cache - Fetched listing ${listingId} from cache`);
                return JSON.parse(cachedListing);
            }
        } catch (cacheError) {
            console.error(`Redis: AR Cache - Error fetching listing ${listingId} ->`, cacheError.message);
        }
    }

    const listing = await prisma.listing.findUnique({ 
        where: { id: listingId },
        include: {
            selectedMainCategories: true,
            selectedSubCategories: true,
            selectedSpecificItems: true
        }
    });

    if (!listing) return null;

    // Translate and cache if Arabic
    if (lang === "ar" && deeplClient) {
        const translatedListing = await translateListingFields(listing, "AR", "EN");
        
        if (redisClient.isReady) {
            try {
                await redisClient.setEx(
                    cacheKeys.listingAr(listingId),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(translatedListing)
                );
                console.log(`Redis: AR Cache - Cached listing ${listingId}`);
            } catch (cacheError) {
                console.error(`Redis: AR Cache - Error caching listing ${listingId} ->`, cacheError.message);
            }
        }

        return translatedListing;
    }

    return listing;
  },

  async updateListing(id, data, files, lang = "en", reqDetails = {}) {
    const listingId = parseInt(id, 10);
    const currentListing = await prisma.listing.findUnique({ 
        where: { id: listingId },
        include: {
            selectedMainCategories: true,
            selectedSubCategories: true,
            selectedSpecificItems: true
        }
    });
    
    if (!currentListing) return null;

    const { name, price, description, agegroup, location, facilities, operatingHours, 
            mainCategoryIds, subCategoryIds, specificItemIds, removed_sub_images } = data;
    
    let originalData = { ...data };
    let updateData = {};

    // Handle price
    if (price !== undefined) updateData.price = parseFloat(price);

    // Handle images
    let newMainImageFilename = currentListing.main_image ? 
        path.basename(new URL(currentListing.main_image).pathname) : null;
    let currentSubImageFilenames = currentListing.sub_images.map(url => 
        path.basename(new URL(url).pathname));

    if (files && files.main_image && files.main_image[0]) {
        if (currentListing.main_image) {
            const oldMainImageFilename = path.basename(new URL(currentListing.main_image).pathname);
            deleteFile(oldMainImageFilename);
        }
        newMainImageFilename = files.main_image[0].filename;
        updateData.main_image = getFileUrl(newMainImageFilename);
    }

    // Handle sub-images
    let finalSubImageFilenames = [...currentSubImageFilenames];
    if (removed_sub_images) {
        const imagesToRemove = Array.isArray(removed_sub_images) ? removed_sub_images : [removed_sub_images];
        imagesToRemove.forEach(imgUrlToRemove => {
            const filenameToRemove = path.basename(new URL(imgUrlToRemove).pathname);
            if (deleteFile(filenameToRemove)) {
                finalSubImageFilenames = finalSubImageFilenames.filter(fn => fn !== filenameToRemove);
            }
        });
    }

    if (files && files.sub_images && files.sub_images.length > 0) {
        const newUploadedSubImageFilenames = files.sub_images.map(file => file.filename);
        finalSubImageFilenames.push(...newUploadedSubImageFilenames);
    }
    updateData.sub_images = finalSubImageFilenames.map(filename => getFileUrl(filename));

    // Handle text fields with translation
    if (lang === "ar" && deeplClient) {
        if (name !== undefined) updateData.name = await translateText(name, "EN-US", "AR");
        if (description !== undefined) updateData.description = await translateText(description, "EN-US", "AR");
        if (agegroup !== undefined) updateData.agegroup = await translateArrayFields(agegroup, "EN-US", "AR");
        if (location !== undefined) updateData.location = await translateArrayFields(location, "EN-US", "AR");
        if (facilities !== undefined) updateData.facilities = await translateArrayFields(facilities, "EN-US", "AR");
        if (operatingHours !== undefined) updateData.operatingHours = await translateArrayFields(operatingHours, "EN-US", "AR");
    } else {
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (agegroup !== undefined) updateData.agegroup = agegroup;
        if (location !== undefined) updateData.location = location;
        if (facilities !== undefined) updateData.facilities = facilities;
        if (operatingHours !== undefined) updateData.operatingHours = operatingHours;
    }

    // Update listing
    const updatedListing = await prisma.listing.update({
        where: { id: listingId },
        data: updateData,
        include: {
            selectedMainCategories: true,
            selectedSubCategories: true,
            selectedSpecificItems: true
        }
    });

    // Handle category connections
    if (mainCategoryIds !== undefined) {
        await prisma.listing.update({
            where: { id: listingId },
            data: {
                selectedMainCategories: {
                    set: mainCategoryIds.map(id => ({ id: parseInt(id) }))
                }
            }
        });
    }

    if (subCategoryIds !== undefined) {
        await prisma.listing.update({
            where: { id: listingId },
            data: {
                selectedSubCategories: {
                    set: subCategoryIds.map(id => ({ id: parseInt(id) }))
                }
            }
        });
    }

    if (specificItemIds !== undefined) {
        await prisma.listing.update({
            where: { id: listingId },
            data: {
                selectedSpecificItems: {
                    set: specificItemIds.map(id => ({ id: parseInt(id) }))
                }
            }
        });
    }

    // Get final updated listing
    const finalListing = await prisma.listing.findUnique({
        where: { id: listingId },
        include: {
            selectedMainCategories: true,
            selectedSubCategories: true,
            selectedSpecificItems: true
        }
    });

    // Update Redis cache
    if (redisClient.isReady) {
        try {
            // Clear relevant caches
            await redisClient.del(cacheKeys.listingAr(listingId));
            
            // Clear all listings cache (could be more granular)
            const keys = await redisClient.keys(cacheKeys.allListingsAr('*'));
            if (keys.length > 0) {
                await redisClient.del(keys);
            }

            // Cache updated Arabic version
            let arListing;
            if (lang === "ar") {
                arListing = { ...finalListing };
                Object.keys(originalData).forEach(key => {
                    if (['name', 'description', 'agegroup', 'location', 'facilities', 'operatingHours'].includes(key)) {
                        arListing[key] = originalData[key];
                    }
                });
            } else if (deeplClient) {
                arListing = await translateListingFields(finalListing, "AR", "EN");
            }

            if (arListing) {
                await redisClient.setEx(
                    cacheKeys.listingAr(listingId),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(arListing)
                );
            }
            
            console.log(`Redis: AR Cache - Updated listing ${listingId} cache`);
        } catch (cacheError) {
            console.error(`Redis: AR Cache - Error updating listing ${listingId} ->`, cacheError.message);
        }
    }

    recordAuditLog(AuditLogAction.LISTING_UPDATED, {
        userId: reqDetails.actorUserId,
        entityName: 'Listing',
        entityId: finalListing.id,
        oldValues: currentListing,
        newValues: finalListing,
        description: `Listing '${finalListing.name || finalListing.id}' updated.`,
        ipAddress: reqDetails.ipAddress,
        userAgent: reqDetails.userAgent,
    });

    return finalListing;
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
    
    const deletedListing = await prisma.listing.delete({ where: { id: listingId } });

    // Clear Redis cache
    if (redisClient.isReady) {
        try {
            await redisClient.del(cacheKeys.listingAr(listingId));
            
            // Clear all listings cache
            const keys = await redisClient.keys(cacheKeys.allListingsAr('*'));
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
            
            console.log(`Redis: AR Cache - Deleted listing ${listingId} from cache`);
        } catch (cacheError) {
            console.error(`Redis: AR Cache - Error deleting listing ${listingId} ->`, cacheError.message);
        }
    }

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