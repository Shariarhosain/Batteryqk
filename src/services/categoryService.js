import prisma from "../utils/prismaClient.js";
import { recordAuditLog } from "../utils/auditLogHandler.js";
import { AuditLogAction } from "@prisma/client";
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
if (REDIS_URL.includes("YOUR_REDIS_PASSWORD") || REDIS_URL.includes("YOUR_REDIS_HOST")) {
    console.warn("Redis URL seems to contain placeholder values. Please configure process.env.REDIS_URL for AR caching.");
}
const AR_CACHE_EXPIRATION = 0;

const redisClient = createClient({
    url: REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            console.log(`Redis: AR Category Cache - Attempting to reconnect. Retry: ${retries + 1}`);
            if (retries >= 3) {
                console.error("Redis: AR Category Cache - Max reconnect retries reached. Stopping retries.");
                return false;
            }
            return Math.min(retries * 200, 5000);
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
    categoryAr: (mainId, subId) => `category:${mainId}:${subId}:ar`,
    allCategoriesAr: () => `categories:all_formatted:ar`,
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

// --- Category Service ---
const categoryService = {
    async createCategory(data, lang = "en", reqDetails = {}) {
        const { mainCategory, subCategories, specificItem } = data;
        
        let mainCategoryName, subCategoryName, specificItemNames;
        let originalMainCategory = mainCategory;
        let originalSubCategories = subCategories;
        let originalSpecificItem = Array.isArray(specificItem) ? specificItem : [specificItem];

        if (lang === "ar") {
            // Convert Arabic to English for database storage
            mainCategoryName = await translateText(mainCategory, "EN-US", "AR");
            subCategoryName = await translateText(subCategories, "EN-US", "AR");
            specificItemNames = await Promise.all(
                originalSpecificItem.map(item => translateText(item, "EN-US", "AR"))
            );
        } else {
            mainCategoryName = mainCategory;
            subCategoryName = subCategories;
            specificItemNames = originalSpecificItem;
        }

        // Create or find main category
        let mainCategoryRecord = await prisma.mainCategoryOption.findFirst({
            where: { name: mainCategoryName }
        });
        
        if (!mainCategoryRecord) {
            mainCategoryRecord = await prisma.mainCategoryOption.create({
                data: { name: mainCategoryName }
            });
        }

        // Create or find sub category
        let subCategoryRecord = await prisma.subCategoryOption.findFirst({
            where: { 
                name: subCategoryName,
                mainCategoryId: mainCategoryRecord.id 
            }
        });
        
        if (!subCategoryRecord) {
            subCategoryRecord = await prisma.subCategoryOption.create({
                data: { 
                    name: subCategoryName,
                    mainCategoryId: mainCategoryRecord.id 
                }
            });
        }

        // Create specific items
        const specificItemRecords = [];
        for (const itemName of specificItemNames) {
            let specificItemRecord = await prisma.specificItemOption.findFirst({
                where: { 
                    name: itemName,
                    subCategoryId: subCategoryRecord.id,
                    mainCategoryId: mainCategoryRecord.id
                }
            });
            
            if (!specificItemRecord) {
                specificItemRecord = await prisma.specificItemOption.create({
                    data: { 
                        name: itemName,
                        subCategoryId: subCategoryRecord.id,
                        mainCategoryId: mainCategoryRecord.id
                    }
                });
            }
            specificItemRecords.push(specificItemRecord);
        }

        // Cache Arabic version in Redis
        try {
            if (lang === "ar") {
                // Store original Arabic input in cache
                const cacheData = {
                    mainCategory: { name: originalMainCategory, id: mainCategoryRecord.id },
                    subCategories: { name: originalSubCategories, id: subCategoryRecord.id },
                    specificItem: specificItemRecords.map((item, index) => ({
                        name: originalSpecificItem[index],
                        id: item.id
                    })),
                    createdAt: mainCategoryRecord.createdAt,
                    updatedAt: mainCategoryRecord.updatedAt
                };
                await redisClient.setEx(
                    cacheKeys.categoryAr(mainCategoryRecord.id, subCategoryRecord.id),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(cacheData)
                );
            } else {
                // Convert to Arabic and store in cache
                const arMainCategory = await translateText(mainCategoryRecord.name, "AR", "EN");
                const arSubCategory = await translateText(subCategoryRecord.name, "AR", "EN");
                const arSpecificItems = await Promise.all(
                    specificItemRecords.map(async (item) => ({
                        name: await translateText(item.name, "AR", "EN"),
                        id: item.id
                    }))
                );
                
                const cacheData = {
                    mainCategory: { name: arMainCategory, id: mainCategoryRecord.id },
                    subCategories: { name: arSubCategory, id: subCategoryRecord.id },
                    specificItem: arSpecificItems,
                    createdAt: mainCategoryRecord.createdAt,
                    updatedAt: mainCategoryRecord.updatedAt
                };
                await redisClient.setEx(
                    cacheKeys.categoryAr(mainCategoryRecord.id, subCategoryRecord.id),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(cacheData)
                );
            }
            // Invalidate all categories cache
            await redisClient.del(cacheKeys.allCategoriesAr());
        } catch (error) {
            console.error('Redis cache error during category creation:', error.message);
        }

        // Record audit log
        recordAuditLog(AuditLogAction.CATEGORY_CREATED, {
            userId: reqDetails.actorUserId,
            entityName: 'Category',
            entityId: `${mainCategoryRecord.id}_${subCategoryRecord.id}`,
            newValues: { mainCategoryRecord, subCategoryRecord, specificItemRecords },
            description: `Category '${mainCategoryName}' with subcategory '${subCategoryName}' created.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });

        // Format response
        const response = {
            mainCategory: {
                name: lang === "ar" ? originalMainCategory : mainCategoryRecord.name,
                id: mainCategoryRecord.id
            },
            subCategories: {
                name: lang === "ar" ? originalSubCategories : subCategoryRecord.name,
                id: subCategoryRecord.id
            },
            specificItem: specificItemRecords.map((item, index) => ({
                name: lang === "ar" ? originalSpecificItem[index] : item.name,
                id: item.id
            })),
            createdAt: mainCategoryRecord.createdAt,
            updatedAt: mainCategoryRecord.updatedAt
        };

        return response;
    },

    async getAllCategories(lang = "en") {
        if (lang === "ar") {
            try {
                // Try to get from Redis cache first
                const cachedData = await redisClient.get(cacheKeys.allCategoriesAr());
                if (cachedData) {
                    console.log('Redis cache hit for all categories in Arabic');
                    return JSON.parse(cachedData);
                }
            } catch (error) {
                console.error('Redis cache error during getAllCategories:', error.message);
            }

            // If not in cache, fetch from DB
            const mainCategories = await prisma.mainCategoryOption.findMany({
                include: {
                    subCategories: {
                        include: {
                            specificItems: true
                        }
                    }
                },
                orderBy: { id: 'desc' }
            });

            const formattedCategories = [];

            for (const mainCat of mainCategories) {
                for (const subCat of mainCat.subCategories) {
                    const mainCategoryName = await translateText(mainCat.name, "AR", "EN");
                    const subCategoryName = await translateText(subCat.name, "AR", "EN");
                    const specificItems = await Promise.all(
                        subCat.specificItems.map(async (item) => ({
                            name: await translateText(item.name, "AR", "EN"),
                            id: item.id
                        }))
                    );

                    formattedCategories.push({
                        mainCategory: {
                            name: mainCategoryName,
                            id: mainCat.id
                        },
                        subCategories: {
                            name: subCategoryName,
                            id: subCat.id
                        },
                        specificItem: specificItems,
                        createdAt: mainCat.createdAt,
                        updatedAt: mainCat.updatedAt
                    });
                }
            }

            // Store in Redis cache
            try {
                console.log('Storing all categories in Redis cache for Arabic');
                await redisClient.setEx(
                    cacheKeys.allCategoriesAr(),
                    AR_CACHE_EXPIRATION,
                    JSON.stringify(formattedCategories)
                );
            } catch (error) {
                console.error('Redis cache error during getAllCategories storage:', error.message);
            }

            return formattedCategories;
        } else {
            // English - fetch directly from DB
            const mainCategories = await prisma.mainCategoryOption.findMany({
                include: {
                    subCategories: {
                        include: {
                            specificItems: true
                        }
                    }
                },
                orderBy: { id: 'desc' }
            });

            const formattedCategories = [];

            for (const mainCat of mainCategories) {
                for (const subCat of mainCat.subCategories) {
                    formattedCategories.push({
                        mainCategory: {
                            name: mainCat.name,
                            id: mainCat.id
                        },
                        subCategories: {
                            name: subCat.name,
                            id: subCat.id
                        },
                        specificItem: subCat.specificItems.map(item => ({
                            name: item.name,
                            id: item.id
                        })),
                        createdAt: mainCat.createdAt,
                        updatedAt: mainCat.updatedAt
                    });
                }
            }

            return formattedCategories;
        }
    },

    async getCategoryById(id, lang = "en") {
        const mainCategoryId = parseInt(id, 10);
        if (isNaN(mainCategoryId)) {
            throw new Error("Invalid category ID format.");
        }

        if (lang === "ar") {
            // Try to get from Redis cache first
            try {
                const mainCategory = await prisma.mainCategoryOption.findUnique({
                    where: { id: mainCategoryId },
                    include: {
                        subCategories: {
                            include: {
                                specificItems: true
                            }
                        }
                    }
                });

                if (!mainCategory) return null;

                for (const subCat of mainCategory.subCategories) {
                    const cachedData = await redisClient.get(cacheKeys.categoryAr(mainCategoryId, subCat.id));
                    if (cachedData) {
                        return [JSON.parse(cachedData)];
                    }
                }
            } catch (error) {
                console.error('Redis cache error during getCategoryById:', error.message);
            }

            // If not in cache, fetch from DB and translate
            const mainCategory = await prisma.mainCategoryOption.findUnique({
                where: { id: mainCategoryId },
                include: {
                    subCategories: {
                        include: {
                            specificItems: true
                        }
                    }
                }
            });

            if (!mainCategory) return null;

            const formattedCategories = [];

            for (const subCat of mainCategory.subCategories) {
                const mainCategoryName = await translateText(mainCategory.name, "AR", "EN");
                const subCategoryName = await translateText(subCat.name, "AR", "EN");
                const specificItems = await Promise.all(
                    subCat.specificItems.map(async (item) => ({
                        name: await translateText(item.name, "AR", "EN"),
                        id: item.id
                    }))
                );

                const categoryData = {
                    mainCategory: {
                        name: mainCategoryName,
                        id: mainCategory.id
                    },
                    subCategories: {
                        name: subCategoryName,
                        id: subCat.id
                    },
                    specificItem: specificItems,
                    createdAt: mainCategory.createdAt,
                    updatedAt: mainCategory.updatedAt
                };

                formattedCategories.push(categoryData);

                // Store in Redis cache
                try {
                    await redisClient.setEx(
                        cacheKeys.categoryAr(mainCategoryId, subCat.id),
                        AR_CACHE_EXPIRATION,
                        JSON.stringify(categoryData)
                    );
                } catch (error) {
                    console.error('Redis cache error during getCategoryById storage:', error.message);
                }
            }

            return formattedCategories;
        } else {
            // English - fetch directly from DB
            const mainCategory = await prisma.mainCategoryOption.findUnique({
                where: { id: mainCategoryId },
                include: {
                    subCategories: {
                        include: {
                            specificItems: true
                        }
                    }
                }
            });

            if (!mainCategory) return null;

            const formattedCategories = [];

            for (const subCat of mainCategory.subCategories) {
                formattedCategories.push({
                    mainCategory: {
                        name: mainCategory.name,
                        id: mainCategory.id
                    },
                    subCategories: {
                        name: subCat.name,
                        id: subCat.id
                    },
                    specificItem: subCat.specificItems.map(item => ({
                        name: item.name,
                        id: item.id
                    })),
                    createdAt: mainCategory.createdAt,
                    updatedAt: mainCategory.updatedAt
                });
            }

            return formattedCategories;
        }
    },

    async updateCategory(id, updateData, lang = "en", reqDetails = {}) {
        const mainCategoryId = parseInt(id, 10);
        if (isNaN(mainCategoryId)) {
            throw new Error("Invalid category ID format.");
        }

        const currentMainCategory = await prisma.mainCategoryOption.findUnique({
            where: { id: mainCategoryId },
            include: {
                subCategories: {
                    include: {
                        specificItems: true
                    }
                }
            }
        });

        if (!currentMainCategory) return null;

        let updatedMainCategory = currentMainCategory;

        if (lang === "ar") {
            // Arabic input - update specific Redis cache first, then convert to English for DB
            try {
                // Update specific Redis cache for each subcategory
                for (const subCat of currentMainCategory.subCategories) {
                    const cacheKey = cacheKeys.categoryAr(mainCategoryId, subCat.id);
                    let cachedData = await redisClient.get(cacheKey);
                    
                    if (cachedData) {
                        cachedData = JSON.parse(cachedData);
                        
                        // Update cached Arabic data
                        if (updateData.mainCategory) {
                            cachedData.mainCategory.name = updateData.mainCategory;
                        }
                        if (updateData.subCategories) {
                            cachedData.subCategories.name = updateData.subCategories;
                        }
                        if (updateData.specificItem) {
                            const specificItems = Array.isArray(updateData.specificItem) 
                                ? updateData.specificItem 
                                : [updateData.specificItem];
                            
                            cachedData.specificItem = specificItems.map((item, index) => ({
                                name: item,
                                id: cachedData.specificItem[index]?.id || Date.now() + index
                            }));
                        }
                        
                        // Save updated Arabic cache
                        await redisClient.setEx(cacheKey, AR_CACHE_EXPIRATION, JSON.stringify(cachedData));
                    }
                }
            } catch (error) {
                console.error('Redis cache error during Arabic update:', error.message);
            }

            // Convert Arabic to English and update DB
            if (updateData.mainCategory) {
                const mainCategoryName = await translateText(updateData.mainCategory, "EN-US", "AR");
                
                // Check if the translated name already exists (excluding current category)
                const existingMainCategory = await prisma.mainCategoryOption.findFirst({
                    where: { 
                        name: mainCategoryName,
                        NOT: { id: mainCategoryId }
                    }
                });
                
                if (!existingMainCategory) {
                    updatedMainCategory = await prisma.mainCategoryOption.update({
                        where: { id: mainCategoryId },
                        data: { name: mainCategoryName }
                    });
                }
            }

            if (updateData.subCategories && currentMainCategory.subCategories.length > 0) {
                const subCategoryName = await translateText(updateData.subCategories, "EN-US", "AR");
                
                // Check if the translated name already exists (excluding current subcategory)
                const existingSubCategory = await prisma.subCategoryOption.findFirst({
                    where: { 
                        name: subCategoryName,
                        NOT: { id: currentMainCategory.subCategories[0].id }
                    }
                });
                
                if (!existingSubCategory) {
                    await prisma.subCategoryOption.update({
                        where: { id: currentMainCategory.subCategories[0].id },
                        data: { name: subCategoryName }
                    });
                }
            }

            if (updateData.specificItem) {
                const specificItems = Array.isArray(updateData.specificItem) 
                    ? updateData.specificItem 
                    : [updateData.specificItem];

                for (const itemData of specificItems) {
                    const parts = itemData.split('-');
                    if (parts.length === 2 && !isNaN(parseInt(parts[1]))) {
                        const itemId = parseInt(parts[1]);
                        const itemName = await translateText(parts[0], "EN-US", "AR");
                        
                        // Check if the translated name already exists (excluding current item)
                        const existingSpecificItem = await prisma.specificItemOption.findFirst({
                            where: { 
                                name: itemName,
                                NOT: { id: itemId }
                            }
                        });
                        
                        if (!existingSpecificItem) {
                            await prisma.specificItemOption.update({
                                where: { id: itemId },
                                data: { name: itemName }
                            });
                        }
                    } else {
                        const itemName = await translateText(itemData, "EN-US", "AR");
                        
                        // Check if the translated name already exists
                        const existingSpecificItem = await prisma.specificItemOption.findFirst({
                            where: { name: itemName }
                        });
                        
                        if (!existingSpecificItem) {
                            await prisma.specificItemOption.create({
                                data: {
                                    name: itemName,
                                    mainCategoryId: mainCategoryId,
                                    subCategoryId: currentMainCategory.subCategories[0]?.id
                                }
                            });
                        }
                    }
                }
            }

        } else {
            // English input - update DB first, then convert to Arabic and update Redis cache
            if (updateData.mainCategory) {
                // Check if the name already exists (excluding current category)
                const existingMainCategory = await prisma.mainCategoryOption.findFirst({
                    where: { 
                        name: updateData.mainCategory,
                        NOT: { id: mainCategoryId }
                    }
                });
                
                if (!existingMainCategory) {
                    updatedMainCategory = await prisma.mainCategoryOption.update({
                        where: { id: mainCategoryId },
                        data: { name: updateData.mainCategory }
                    });
                }
            }

            if (updateData.subCategories && currentMainCategory.subCategories.length > 0) {
                // Check if the name already exists (excluding current subcategory)
                const existingSubCategory = await prisma.subCategoryOption.findFirst({
                    where: { 
                        name: updateData.subCategories,
                        NOT: { id: currentMainCategory.subCategories[0].id }
                    }
                });
                
                if (!existingSubCategory) {
                    await prisma.subCategoryOption.update({
                        where: { id: currentMainCategory.subCategories[0].id },
                        data: { name: updateData.subCategories }
                    });
                }
            }

            if (updateData.specificItem) {
                const specificItems = Array.isArray(updateData.specificItem) 
                    ? updateData.specificItem 
                    : [updateData.specificItem];

                for (const itemData of specificItems) {
                    const parts = itemData.split('-');
                    if (parts.length === 2 && !isNaN(parseInt(parts[1]))) {
                        const itemId = parseInt(parts[1]);
                        
                        // Check if the name already exists (excluding current item)
                        const existingSpecificItem = await prisma.specificItemOption.findFirst({
                            where: { 
                                name: parts[0],
                                NOT: { id: itemId }
                            }
                        });
                        
                        if (!existingSpecificItem) {
                            await prisma.specificItemOption.update({
                                where: { id: itemId },
                                data: { name: parts[0] }
                            });
                        }
                    } else {
                        // Check if the name already exists
                        const existingSpecificItem = await prisma.specificItemOption.findFirst({
                            where: { name: itemData }
                        });
                        
                        if (!existingSpecificItem) {
                            await prisma.specificItemOption.create({
                                data: {
                                    name: itemData,
                                    mainCategoryId: mainCategoryId,
                                    subCategoryId: currentMainCategory.subCategories[0]?.id
                                }
                            });
                        }
                    }
                }
            }

            // Convert to Arabic and update specific Redis cache
            try {
                for (const subCat of currentMainCategory.subCategories) {
                    const updatedCategory = await this.getCategoryById(mainCategoryId, 'en');
                    if (updatedCategory && updatedCategory.length > 0) {
                        const arMainCategory = await translateText(updatedCategory[0].mainCategory.name, "AR", "EN");
                        const arSubCategory = await translateText(updatedCategory[0].subCategories.name, "AR", "EN");
                        const arSpecificItems = await Promise.all(
                            updatedCategory[0].specificItem.map(async (item) => ({
                                name: await translateText(item.name, "AR", "EN"),
                                id: item.id
                            }))
                        );

                        const cacheData = {
                            mainCategory: { name: arMainCategory, id: updatedCategory[0].mainCategory.id },
                            subCategories: { name: arSubCategory, id: updatedCategory[0].subCategories.id },
                            specificItem: arSpecificItems,
                            createdAt: updatedCategory[0].createdAt,
                            updatedAt: updatedCategory[0].updatedAt
                        };

                        await redisClient.setEx(
                            cacheKeys.categoryAr(mainCategoryId, subCat.id),
                            AR_CACHE_EXPIRATION,
                            JSON.stringify(cacheData)
                        );
                    }
                }
            } catch (error) {
                console.error('Redis cache error during English update:', error.message);
            }
        }

        // Invalidate all categories cache for both languages
        try {
            await redisClient.del(cacheKeys.allCategoriesAr());
        } catch (error) {
            console.error('Redis cache error during cache invalidation:', error.message);
        }

        // Record audit log
        recordAuditLog(AuditLogAction.CATEGORY_UPDATED, {
            userId: reqDetails.actorUserId,
            entityName: 'Category',
            entityId: mainCategoryId.toString(),
            oldValues: currentMainCategory,
            newValues: updateData,
            description: `Category '${updatedMainCategory.name}' updated.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });

        // Return updated category in the same format
        return await this.getCategoryById(mainCategoryId, lang);
    },

    async deleteCategory(id, lang = "en", reqDetails = {}) {
        const mainCategoryId = parseInt(id, 10);
        if (isNaN(mainCategoryId)) {
            throw new Error("Invalid category ID format.");
        }

        const categoryToDelete = await prisma.mainCategoryOption.findUnique({
            where: { id: mainCategoryId },
            include: {
                subCategories: {
                    include: {
                        specificItems: true
                    }
                }
            }
        });

        if (!categoryToDelete) return null;

        // Delete from Redis cache first
        try {
            for (const subCat of categoryToDelete.subCategories) {
                await redisClient.del(cacheKeys.categoryAr(mainCategoryId, subCat.id));
            }
            await redisClient.del(cacheKeys.allCategoriesAr());
        } catch (error) {
            console.error('Redis cache error during category deletion:', error.message);
        }

        // Delete specific items first
        for (const subCat of categoryToDelete.subCategories) {
            await prisma.specificItemOption.deleteMany({
                where: { subCategoryId: subCat.id }
            });
        }

        // Delete sub categories
        await prisma.subCategoryOption.deleteMany({
            where: { mainCategoryId: mainCategoryId }
        });

        // Delete main category
        const deletedCategory = await prisma.mainCategoryOption.delete({
            where: { id: mainCategoryId }
        });

        // Record audit log
        recordAuditLog(AuditLogAction.CATEGORY_DELETED, {
            userId: reqDetails.actorUserId,
            entityName: 'Category',
            entityId: categoryToDelete.id.toString(),
            oldValues: categoryToDelete,
            description: `Category '${categoryToDelete.name}' deleted.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });

        return deletedCategory;
    },
};

export default categoryService;
