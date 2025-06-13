import prisma from "../utils/prismaClient.js";
import { sendMail } from "../utils/mailer.js";
import { createNotification } from "../utils/notificationHandler.js"; // Assumes this saves EN to DB
import { recordAuditLog } from "../utils/auditLogHandler.js";
import { NotificationType, AuditLogAction } from "@prisma/client";
import { translate } from "../utils/i18n.js"; // For general i18n messages
import errorHandler from "../middlewares/errorHandler.js";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import * as deepl from "deepl-node";
import { createClient } from "redis";

const authKey = process.env.DEEPL_AUTH_KEY;
const deeplClient = new deepl.DeepLClient(authKey);

const SALT_ROUNDS = 10;
const REDIS_URL = process.env.REDIS_URL;
const AR_CACHE_EXPIRATION = 365 * 24 * 60 * 60; // 365 days in seconds
const AR_NOTIFICATION_CACHE_EXPIRATION = 365 * 24 * 60 * 60; // 365 days in seconds
const AR_NOTIFICATION_LIST_MAX_LENGTH = 1000000;

const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      console.log(`Redis: AR Cache - Attempting to reconnect. Retry: ${retries + 1}`);
      if (retries >= 3) {
        console.error("Redis: AR Cache - Max reconnect retries reached.");
        return false; // Stop retrying after 3 attempts
      }
      return Math.min(retries * 200, 5000);
    },
  },
});

redisClient.on('connecting', () => console.log('Redis: AR Cache - Connecting...'));
redisClient.on('ready', () => console.log('Redis: AR Cache - Client is ready.'));
redisClient.on('error', (err) => console.error('Redis: AR Cache - Client Error ->', err.message));
redisClient.on('end', () => console.log('Redis: AR Cache - Connection ended.'));

(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Redis: AR Cache - Could not connect on initial attempt ->', err.message);
  }
})();

// Cache keys will now implicitly be for AR versions or identify AR data
const cacheKeys = {
  userAr: (id) => `user:${id}:ar`,
  userByUidAr: (uid) => `user:uid:${uid}:ar`,
  allUsersAr: () => `users:all:ar`, // For AR translated list
  notificationAr: (id) => `notification:${id}:ar`,
  notificationsByUserIdAr: (userId) => `user:${userId}:notifications_list:ar`,
};

// Helper to create user object for cache (without password), with specific names
const createUserObjectWithNames = (userFromDb, fname, lname) => {
    const { password, ...userBase } = userFromDb; // userFromDb has DB structure (ID, UID etc.)
    return { ...userBase, fname, lname };
};

// Helper to cache AR version of a notification
async function cacheArNotification(arNotificationObject) {
    if (!redisClient.isReady || !arNotificationObject || !arNotificationObject.id || !arNotificationObject.userId) {
        console.log("Redis: AR Cache - Not ready or invalid AR notification object, skipping caching.");
        return;
    }
    try {
        await redisClient.setEx(
            cacheKeys.notificationAr(arNotificationObject.id),
            AR_NOTIFICATION_CACHE_EXPIRATION,
            JSON.stringify(arNotificationObject)
        );
        console.log(`Redis: AR Cache - Cached AR notification (ID: ${arNotificationObject.id})`);

        const userArNotificationsKey = cacheKeys.notificationsByUserIdAr(arNotificationObject.userId);
        await redisClient.lPush(userArNotificationsKey, JSON.stringify(arNotificationObject));
        await redisClient.lTrim(userArNotificationsKey, 0, AR_NOTIFICATION_LIST_MAX_LENGTH - 1);
        console.log(`Redis: AR Cache - Added AR notification to user's list (User ID: ${arNotificationObject.userId})`);
    } catch (cacheError) {
        console.error(`Redis: AR Cache - Error for AR notification (ID: ${arNotificationObject.id}) ->`, cacheError.message);
    }
}

const userService = {
  async createUser(data, lang = "en", reqDetails = {}) {
    let { fname, lname, email, password, uid: providedUid } = data;
    const originalFname = fname; // Input language name
    const originalLname = lname;

    let fnEnglish = fname; // For DB
    let lnEnglish = lname;

    if (lang === "ar" && (originalFname || originalLname)) {
      try {
        if (originalFname) fnEnglish = (await deeplClient.translateText(originalFname, "ar", "en-US")).text;
        if (originalLname) lnEnglish = (await deeplClient.translateText(originalLname, "ar", "en-US")).text;
      } catch (translateError) {
        console.error("DeepL Translation error (createUser to EN):", translateError.message);
        fnEnglish = originalFname; // Fallback
        lnEnglish = originalLname;
      }
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userUid = providedUid || uuidv4();

    const existingUserByUid = await prisma.user.findUnique({ where: { uid: userUid } });
    if (existingUserByUid) throw new errorHandler(translate("error_uid_already_exists", lang), 400);
    const existingUserByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingUserByEmail) throw new errorHandler(translate("error_email_already_exists", lang), 400);

    // DB stores English names
    const newUserInDb = await prisma.user.create({
      data: { fname: fnEnglish, lname: lnEnglish, email, uid: userUid, password: hashedPassword, createdAt: new Date(), updatedAt: new Date()
      },
    });

    const allinfo = await prisma.user.findFirst({
      where: { id: newUserInDb.id },
      select: {
        id: true,
        email: true,
        fname: true,
        lname: true,
        uid: true,
        createdAt: true,
        updatedAt: true,
        rewards: {
          select: {
            points: true,
            category: true,
          },
        },
      },
    });

    // Calculate reward info for consistency with getAllUsers
    const totalRewardPoints = allinfo.rewards.reduce((sum, reward) => sum + (reward.points || 0), 0);
    const categories = allinfo.rewards.map(reward => reward.category).filter(Boolean);
    const categoryHierarchy = { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 };
    const highestCategory = categories.length > 0 
      ? categories.reduce((highest, current) => 
          categoryHierarchy[current] > categoryHierarchy[highest] ? current : highest
        ) 
      : 'BRONZE';

    const { rewards, ...userWithoutRewards } = allinfo;
    const userWithRewards = { ...userWithoutRewards, totalRewardPoints, highestRewardCategory: highestCategory };

    // --- User AR Cache ---
    if (redisClient.isReady) {
      try {
        if (lang === "ar") {
          // For AR, cache with original AR names and translated reward category
          let arRewardCategory = highestCategory;
          try {
            if (highestCategory) {
              arRewardCategory = (await deeplClient.translateText(highestCategory, "en", "ar")).text;
            }
          } catch (translateError) {
            console.error(`DeepL: Error translating reward category ${highestCategory} for new user ${allinfo.id}:`, translateError.message);
          }

          const userForArCache = { 
            ...createUserObjectWithNames(userWithRewards, originalFname, originalLname),
            totalRewardPoints,
            highestRewardCategory: arRewardCategory
          };
          
          await redisClient.setEx(cacheKeys.userAr(allinfo.id), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
          await redisClient.setEx(cacheKeys.userByUidAr(allinfo.uid), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
          console.log(`Redis: AR Cache - Cached new user AR (ID: ${allinfo.id}) with original AR names and rewards.`);
        }
        
        // Always invalidate all-users cache when a new user is created
        await redisClient.del(cacheKeys.allUsersAr());
        console.log(`Redis: AR Cache - Invalidated ${cacheKeys.allUsersAr()}`);
      } catch (cacheError) { 
        console.error("Redis: AR Cache - User caching error (createUser) ->", cacheError.message); 
      }
    }

    // --- Notification (DB is EN, Redis AR if lang=ar) ---
    try {
      const titleKey = "notification_user_registered_title";
      const messageKey = "notification_user_registered_message";
      const templateData = { email: newUserInDb.email }; // email is same for EN/AR

      const dbNotificationEn = await createNotification(
        newUserInDb.id, NotificationType.SYSTEM, titleKey, messageKey, lang, 
        newUserInDb.id, "User", `/users/${newUserInDb.id}`, templateData
      );

      if (dbNotificationEn && lang === "ar" && redisClient.isReady) {
        const titleAr = translate(titleKey, "ar", templateData);
        const messageAr = translate(messageKey, "ar", templateData);
        const notificationForArCache = { ...dbNotificationEn, title: titleAr, message: messageAr, lang: "ar" };
        await cacheArNotification(notificationForArCache);
      }
    } catch (e) { console.error(`Notification processing error (createUser ${newUserInDb.id}): ${e.message}`); }

    // --- Ancillary actions (email, audit log) ---
    try {
      sendMail(newUserInDb.email, translate("email_subject_welcome", lang),
        translate("email_body_welcome", lang, { name: originalFname || newUserInDb.email }), // Use original name for salutation if AR
        lang, { name: originalFname || newUserInDb.email }
      );
    } catch (e) { console.error(`Email send error (createUser ${newUserInDb.id}): ${e.message}`); }
    
    try {
      // --- Corrected Audit Log Details ---
      recordAuditLog(AuditLogAction.USER_REGISTERED, {
        userId: newUserInDb.id, // For self-registration, the new user ID is the actor
        entityName: "User",
        entityId: newUserInDb.id,
        newValues: { // Log the English values as stored in the database
          email: newUserInDb.email,
          fname: newUserInDb.fname, // This is fnEnglish
          lname: newUserInDb.lname, // This is lnEnglish
          uid: newUserInDb.uid,
        },
        description: `User ${newUserInDb.email} registered.`, // Uses email which is language-neutral
        ipAddress: reqDetails.ipAddress,
        userAgent: reqDetails.userAgent,
      });
    } catch (e) { console.error(`Audit log error (createUser ${newUserInDb.id}): ${e.message}`); }

    const { password: _, ...userToReturn } = userWithRewards; // Return with rewards info
    
    // If this was an AR registration, return the original AR names instead of English DB names
    if (lang === 'ar' && (originalFname || originalLname)) {
      userToReturn.fname = originalFname || userToReturn.fname;
      userToReturn.lname = originalLname || userToReturn.lname;
    }
    
    return userToReturn;
  },

  // ... rest of the userService methods (getAllUsers, getUserById, etc.)
  async getAllUsers(lang = "en") {
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fname: true,
        lname: true,
        uid: true,
        createdAt: true,
        updatedAt: true,
        rewards: {
          select: {
            points: true,
            category: true,
          },
        },
      },
    });

    // Calculate total reward points and highest category for each user
    const usersWithRewards = allUsers.map(user => {
      const totalRewardPoints = user.rewards.reduce((sum, reward) => sum + (reward.points || 0), 0);
      const categories = user.rewards.map(reward => reward.category).filter(Boolean);
      const categoryHierarchy = { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 };
      const highestCategory = categories.length > 0 
        ? categories.reduce((highest, current) => 
            categoryHierarchy[current] > categoryHierarchy[highest] ? current : highest
          ) 
        : 'BRONZE';
      
      const { rewards, ...userWithoutRewards } = user;
      return { ...userWithoutRewards, totalRewardPoints, highestRewardCategory: highestCategory };
    });

    // If the request is for AR, translate names and categories
    if (lang === "ar") {
      // Get from cache first
      if (redisClient.isReady) {
        try {
          const cachedUsers = await redisClient.get(cacheKeys.allUsersAr());
          if (cachedUsers) {
            const parsedCachedUsers = JSON.parse(cachedUsers);
            
            // Validate cache against current data for rewards/categories
            let cacheValid = true;
            if (parsedCachedUsers.length === usersWithRewards.length) {
              for (let i = 0; i < usersWithRewards.length; i++) {
                const currentUser = usersWithRewards[i];
                const cachedUser = parsedCachedUsers.find(cu => cu.id === currentUser.id);
                
                if (!cachedUser || 
                    cachedUser.totalRewardPoints !== currentUser.totalRewardPoints || 
                    cachedUser.highestRewardCategory !== currentUser.highestRewardCategory) {
                  cacheValid = false;
                  break;
                }
              }
            } else {
              cacheValid = false;
            }
            
            if (cacheValid) {
              return parsedCachedUsers;
            } else {
              console.log(`Redis: AR Cache - Cache invalidated due to reward/category changes, deleting cache.`);
              await redisClient.del(cacheKeys.allUsersAr());
            }
          }
        } catch (cacheError) {
          console.error("Redis: AR Cache - Error fetching all users from cache ->", cacheError.message);
        }
      }
      
      console.log(`Redis: AR Cache - No cache found for all users, translating names...`);
      
      // If not cached, translate names and cache the result (process sequentially to avoid rate limits)
      const translatedUsers = [];
      for (const user of usersWithRewards) {
        try {
          const arFname = user.fname ? (await deeplClient.translateText(user.fname, "en", "ar")).text : '';
          const arLname = user.lname ? (await deeplClient.translateText(user.lname, "en", "ar")).text : '';
          
          // Translate reward category to Arabic
          let arRewardCategory = user.highestRewardCategory;
          try {
            if (user.highestRewardCategory) {
              arRewardCategory = (await deeplClient.translateText(user.highestRewardCategory, "en", "ar")).text;
            }
          } catch (translateError) {
            console.error(`DeepL: Error translating reward category ${user.highestRewardCategory} for user ${user.id}:`, translateError.message);
          }
          
          const userForArCache = { 
            ...createUserObjectWithNames(user, arFname, arLname),
            totalRewardPoints: user.totalRewardPoints,
            highestRewardCategory: arRewardCategory
          };
          
          // Cache each user individually
          if (redisClient.isReady) {
            await redisClient.setEx(cacheKeys.userAr(user.id), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
            await redisClient.setEx(cacheKeys.userByUidAr(user.uid), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
          }
          
          translatedUsers.push(userForArCache);
          
          // Add a small delay between translations to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (translateError) {
          console.error(`DeepL: Error translating user ${user.id}:`, translateError.message);
          // Fallback: use original English names if translation fails
          const userForArCache = { 
            ...createUserObjectWithNames(user, user.fname, user.lname),
            totalRewardPoints: user.totalRewardPoints,
            highestRewardCategory: user.highestRewardCategory
          };
          translatedUsers.push(userForArCache);
        }
      }

      // Cache the entire list
      await redisClient.setEx(cacheKeys.allUsersAr(), AR_CACHE_EXPIRATION, JSON.stringify(translatedUsers));
      console.log(`Redis: AR Cache - Cached all users list with AR names and reward categories.`);
      
      return translatedUsers;
    }

    return usersWithRewards;
  },

  // ... getUserById, getUserByUid, etc.
  async getUserById(id, lang = "en") {
    const user = await prisma.user.findUnique({ where: { id: parseInt(id, 10) }, select: {
      id: true,
      email: true,
      fname: true,
      lname: true,
      uid: true,
      createdAt: true,
      updatedAt: true,
      rewards: {
        select: {
          points: true,
          category: true,
        },
      },
    }
   });

    if (!user) return null;

    // Calculate total reward points and highest category
    const totalRewardPoints = user.rewards.reduce((sum, reward) => sum + (reward.points || 0), 0);
    const categories = user.rewards.map(reward => reward.category).filter(Boolean);
    const categoryHierarchy = { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 };
    const highestCategory = categories.length > 0 
      ? categories.reduce((highest, current) => 
          categoryHierarchy[current] > categoryHierarchy[highest] ? current : highest
        ) 
      : 'BRONZE';

    // If the request is for AR, translate names
    if (lang === "ar") {
      
      // Check cache first
      if (redisClient.isReady) {
        try {
          const cachedUser = await redisClient.get(cacheKeys.userAr(user.id));
          console.log(`Redis: AR Cache - Attempting to fetch user ${user.id} from cache.`);
          if (cachedUser) {
            const parsedCachedUser = JSON.parse(cachedUser);
            
            // Validate cache against current reward data
            if (parsedCachedUser.totalRewardPoints === totalRewardPoints && 
                parsedCachedUser.highestRewardCategory === highestCategory) {
              return parsedCachedUser;
            } else {
              console.log(`Redis: AR Cache - Cache invalidated for user ${user.id} due to reward/category changes, deleting cache.`);
              await redisClient.del([cacheKeys.userAr(user.id), cacheKeys.userByUidAr(user.uid), cacheKeys.allUsersAr()]);
            }
          }
        } catch (cacheError) {
          console.error("Redis: AR Cache - Error fetching user from cache ->", cacheError.message);
        }
      }

      // If not cached, translate names and cache the result
      const arFname = user.fname ? (await deeplClient.translateText(user.fname, "en", "ar")).text : '';
      const arLname = user.lname ? (await deeplClient.translateText(user.lname, "en", "ar")).text : '';
      const arRewardCategory = highestCategory ? (await deeplClient.translateText(highestCategory, "en", "ar")).text : '';

      const { rewards, ...userWithoutRewards } = user;
      const userForArCache = { 
        ...createUserObjectWithNames(userWithoutRewards, arFname, arLname),
        totalRewardPoints,
        highestRewardCategory: arRewardCategory
      };

      await redisClient.setEx(cacheKeys.userAr(user.id), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
      await redisClient.setEx(cacheKeys.userByUidAr(user.uid), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
      console.log(`Redis: AR Cache - Cached user ${user.id} with AR names.`);

      return userForArCache;
    }

    const { password: _, rewards, ...userWithoutPassword } = user;
    userWithoutPassword.totalRewardPoints = totalRewardPoints;
    userWithoutPassword.highestRewardCategory = highestCategory;
    return userWithoutPassword;
  },

  async getUserByUid(uid, lang = "en") {
    const user = await prisma.user.findUnique({ where: { uid }, select: {
      id: true,
      email: true,
      fname: true,
      lname: true,
      uid: true,
      createdAt: true,
      updatedAt: true,
      rewards: {
        select: {
          points: true,
          category: true,
        },
      },
    }});
    
    if (!user) return null;

    // Calculate total reward points and highest category
    const totalRewardPoints = user.rewards.reduce((sum, reward) => sum + (reward.points || 0), 0);
    const categories = user.rewards.map(reward => reward.category).filter(Boolean);
    const categoryHierarchy = { BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 };
    const highestCategory = categories.length > 0 
      ? categories.reduce((highest, current) => 
          categoryHierarchy[current] > categoryHierarchy[highest] ? current : highest
        ) 
      : 'BRONZE';

    // Cache lookup for AR version
    if (lang === "ar" && redisClient.isReady) {
        try {
            console.log(`Redis: AR Cache - Attempting to fetch user by UID ${uid} from cache using key ${cacheKeys.userByUidAr(uid)}.`);
            const cachedUser = await redisClient.get(cacheKeys.userByUidAr(uid));
            if (cachedUser) {
                const parsedCachedUser = JSON.parse(cachedUser);
                
                // Validate cache against current reward data
                if (parsedCachedUser.totalRewardPoints === totalRewardPoints && 
                    parsedCachedUser.highestRewardCategory === highestCategory) {
                    console.log(`Redis: AR Cache - Found user by UID ${uid} in cache.`);
                    return parsedCachedUser;
                } else {
                    console.log(`Redis: AR Cache - Cache invalidated for user by UID ${uid} due to reward/category changes, deleting cache.`);
                    await redisClient.del([cacheKeys.userAr(user.id), cacheKeys.userByUidAr(uid), cacheKeys.allUsersAr()]);
                }
            }
            console.log(`Redis: AR Cache - User by UID ${uid} not found in cache.`);
        } catch (cacheError) {
            console.error(`Redis: AR Cache - Error fetching user by UID ${uid} from cache ->`, cacheError.message);
        }
    }

    if (lang === "ar") {
        // If not cached, translate names and cache the result
        const arFname = user.fname ? (await deeplClient.translateText(user.fname, "en", "ar")).text : '';
        const arLname = user.lname ? (await deeplClient.translateText(user.lname, "en", "ar")).text : '';
        const arRewardCategory = highestCategory ? (await deeplClient.translateText(highestCategory, "en", "ar")).text : '';

        const { rewards, ...userWithoutRewards } = user;
        const userForArCache = { 
          ...createUserObjectWithNames(userWithoutRewards, arFname, arLname),
          totalRewardPoints,
          highestRewardCategory: arRewardCategory
        };

        if (redisClient.isReady) {
            try {
                await redisClient.setEx(cacheKeys.userAr(user.id), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
                await redisClient.setEx(cacheKeys.userByUidAr(user.uid), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
                console.log(`Redis: AR Cache - Cached user ${user.id} (UID: ${user.uid}) with AR names after DB lookup.`);
            } catch (cacheError) {
                console.error(`Redis: AR Cache - Error caching user ${user.id} (UID: ${user.uid}) ->`, cacheError.message);
            }
        }
        return userForArCache;
    }

    const { password: _, rewards, ...userWithoutPassword } = user;
    userWithoutPassword.totalRewardPoints = totalRewardPoints;
    userWithoutPassword.highestRewardCategory = highestCategory;
    return userWithoutPassword;
  },

  // Helper function to invalidate user AR cache when rewards are updated
  async invalidateUserArCache(userId) {
    if (redisClient.isReady) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { uid: true } });
        if (user) {
          await redisClient.del([
            cacheKeys.userAr(userId),
            cacheKeys.userByUidAr(user.uid),
            cacheKeys.allUsersAr()
          ]);
          console.log(`Redis: AR Cache - Invalidated AR cache for user ${userId} due to reward changes.`);
        }
      } catch (error) {
        console.error(`Redis: AR Cache - Error invalidating cache for user ${userId}:`, error.message);
      }
    }
  },

  async updateUser(id, updateData, lang = "en", reqDetails = {}) {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) throw new Error("Invalid user ID format.");

    const userBeingUpdated = await prisma.user.findUnique({ where: { id: userId } });
    if (!userBeingUpdated) return null;

    // For audit log: capture old values (English, from DB) before any modification
    const oldValuesForAudit = {
        email: userBeingUpdated.email,
        fname: userBeingUpdated.fname,
        lname: userBeingUpdated.lname,
        // include other relevant fields you track, excluding password
    };

    const dbData = { ...updateData }; 
    const originalArFnameInput = (lang === 'ar' && updateData.fname) ? updateData.fname : null;
    const originalArLnameInput = (lang === 'ar' && updateData.lname) ? updateData.lname : null;

    if (lang === 'ar') { 
      try {

        console.log(dbData.fname)

        if (dbData.fname) dbData.fname = (await deeplClient.translateText(dbData.fname.trim(), null, "en-US")).text;
        console.log(dbData.fname)
        if (dbData.lname) dbData.lname = (await deeplClient.translateText(dbData.lname.trim(), null, "en-US")).text;
      } catch (translateError) {
        console.error(`DeepL: Error translating updated names for user ID ${userId} to EN -> ${translateError.message}.`);
      }
    }
    if (dbData.password) dbData.password = await bcrypt.hash(dbData.password, SALT_ROUNDS);

    const updatedUserInDb = await prisma.user.update({
      where: { id: userId }, data: dbData, 
    });

    // --- User AR Cache Update ---
    if (redisClient.isReady) {
        try {
            let arFnameForCache, arLnameForCache;
            if (originalArFnameInput !== null || originalArLnameInput !== null) { 
                arFnameForCache = originalArFnameInput !== null ? originalArFnameInput : (updatedUserInDb.fname ? (await deeplClient.translateText(updatedUserInDb.fname, 'en', 'ar')).text : '');
                arLnameForCache = originalArLnameInput !== null ? originalArLnameInput : (updatedUserInDb.lname ? (await deeplClient.translateText(updatedUserInDb.lname, 'en', 'ar')).text : '');
            } else { 
                arFnameForCache = updatedUserInDb.fname ? (await deeplClient.translateText(updatedUserInDb.fname, 'en', 'ar')).text : '';
                arLnameForCache = updatedUserInDb.lname ? (await deeplClient.translateText(updatedUserInDb.lname, 'en', 'ar')).text : '';
            }
            const userForArCache = createUserObjectWithNames(updatedUserInDb, arFnameForCache, arLnameForCache);
            await redisClient.setEx(cacheKeys.userAr(userId), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
            await redisClient.setEx(cacheKeys.userByUidAr(updatedUserInDb.uid), AR_CACHE_EXPIRATION, JSON.stringify(userForArCache));
            console.log(`Redis: AR Cache - Updated AR cache for user ${userId}`);
            
            await redisClient.del(cacheKeys.allUsersAr());
            console.log(`Redis: AR Cache - Invalidated ${cacheKeys.allUsersAr()}`);
        } catch (cacheError) {
            console.error(`Redis: AR Cache - User caching error (updateUser ${userId}) ->`, cacheError.message);
        }
    }

    // --- Notification for Profile Update ---
    try {
      const titleKey = "notification_profile_updated_title";
      const messageKey = "notification_profile_updated_message";
      const templateData = { name: updatedUserInDb.fname }; 

      const dbNotificationEn = await createNotification(
        updatedUserInDb.id, NotificationType.SYSTEM, titleKey, messageKey, lang, 
        updatedUserInDb.id, "User", `/users/${updatedUserInDb.id}`, templateData
      );

      if (dbNotificationEn && lang === "ar" && redisClient.isReady) {
        const titleAr = translate(titleKey, "ar", templateData);
        const messageAr = translate(messageKey, "ar", templateData);
        const notificationForArCache = { ...dbNotificationEn, title: titleAr, message: messageAr, lang: "ar" };
        await cacheArNotification(notificationForArCache);
      }
    } catch (e) { console.error(`Notification processing error (updateUser ${userId}): ${e.message}`); }

    // --- Ancillary actions (email, audit log for updateUser) ---
    if (updateData.email && updateData.email !== userBeingUpdated.email) {
        try { 
            sendMail(updatedUserInDb.email, 
                translate("email_subject_profile_updated", lang),
                translate("email_body_profile_updated_email_changed", lang, { name: (lang === 'ar' ? originalArFnameInput : updatedUserInDb.fname) || updatedUserInDb.email }),
                lang, 
                { name: (lang === 'ar' ? originalArFnameInput : updatedUserInDb.fname) || updatedUserInDb.email }
            );
        } catch (e) { console.error(`Email error (updateUser ${userId}): ${e.message}`); }
    }
    try { 
        const newValuesForAudit = {
            email: updatedUserInDb.email,
            fname: updatedUserInDb.fname, // English
            lname: updatedUserInDb.lname, // English
            // include other updated fields you track
        };
        recordAuditLog(AuditLogAction.USER_PROFILE_UPDATED, {
            userId: reqDetails.actorUserId || updatedUserInDb.id, // ID of user performing the update or the user themselves
            entityName: "User",
            entityId: updatedUserInDb.id,
            oldValues: oldValuesForAudit,
            newValues: newValuesForAudit,
            description: `User profile for ${updatedUserInDb.email} updated.`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        }); 
    }
    catch (e) { console.error(`Audit log error (updateUser ${userId}): ${e.message}`); }


    const { password: _, ...userToReturn } = updatedUserInDb;
    
    // If this was an AR update, return the original AR names instead of English DB names
    if (lang === 'ar' && (originalArFnameInput !== null || originalArLnameInput !== null)) {
      userToReturn.fname = originalArFnameInput || userToReturn.fname;
      userToReturn.lname = originalArLnameInput || userToReturn.lname;
    }
    
    return userToReturn;
  },

async deleteUser(id, lang = "en", reqDetails = {}) {
  const userIdToDelete = parseInt(id, 10);
  if (isNaN(userIdToDelete)) {
    throw new Error("Invalid user ID format.");
  }

  const userToDelete = await prisma.user.findUnique({
    where: { id: userIdToDelete },
  });

  if (!userToDelete) {
    return null;
  }

  // --- Pre-deletion steps ---
  const oldValuesForAudit = {
    email: userToDelete.email,
    fname: userToDelete.fname,
    lname: userToDelete.lname,
    uid: userToDelete.uid,
  };

  let dbNotificationIds = [];
  let userBookingIds = [];
  let userListingIds = [];
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: userIdToDelete },
      select: { id: true },
    });
    dbNotificationIds = notifications.map(n => n.id.toString());

    // Get user's bookings for cache cleanup
    const userBookings = await prisma.booking.findMany({
      where: { userId: userIdToDelete },
      select: { id: true, listingId: true },
    });
    userBookingIds = userBookings.map(b => b.id);
    userListingIds = [...new Set(userBookings.map(b => b.listingId))]; // unique listing IDs
  } catch (dbError) {
    console.error(`DB: Error fetching user data for cache cleanup for user ${userIdToDelete}:`, dbError.message);
  }

  // --- Perform the deletion from Database ---
  const deletedUserFromDB = await prisma.user.delete({
    where: { id: userIdToDelete },
  });

  // --- Post-deletion cache clearing and ancillary actions ---
  if (redisClient && redisClient.isReady) {
    try {
      // 1. Clear User-Specific AR Caches
      const userArCacheKeysToDelete = [
        cacheKeys.userAr(userIdToDelete),
        cacheKeys.userByUidAr(userToDelete.uid)
      ];
      if (userArCacheKeysToDelete.length > 0) {
          await redisClient.del(userArCacheKeysToDelete);
          console.log(`Redis: AR Cache - Deleted user-specific AR caches for user ${userIdToDelete}:`, userArCacheKeysToDelete);
      }

      // 2. Clear AR Notification-Related Caches
      const userArNotificationsListKey = cacheKeys.notificationsByUserIdAr(userIdToDelete);
      // Start with notification IDs fetched from the database for robustness
      const uniqueNotificationIdsToClear = new Set(dbNotificationIds.map(id => id.toString()));

      try {
        // Fetch the list of stringified notification objects from Redis
        const stringifiedNotificationsFromList = await redisClient.lRange(userArNotificationsListKey, 0, -1);
        if (stringifiedNotificationsFromList && stringifiedNotificationsFromList.length > 0) {
          stringifiedNotificationsFromList.forEach(strNotif => {
            try {
              const notificationObject = JSON.parse(strNotif); // Parse each stringified object
              if (notificationObject && notificationObject.id) {
                uniqueNotificationIdsToClear.add(notificationObject.id.toString()); // Add its ID to the set
              }
            } catch (parseError) {
              console.error(`Redis: AR Cache - Error parsing notification object from list ${userArNotificationsListKey} for user ${userIdToDelete}: ${parseError.message}`, `ObjectString: ${strNotif}`);
            }
          });
        }
      } catch (e) {
        console.error(`Redis: AR Cache - Error fetching AR notification list ${userArNotificationsListKey} for user ${userIdToDelete}:`, e.message);
      }
      
      const notificationIdsArray = Array.from(uniqueNotificationIdsToClear);
      if (notificationIdsArray.length > 0) {
        const individualArNotificationCacheKeys = notificationIdsArray.map(notifId =>
          cacheKeys.notificationAr(notifId) // notifId is already a string here
        );
        if (individualArNotificationCacheKeys.length > 0) {
          await redisClient.del(individualArNotificationCacheKeys);
          console.log(`Redis: AR Cache - Deleted individual AR notification objects for user ${userIdToDelete}:`, individualArNotificationCacheKeys);
        }
      }
      
      // Always attempt to delete the list key itself (user:${userId}:notifications_list:ar)
      await redisClient.del(userArNotificationsListKey);
      console.log(`Redis: AR Cache - Deleted AR notification list key ${userArNotificationsListKey} for user ${userIdToDelete}`);

      // 3. Clear Booking-Related AR Caches
      const bookingCacheKeysToDelete = [];
      
      // Individual booking AR caches
      if (userBookingIds.length > 0) {
        userBookingIds.forEach(bookingId => {
          bookingCacheKeysToDelete.push(`booking:${bookingId}:ar`);
        });
      }
      
      // User's bookings list cache
      bookingCacheKeysToDelete.push(`user:${userToDelete.uid}:bookings:ar`);
      
      // User's notifications cache (booking service related)
      bookingCacheKeysToDelete.push(`user:${userToDelete.uid}:notifications:ar`);
      
      // All bookings caches (pattern-based deletion)
      try {
        const allBookingsKeys = await redisClient.keys('bookings:all*:ar');
        if (allBookingsKeys.length > 0) {
          bookingCacheKeysToDelete.push(...allBookingsKeys);
        }
      } catch (keysError) {
        console.error(`Redis: AR Cache - Error fetching all bookings cache keys for user ${userIdToDelete}:`, keysError.message);
      }
      
      // Listing-related caches that need updating due to booking changes
      if (userListingIds.length > 0) {
        userListingIds.forEach(listingId => {
          bookingCacheKeysToDelete.push(`listing:${listingId}:bookings:ar`);
          bookingCacheKeysToDelete.push(`listing:${listingId}:ar`);
        });
      }
      
      if (bookingCacheKeysToDelete.length > 0) {
        await redisClient.del(bookingCacheKeysToDelete);
        console.log(`Redis: AR Cache - Deleted booking-related AR caches for user ${userIdToDelete}:`, bookingCacheKeysToDelete.length, 'keys');
      }
      
      // 4. Invalidate All-Users AR Cache (Deletes the entire list, which is the standard way)
      await redisClient.del(cacheKeys.allUsersAr());
      console.log(`Redis: AR Cache - Invalidated all-users AR list cache: ${cacheKeys.allUsersAr()}`);

    } catch (cacheError) {
      console.error(`Redis: AR Cache - General error during cache invalidation (deleteUser ${userIdToDelete}) ->`, cacheError.message);
    }
  }

  // Determine actor ID for audit log, handling self-deletion
  let actorIdForAudit = reqDetails.actorUserId;
  if (reqDetails.actorUserId && reqDetails.actorUserId === userToDelete.id) {
    actorIdForAudit = null;
  }

  // Record Audit Log
  try {
    await recordAuditLog(AuditLogAction.USER_DELETED, {
      userId: actorIdForAudit,
      entityName: "User",
      entityId: userToDelete.id.toString(),
      oldValues: oldValuesForAudit,
      description: `User ${userToDelete.email} (ID: ${userToDelete.id}) deleted.`,
      ipAddress: reqDetails.ipAddress,
      userAgent: reqDetails.userAgent,
    });
  } catch (auditError) {
    console.error(`Audit log error (deleteUser ${userIdToDelete}): ${auditError.message}`, auditError);
  }

  // Send Deletion Confirmation Email
  try {
    const nameForEmail = userToDelete.fname || userToDelete.email; // DB (English) name for consistency
    await sendMail(
      userToDelete.email,
      translate("email_subject_account_deleted", lang),
      translate("email_body_account_deleted", lang, { name: nameForEmail }),
      lang
    );
    console.log(`Email sent to ${userToDelete.email} for account deletion.`);
  } catch (emailError) {
    console.error(`Email error during account deletion notification (deleteUser ${userIdToDelete}): ${emailError.message}`);
  }

  const { password: _, ...userToReturn } = deletedUserFromDB;
  return userToReturn;
},

  // ... validateUserPassword and other methods ...
  async validateUserPassword(email, password, lang = "en") {
    if (!email || !password) throw new errorHandler(translate("error_email_and_password_required", lang), 400);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return null;
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  },
};

export default userService;
