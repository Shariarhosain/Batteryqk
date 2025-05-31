import prisma from "../utils/prismaClient.js";
import { recordAuditLog } from "../utils/auditLogHandler.js";
import { AuditLogAction } from "@prisma/client";
import { createClient } from "redis";
import * as deepl from "deepl-node"; // 'deepl-node' library

// --- DeepL Configuration ---
const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY || "YOUR_DEEPL_AUTH_KEY_HERE";
if (DEEPL_AUTH_KEY === "YOUR_DEEPL_AUTH_KEY_HERE") {
    console.warn("DeepL Auth Key is a placeholder. AR translations may not work. Please configure process.env.DEEPL_AUTH_KEY.");
}
const deeplClient = DEEPL_AUTH_KEY !== "YOUR_DEEPL_AUTH_KEY_HERE" ? new deepl.Translator(DEEPL_AUTH_KEY) : null;

// --- Redis Configuration ---
const REDIS_URL = process.env.REDIS_URL || "redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:PORT";
if (REDIS_URL.includes("YOUR_REDIS_PASSWORD") || REDIS_URL.includes("YOUR_REDIS_HOST")) {
    console.warn("Redis URL seems to contain placeholder values. Please configure process.env.REDIS_URL for AR caching.");
}
const AR_CACHE_EXPIRATION = 60 * 60 * 24 * 30; // 30 days

const redisClient = createClient({
    url: REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            console.log(`Redis: AR Category Cache - Attempting to reconnect. Retry: ${retries + 1}`);
            if (retries >= 3) {
                console.error("Redis: AR Category Cache - Max reconnect retries reached. Stopping retries.");
                return false; // Stop retrying
            }
            return Math.min(retries * 200, 5000); // Exponential backoff
        },
    },
});

redisClient.on('connecting', () => console.log('Redis: AR Category Cache - Connecting...'));
redisClient.on('ready', () => console.log('Redis: AR Category Cache - Client is ready.'));
redisClient.on('error', (err) => console.error('Redis: AR Category Cache - Client Error ->', err.message));
redisClient.on('end', () => console.log('Redis: AR Category Cache - Connection ended.'));

(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('Redis: AR Category Cache - Could not connect on initial attempt ->', err.message);
    }
})();

const cacheKeys = {
    categoryAr: (id) => `category:${id}:ar`,
    allCategoriesAr: () => `categories:all_formatted:ar`,
};

// Fields from the Category model that are translatable
const TRANSLATABLE_FIELDS_CONFIG = {
    mainCategory: 'single_string',
    subCategories: 'single_string',
    specificItem: 'array_of_strings'
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
        console.error(`DeepL Translation error: ${error.message}. Text: "${text}", TargetLang: ${targetLang}, SourceLang: ${sourceLang || 'auto'}`);
        return text;
    }
}

async function translateCategoryObject(categoryData, targetLang, sourceLang) {
    const translatedData = { ...categoryData };

    for (const field in TRANSLATABLE_FIELDS_CONFIG) {
        if (categoryData.hasOwnProperty(field) && categoryData[field] !== null && categoryData[field] !== undefined) {
            const type = TRANSLATABLE_FIELDS_CONFIG[field];
            if (type === 'single_string' && typeof categoryData[field] === 'string') {
                translatedData[field] = await translateText(categoryData[field], targetLang, sourceLang);
            } else if (type === 'array_of_strings' && Array.isArray(categoryData[field])) {
                const translatedItems = [];
                for (const item of categoryData[field]) {
                    if (typeof item === 'string') {
                        translatedItems.push(await translateText(item, targetLang, sourceLang));
                    } else {
                        translatedItems.push(item);
                    }
                }
                translatedData[field] = translatedItems;
            }
        }
    }
    return translatedData;
}

const createArVersionOfCategory = (categoryFromDb, arTextFieldsContainer) => {
    const arCategory = { ...categoryFromDb };
    for (const field in TRANSLATABLE_FIELDS_CONFIG) {
        if (arTextFieldsContainer.hasOwnProperty(field)) {
            arCategory[field] = arTextFieldsContainer[field];
        }
    }
    return arCategory;
};

/**
 * Formats a flat list of category objects (from DB) into a structured list for display.
 * Each category object in the input list is assumed to have its `specificItem` field as an array of strings.
 * The `specificItemsDetails` field in the output will be a simple array of these strings.
 * @param {Array<object>} categoryList - Flat list of category objects.
 * @returns {Promise<Array<object>>} Formatted list.
 */
async function formatCategoriesForOutput(categoryList) {
    return categoryList.map(category => {
        return {
            id: category.id,
            mainCategory: category.mainCategory,
            subCategories: category.subCategories,
            // Output specificItemsDetails as a direct array of strings
            specificItemsDetails: category.specificItem || [], // category.specificItem is already String[]
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
        };
    });
}


// --- Category Service ---
const categoryService = {
    async createCategory(data, lang = "en", reqDetails = {}) {
        let specificItemsSource = [];
        if (data.specificItem === null || data.specificItem === undefined) {
            specificItemsSource = [];
        } else if (Array.isArray(data.specificItem)) {
            specificItemsSource = data.specificItem.map(item => String(item));
        } else {
            specificItemsSource = [String(data.specificItem)];
        }

        const categoryInputData = {
            mainCategory: data.mainCategory,
            subCategories: data.subCategories,
            specificItem: specificItemsSource,
        };

        let dataForDb = { ...categoryInputData };
        let originalArInputFields = {};

        if (lang === "ar") {
            originalArInputFields = await translateCategoryObject(categoryInputData, "AR", "AR");
            dataForDb = await translateCategoryObject(categoryInputData, "EN-US", "AR");
        } else {
            originalArInputFields = await translateCategoryObject(categoryInputData, "AR", "EN");
        }
        
        const dataToCreateInPrisma = {
            mainCategory: dataForDb.mainCategory,
            subCategories: dataForDb.subCategories,
            specificItem: dataForDb.specificItem || [],
        };

        const newCategoryInDb = await prisma.category.create({
            data: dataToCreateInPrisma
        });

        if (redisClient.isReady && Object.keys(originalArInputFields).length > 0) {
            try {
                const categoryForArCache = createArVersionOfCategory(newCategoryInDb, originalArInputFields);
                await redisClient.setEx(
                    cacheKeys.categoryAr(newCategoryInDb.id),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(categoryForArCache)
                );
                await redisClient.del(cacheKeys.allCategoriesAr());
                console.log(`Redis: AR Cache - Cached new category AR (ID: ${newCategoryInDb.id}). Invalidated all_formatted list.`);
            } catch (cacheError) {
                console.error("Redis: AR Cache - Category caching error (createCategory) ->", cacheError.message);
            }
        }
        
        recordAuditLog(AuditLogAction.CATEGORY_CREATED, {
            userId: reqDetails.actorUserId,
            entityName: 'Category',
            entityId: newCategoryInDb.id,
            newValues: newCategoryInDb,
            description: `Category '${newCategoryInDb.mainCategory || newCategoryInDb.id}' (specific items: ${(newCategoryInDb.specificItem || []).join(', ') || 'N/A'}) created.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });

        if (lang === 'ar') {
            return createArVersionOfCategory(newCategoryInDb, originalArInputFields);
        } else {
            return newCategoryInDb;
        }
    },

    async getAllCategories(lang = "en") {
        const cacheKeyForAllFormattedAr = cacheKeys.allCategoriesAr();

        if (lang === "ar" && redisClient.isReady) {
            try {
                const cachedCategories = await redisClient.get(cacheKeyForAllFormattedAr);
                if (cachedCategories) {
                    console.log("Redis: AR Cache - Fetched all formatted AR categories from cache.");
                    return JSON.parse(cachedCategories);
                }
                console.log("Redis: AR Cache - All formatted AR categories NOT IN CACHE. Fetching and processing.");
            } catch (cacheError) {
                console.error("Redis: AR Cache - Error fetching all formatted AR categories from cache. Will proceed to DB. Error ->", cacheError.message);
            }
        }

        const allCategoriesDb_flat = await prisma.category.findMany({
            orderBy: [
                { mainCategory: 'asc' },
                { subCategories: 'asc' },
                { createdAt: 'asc' }
            ]
        });

        if (lang === "ar") {
            if (!deeplClient) {
                console.warn("DeepL client not available. Formatting and returning English data for AR request.");
                return formatCategoriesForOutput(allCategoriesDb_flat);
            }
            
            console.log("DeepL: Translating flat category list to AR for formatted display...");
            
            const translatedArCategories_flat = await Promise.all(
                allCategoriesDb_flat.map(async (categoryDb) => { 
                    const arTextFieldsContainer = await translateCategoryObject(categoryDb, "AR", "EN");
                    const categoryForArDisplay = createArVersionOfCategory(categoryDb, arTextFieldsContainer);
                    
                    if (redisClient.isReady) { 
                        try {
                            await redisClient.setEx(
                                cacheKeys.categoryAr(categoryDb.id),
                                AR_CACHE_EXPIRATION,
                                JSON.stringify(categoryForArDisplay)
                            );
                        } catch(e) { 
                            console.error(`Redis: AR Cache - Error caching individual AR category ${categoryDb.id} during getAll -> ${e.message}`);
                        }
                    }
                    return categoryForArDisplay;
                })
            );

            const formattedArCategories = await formatCategoriesForOutput(translatedArCategories_flat);

            if (redisClient.isReady && formattedArCategories.length > 0) {
                try {
                    await redisClient.setEx(
                        cacheKeyForAllFormattedAr,
                        AR_CACHE_EXPIRATION,
                        JSON.stringify(formattedArCategories)
                    );
                    console.log("Redis: AR Cache - Cached all formatted categories list with AR names.");
                } catch(e) { 
                    console.error(`Redis: AR Cache - Error caching all formatted AR categories list -> ${e.message}`);
                }
            }
            return formattedArCategories;
        }
        
        return formatCategoriesForOutput(allCategoriesDb_flat);
    },
    
    async getCategoryById(id, lang = "en") {
        const categoryId = parseInt(id, 10);
        if (isNaN(categoryId)) {
            throw new Error("Invalid category ID format.");
        }

        if (lang === "ar" && redisClient.isReady) {
            try {
                const cachedCategory = await redisClient.get(cacheKeys.categoryAr(categoryId));
                if (cachedCategory) {
                    console.log(`Redis: AR Cache - Fetched category ${categoryId} from cache.`);
                    return JSON.parse(cachedCategory);
                }
                console.log(`Redis: AR Cache - Category ${categoryId} NOT IN CACHE for AR. Will fetch and translate.`);
            } catch (cacheError) {
                console.error(`Redis: AR Cache - Error fetching category ${categoryId} from cache. Will proceed to DB. Error ->`, cacheError.message);
            }
        }

        const categoryDb = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!categoryDb) return null;

        if (lang === "ar") {
            if (!deeplClient) {
                console.warn(`DeepL client not available. Returning English data for AR request (Category ID: ${categoryId}).`);
                return categoryDb;
            }
            console.log(`DeepL: Translating category ${categoryId} to AR...`);
            const arTextFieldsContainer = await translateCategoryObject(categoryDb, "AR", "EN");
            const categoryForArDisplayAndCache = createArVersionOfCategory(categoryDb, arTextFieldsContainer);

            if (redisClient.isReady) {
                try {
                    await redisClient.setEx(
                        cacheKeys.categoryAr(categoryId),
                        AR_CACHE_EXPIRATION,
                        JSON.stringify(categoryForArDisplayAndCache)
                    );
                    console.log(`Redis: AR Cache - Cached category ${categoryId} with AR names.`);
                } catch(e) { console.error(`Redis: AR Cache - Error caching AR category ${categoryId} -> ${e.message}`)}
            }
            return categoryForArDisplayAndCache;
        }
        return categoryDb;
    },

    async updateCategory(id, updateData, lang = "en", reqDetails = {}) {
        const categoryId = parseInt(id, 10);
        if (isNaN(categoryId)) {
            throw new Error("Invalid category ID format.");
        }

        const currentCategoryDb = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!currentCategoryDb) return null;

        const processedUpdateData = { ...updateData };
        if (processedUpdateData.hasOwnProperty('specificItem')) {
            if (processedUpdateData.specificItem === null || processedUpdateData.specificItem === undefined) {
                processedUpdateData.specificItem = [];
            } else if (!Array.isArray(processedUpdateData.specificItem)) {
                processedUpdateData.specificItem = [String(processedUpdateData.specificItem)];
            } else {
                processedUpdateData.specificItem = processedUpdateData.specificItem.map(item => String(item));
            }
        }

        let dataForDbUpdates = { ...processedUpdateData }; 

        if (lang === "ar") {
            dataForDbUpdates = await translateCategoryObject(processedUpdateData, "EN-US", "AR");
        }
        
        const finalPrismaUpdatePayload = {};
        for (const key of Object.keys(processedUpdateData)) {
            if (TRANSLATABLE_FIELDS_CONFIG.hasOwnProperty(key) || ['mainCategory', 'subCategories', 'specificItem'].includes(key)) {
                 if (dataForDbUpdates.hasOwnProperty(key)) {
                    finalPrismaUpdatePayload[key] = dataForDbUpdates[key];
                }
            } else if (processedUpdateData.hasOwnProperty(key)) {
                 finalPrismaUpdatePayload[key] = processedUpdateData[key];
            }
        }
        
        if (Object.keys(finalPrismaUpdatePayload).length === 0) {
            console.log(`Update category called for ID ${categoryId} with no updatable data provided. Returning current data.`);
            if (lang === 'ar') { 
                if (!deeplClient) return currentCategoryDb;
                const arTextFields = await translateCategoryObject(currentCategoryDb, "AR", "EN");
                return createArVersionOfCategory(currentCategoryDb, arTextFields);
            }
            return currentCategoryDb; 
        }

        const updatedCategoryInDb = await prisma.category.update({
            where: { id: categoryId },
            data: finalPrismaUpdatePayload,
        });

        if (redisClient.isReady) {
            try {
                const completeArTextFields = await translateCategoryObject(updatedCategoryInDb, "AR", "EN");
                const categoryForArCache = createArVersionOfCategory(updatedCategoryInDb, completeArTextFields);

                await redisClient.setEx(
                    cacheKeys.categoryAr(categoryId),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(categoryForArCache)
                );
                await redisClient.del(cacheKeys.allCategoriesAr());
                console.log(`Redis: AR Cache - Updated AR cache for category ${categoryId}. Invalidated all_formatted list.`);
            } catch (cacheError) {
                console.error(`Redis: AR Cache - Category caching error (updateCategory ${categoryId}) ->`, cacheError.message);
            }
        }

        recordAuditLog(AuditLogAction.CATEGORY_UPDATED, {
            userId: reqDetails.actorUserId,
            entityName: 'Category',
            entityId: updatedCategoryInDb.id,
            oldValues: currentCategoryDb,
            newValues: updatedCategoryInDb,
            description: `Category '${updatedCategoryInDb.mainCategory || updatedCategoryInDb.id}' updated.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });

        if (lang === 'ar') {
            if (!deeplClient) {
                 console.warn(`DeepL client not available. Returning English data for AR request after update (Category ID: ${categoryId}).`);
                 return updatedCategoryInDb;
            }
            const completeArTextFields = await translateCategoryObject(updatedCategoryInDb, "AR", "EN");
            return createArVersionOfCategory(updatedCategoryInDb, completeArTextFields);
        }
        return updatedCategoryInDb;
    },

    async deleteCategory(id, lang = "en", reqDetails = {}) {
        const categoryId = parseInt(id, 10);
        if (isNaN(categoryId)) {
            throw new Error("Invalid category ID format.");
        }

        const categoryToDelete = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!categoryToDelete) return null;

        const deletedCategoryFromDB = await prisma.category.delete({ where: { id: categoryId } });

        if (redisClient.isReady) {
            try {
                await redisClient.del(cacheKeys.categoryAr(categoryId));
                await redisClient.del(cacheKeys.allCategoriesAr());
                console.log(`Redis: AR Cache - Deleted AR cache for category ${categoryId} and invalidated all_formatted list.`);
            } catch (cacheError) {
                console.error(`Redis: AR Cache - Error during cache invalidation (deleteCategory ${categoryId}) ->`, cacheError.message);
            }
        }

        recordAuditLog(AuditLogAction.CATEGORY_DELETED, {
            userId: reqDetails.actorUserId,
            entityName: 'Category',
            entityId: categoryToDelete.id,
            oldValues: categoryToDelete,
            description: `Category '${categoryToDelete.mainCategory || categoryToDelete.id}' deleted.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });
        
        return deletedCategoryFromDB;
    },
};

export default categoryService;