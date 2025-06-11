import prisma from '../utils/prismaClient.js';
import { recordAuditLog } from '../utils/auditLogHandler.js';
import { AuditLogAction } from '@prisma/client';
import { createClient } from "redis";
import * as deepl from "deepl-node";
import { sendMail } from '../utils/mailer.js';

// --- DeepL Configuration ---
const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY || "YOUR_DEEPL_AUTH_KEY_HERE";
if (DEEPL_AUTH_KEY === "YOUR_DEEPL_AUTH_KEY_HERE") {
    console.warn("DeepL Auth Key is a placeholder. AR translations may not work. Please configure process.env.DEEPL_AUTH_KEY.");
}
const deeplClient = DEEPL_AUTH_KEY !== "YOUR_DEEPL_AUTH_KEY_HERE" ? new deepl.Translator(DEEPL_AUTH_KEY) : null;

// --- Redis Configuration ---
const REDIS_URL = process.env.REDIS_URL || "redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:PORT";

//no expiration for AR cache
const AR_CACHE_EXPIRATION = 0;

const redisClient = createClient({
    url: REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries >= 3) return new Error('Max reconnection retries reached.');
            return Math.min(retries * 200, 5000);
        },
    },
});

redisClient.on('error', (err) => console.error('Redis: Booking Cache - Error ->', err.message));
(async () => {
    try {
        await redisClient.connect();
        console.log('Redis: Booking Cache - Connected successfully.');
    } catch (err) {
        console.error('Redis: Booking Cache - Could not connect ->', err.message);
    }
})();

const cacheKeys = {
    bookingAr: (bookingId) => `booking:${bookingId}:ar`,
    userBookingsAr: (uid) => `user:${uid}:bookings:ar`,
    userNotificationsAr: (uid) => `user:${uid}:notifications:ar`,
    allBookingsAr: (filterHash = '') => `bookings:all${filterHash}:ar`,
    listingBookingsAr: (listingId) => `listing:${listingId}:bookings:ar`,
    listingAr: (listingId) => `listing:${listingId}:ar`,
};

// --- Helper Functions ---
// async function translateText(text, targetLang, sourceLang = null) {
//     if (!deeplClient || !text || typeof text !== 'string') return text;
//     try {
//         const result = await deeplClient.translateText(text, sourceLang, targetLang);
//         return result.text;
//     } catch (error) {
//         console.error(`DeepL Translation error: ${error.message}`);
//         return text;
//     }
// }

async function translateBookingFields(booking, targetLang, sourceLang = null) {
    if (!booking) return booking;
    const translatedBooking = { ...booking };
    if (booking.additionalNote) {
        translatedBooking.additionalNote = await translateText(booking.additionalNote, targetLang, sourceLang);
    }
    if (booking.listing) {
        translatedBooking.listing = {
            ...booking.listing,
            name: await translateText(booking.listing.name, targetLang, sourceLang),
            description: await translateText(booking.listing.description, targetLang, sourceLang),
            facilities: booking.listing.facilities ? await Promise.all(booking.listing.facilities.map(f => translateText(f, targetLang, sourceLang))) : [],
            location: booking.listing.location ? await Promise.all(booking.listing.location.map(l => translateText(l, targetLang, sourceLang))) : [],
        };
    }
    if (booking.review) {
        translatedBooking.review = {
            ...booking.review,
            comment: await translateText(booking.review.comment, targetLang, sourceLang)
        };
    }
    return translatedBooking;
}

async function updateRewardCategory(userId, totalPoints) {
    let category = 'BRONZE';
    if (totalPoints >= 2500) category = 'PLATINUM';
    else if (totalPoints >= 2000) category = 'GOLD';
    else if (totalPoints >= 1000) category = 'SILVER';

    const currentReward = await prisma.reward.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (!currentReward || currentReward.category !== category) {
        await prisma.reward.create({ data: { userId, points: 0, category, description: `Upgraded to ${category} tier.` } });
        await prisma.notification.create({ data: { userId, title: "Reward Tier Upgraded!", message: `Congratulations! You've been upgraded to the ${category} tier.`, type: 'LOYALTY', entityId: userId.toString(), entityType: 'Reward' } });
    }
}

async function sendBookingEmails(booking, listing, user, lang) {
    try {
        const userSubject = lang === 'ar' ? 'تأكيد استلام طلب الحجز' : 'Booking Request Received';
        const userMessage = lang === 'ar' ? `مرحباً ${user.fname || 'العميل'},\n\nلقد استلمنا طلب الحجز الخاص بك لـ: ${listing.name} وهو الآن قيد المراجعة.\n\nتاريخ الحجز المطلوب: ${booking.bookingDate}` : `Hello ${user.fname || 'Customer'},\n\nWe have received your booking request for: ${listing.name}. It is now pending confirmation.\n\nRequested Booking Date: ${booking.bookingDate}`;
        await sendMail(user.email, userSubject, userMessage, lang, { name: user.fname || 'Customer', listingName: listing.name });

        const adminMessage = `Hello Admin,\n\nA new booking requires your confirmation.\n\nListing: ${listing.name}\nCustomer: ${user.fname} ${user.lname} (${user.email})\nBooking Date: ${booking.bookingDate}\nBooking Hours: ${booking.booking_hours || 'N/A'}\nGuests: ${booking.numberOfPersons}`;
        await sendMail(process.env.EMAIL_USER, 'New Booking - Confirmation Required', adminMessage, 'en', { customerName: `${user.fname} ${user.lname}`, listingName: listing.name });
    } catch (error) {
        console.error('Email sending error:', error);
    }
}

function createFilterHash(filters) {
    const sortedFilters = Object.keys(filters).sort().reduce((result, key) => { result[key] = filters[key]; return result; }, {});
    return JSON.stringify(sortedFilters);
}
// --- Helper Functions ---
async function translateText(text, targetLang, sourceLang = null) {
    if (!deeplClient) {
        console.warn("DeepL client is not initialized.");
        return text;
    }

    if (!text || typeof text !== 'string') {
        return text;
    }

    try {
        const result = await deeplClient.translateText(text, sourceLang, targetLang);
        console.log(`Translated: "${text}" => "${result.text}"`);
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

    // Translate basic text fields
    if (listing.name)
        translatedListing.name = await translateText(listing.name, targetLang, sourceLang);

    if (listing.description)
        translatedListing.description = await translateText(listing.description, targetLang, sourceLang);

    // Translate array fields
    const arrayFields = ['agegroup', 'location', 'facilities', 'operatingHours'];
    for (const field of arrayFields) {
        if (Array.isArray(listing[field])) // Ensure it's an array
            translatedListing[field] = await translateArrayFields(listing[field], targetLang, sourceLang);
    }

    // Translate categories
    const categoryFields = ['selectedMainCategories', 'selectedSubCategories', 'selectedSpecificItems'];
    for (const field of categoryFields) {
        if (Array.isArray(listing[field])) {
            translatedListing[field] = await Promise.all(
                listing[field].map(async (item) => ({
                    ...item,
                    name: await translateText(item.name, targetLang, sourceLang)
                }))
            );
        }
    }

    // Translate reviews
    if (Array.isArray(listing.reviews)) {
        translatedListing.reviews = await Promise.all(
            listing.reviews.map(async (review) => ({
                ...review,
                comment: await translateText(review.comment, targetLang, sourceLang),
                status: await translateText(review.status, targetLang, sourceLang),
                // DO NOT translate user's proper names. Preserve them.
                user: review.user 
            }))
        );
    }

    // Translate bookings
    if (Array.isArray(listing.bookings)) {
        translatedListing.bookings = await Promise.all(
            listing.bookings.map(async (booking) => ({
                ...booking,
                additionalNote: await translateText(booking.additionalNote, targetLang, sourceLang),
                ageGroup: await translateText(booking.ageGroup, targetLang, sourceLang),
                status: await translateText(booking.status, targetLang, sourceLang),
                booking_hours: booking.booking_hours
                    ? await translateText(booking.booking_hours, targetLang, sourceLang)
                    : null,
                // DO NOT translate user's proper names. Preserve them.
                user: await translateText(booking.user.fname, targetLang, sourceLang) + ' ' + await translateText(booking.user.lname, targetLang, sourceLang),
                paymentMethod: await translateText(booking.paymentMethod, targetLang, sourceLang)
            }))
        );
    }
    
    return translatedListing;
}

// --- Booking Service ---
const bookingService = {

    // 1. Create Booking
    async createBooking(data, userUid, lang = 'en', reqDetails = {}) {
        try {
            const { listingId, bookingDate, booking_hours, additionalNote, numberOfPersons, ageGroup } = data;

            const user = await prisma.user.findUnique({ where: { uid: userUid } });
            if (!user) throw new Error('User not found');

            const listing = await prisma.listing.findUnique({ where: { id: listingId } });
            if (!listing) throw new Error('Listing not found');

            let dataForDb = { additionalNote, booking_hours, ageGroup };
            if (lang === 'ar' && deeplClient) {
                dataForDb.additionalNote = await translateText(additionalNote, 'EN-US', 'AR');
                dataForDb.booking_hours = await translateText(booking_hours, 'EN-US', 'AR');
                dataForDb.ageGroup = await translateText(ageGroup, 'EN-US', 'AR');
            }

            const booking = await prisma.booking.create({
                data: {
                    userId: user.id,
                    listingId: listingId,
                    bookingDate: bookingDate ? new Date(bookingDate) : null,
                    booking_hours: dataForDb.booking_hours,
                    additionalNote: dataForDb.additionalNote,
                    ageGroup: dataForDb.ageGroup,
                    numberOfPersons: numberOfPersons ? parseInt(numberOfPersons) : null,
                    status: 'PENDING',
                    paymentMethod: 'UNPAID',
                    updatedAt: new Date(),
                },
                include: { user: true, listing: true }
            });

            const immediateResponse = lang === 'ar' ? {
                message: 'تم استلام طلب الحجز بنجاح وسنعود إليك قريباً بالتأكيد.',
                bookingId: booking.id,
                listingName: await translateText(listing.name, 'AR', 'EN'),
                status: await translateText('PENDING', 'AR', 'EN'),
                paymentMethod: await translateText('UNPAID', 'AR', 'EN')
            } : {
                message: 'Booking request received successfully. We will get back to you with a confirmation shortly.',
                bookingId: booking.id,
                listingName: listing.name,
                status: 'PENDING',
                paymentMethod: 'UNPAID'
            };

            setImmediate(async () => {
                try {
                    const newReward = await prisma.reward.create({
                        data: { userId: user.id, bookingId: booking.id, points: 50, description: `Reward for booking request: ${listing.name}`, category: 'BRONZE' }
                    });
                    const totalPointsResult = await prisma.reward.aggregate({ where: { userId: user.id }, _sum: { points: true } });
                    await updateRewardCategory(user.id, totalPointsResult._sum.points || 0);
                    await prisma.notification.create({ data: { userId: user.id, title: 'Booking Request Received', message: `Your booking for ${listing.name} is pending confirmation.`, type: 'BOOKING', entityId: booking.id.toString(), entityType: 'Booking' } });
                    await prisma.notification.create({ data: { userId: user.id, title: 'Points Awarded!', message: `You've earned 50 points for your new booking request.`, type: 'LOYALTY', entityId: newReward.id.toString(), entityType: 'Reward' } });
                    await sendBookingEmails(booking, listing, user, lang);

                    if (redisClient.isReady && deeplClient) {
                        const cacheKeysToDel = [cacheKeys.userBookingsAr(user.uid), cacheKeys.listingBookingsAr(listingId)];
                        const allBookingsKeys = await redisClient.keys(cacheKeys.allBookingsAr('*'));
                        if (allBookingsKeys.length) cacheKeysToDel.push(...allBookingsKeys);
                        if (cacheKeysToDel.length > 0) await redisClient.del(cacheKeysToDel);

                        const listingCacheKey = cacheKeys.listingAr(listingId);
                        await redisClient.del(listingCacheKey);
                        
        const currentListing = await prisma.listing.findUnique({
            where: { id: listingId },
            include: {
                selectedMainCategories: true,
                selectedSubCategories: true,
                selectedSpecificItems: true,
                reviews: {
                    where: { status: 'ACCEPTED' },
                    select: { rating: true, comment: true, createdAt: true, user: { select: { fname: true, lname: true } } }
                },
                bookings: {
                    select: { id: true, status: true, createdAt: true, user: { select: { fname: true, lname: true } }, status: true, bookingDate: true, booking_hours: true, additionalNote: true, ageGroup: true, numberOfPersons: true ,paymentMethod: true },
                }
            }
        });

        if (currentListing) {
            const acceptedReviews = currentListing.reviews;
            const totalReviews = acceptedReviews.length;
            const averageRating = totalReviews > 0
                ? acceptedReviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews
                : 0;

            const ratingDistribution = {
                                5: acceptedReviews.filter(r => r.rating === 5).length,
                                4: acceptedReviews.filter(r => r.rating === 4).length,
                                3: acceptedReviews.filter(r => r.rating === 3).length,
                                2: acceptedReviews.filter(r => r.rating === 2).length,
                                1: acceptedReviews.filter(r => r.rating === 1).length
                            };

                            const listingWithStats = {
                                ...currentListing,
                                averageRating: Math.round(averageRating * 10) / 10,
                                totalReviews,
                                ratingDistribution,
                                totalBookings: currentListing.bookings.length,
                                confirmedBookings: currentListing.bookings.filter(b => b.status === 'CONFIRMED').length
                            };
                            
                            const translatedListing = await translateListingFields(listingWithStats, "AR", "EN");
                            await redisClient.setEx(listingCacheKey, AR_CACHE_EXPIRATION, JSON.stringify(translatedListing));
                        }
                    }
                } catch (bgError) {
                    console.error(`Background task error for booking ${booking.id}:`, bgError);
                }
            });

            recordAuditLog(AuditLogAction.BOOKING_CREATED, {
                userId: user.id,
                entityName: 'Booking',
                entityId: booking.id.toString(),
                newValues: booking,
                description: `Booking request for '${listing.name}' created by ${user.email}.`,
                ipAddress: reqDetails.ipAddress,
                userAgent: reqDetails.userAgent,
            });

            return immediateResponse;
        } catch (error) {
            console.error(`Failed to create booking: ${error.message}`);
            throw new Error(`Failed to create booking: ${error.message}`);
        }
    },

    // 2. Get All Bookings with Filters
    async getAllBookings(filters = {}, lang = 'en') {
        try {
            const { page = 1, limit = 10, ...restFilters } = filters;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;
            const filterHash = createFilterHash({ ...restFilters, page: pageNum, limit: limitNum });
            const cacheKey = cacheKeys.allBookingsAr(filterHash);

            if (lang === 'ar' && redisClient.isReady) {
                const cachedData = await redisClient.get(cacheKey);
                if (cachedData) return JSON.parse(cachedData);
            }
            
            // Build where clause from filters (simplified for example)
            const whereClause = {
                ...(restFilters.status && { status: restFilters.status }),
                ...(restFilters.listingId && { listingId: parseInt(restFilters.listingId) }),
            };

            const [bookings, total] = await prisma.$transaction([
                prisma.booking.findMany({
                    where: whereClause,
                    include: { user: {select: {uid: true, fname: true, lname: true}}, listing: true, review: true, reward: true },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum
                }),
                prisma.booking.count({ where: whereClause })
            ]);

            let result = {
                bookings,
                pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) }
            };

            if (lang === 'ar' && deeplClient) {
                result.bookings = await Promise.all(bookings.map(b => translateBookingFields(b, 'AR', 'EN')));
                if (redisClient.isReady) await redisClient.setEx(cacheKey, AR_CACHE_EXPIRATION, JSON.stringify(result));
            }

            return result;
        } catch (error) {
            console.error(`Failed to get all bookings: ${error.message}`);
            throw new Error(`Failed to get all bookings: ${error.message}`);
        }
    },

    // 3. Get Booking by ID
    async getBookingById(id, lang = 'en') {
        try {
            const bookingId = parseInt(id);
            const cacheKey = cacheKeys.bookingAr(bookingId);

            if (lang === 'ar' && redisClient.isReady) {
                const cachedBooking = await redisClient.get(cacheKey);
                if (cachedBooking) return JSON.parse(cachedBooking);
            }

            const booking = await prisma.booking.findUnique({
                where: { id: bookingId },
                include: { user: true, listing: true, review: true, reward: true }
            });

            if (!booking) return null;

            if (lang === 'ar' && deeplClient) {
                const translatedBooking = await translateBookingFields(booking, 'AR', 'EN');
                if (redisClient.isReady) await redisClient.setEx(cacheKey, AR_CACHE_EXPIRATION, JSON.stringify(translatedBooking));
                return translatedBooking;
            }

            return booking;
        } catch (error) {
            console.error(`Failed to get booking by ID ${id}: ${error.message}`);
            throw new Error(`Failed to get booking by ID ${id}: ${error.message}`);
        }
    },

    // 4. Get Bookings by User UID
    async getBookingsByUserUid(uid, lang = 'en') {
        try {
            const cacheKey = cacheKeys.userBookingsAr(uid);

            if (lang === 'ar' && redisClient.isReady) {
                const cachedBookings = await redisClient.get(cacheKey);
                if (cachedBookings) return JSON.parse(cachedBookings);
            }

            const bookings = await prisma.booking.findMany({
                where: { user: { uid: uid } },
                include: { listing: true, review: true, reward: true },
                orderBy: { createdAt: 'desc' }
            });

            if (lang === 'ar' && deeplClient) {
                const translatedBookings = await Promise.all(bookings.map(b => translateBookingFields(b, 'AR', 'EN')));
                if (redisClient.isReady) await redisClient.setEx(cacheKey, AR_CACHE_EXPIRATION, JSON.stringify(translatedBookings));
                return translatedBookings;
            }

            return bookings;
        } catch (error) {
            console.error(`Failed to get bookings for user ${uid}: ${error.message}`);
            throw new Error(`Failed to get bookings for user ${uid}: ${error.message}`);
        }
    },

    // 5. Update Booking
    async updateBooking(id, data, lang = 'en', reqDetails = {}) {
        try {
            const bookingId = parseInt(id);
            const currentBooking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { user: true } });
            if (!currentBooking) throw new Error('Booking not found');

            let updateData = { ...data };
            if (lang === 'ar' && deeplClient) {
                if (data.additionalNote) updateData.additionalNote = await translateText(data.additionalNote, 'EN-US', 'AR');
                if (data.booking_hours) updateData.booking_hours = await translateText(data.booking_hours, 'EN-US', 'AR');
            }
            if (data.bookingDate) updateData.bookingDate = new Date(data.bookingDate);
            if (data.numberOfPersons) updateData.numberOfPersons = parseInt(data.numberOfPersons);

            const updatedBooking = await prisma.booking.update({
                where: { id: bookingId },
                data: updateData,
                include: { user: true, listing: true, review: true, reward: true }
            });

            setImmediate(async () => {
                if (redisClient.isReady) {
                    const keysToDel = [cacheKeys.bookingAr(bookingId), cacheKeys.userBookingsAr(currentBooking.user.uid), cacheKeys.listingBookingsAr(currentBooking.listingId)];
                    const allBookingsKeys = await redisClient.keys(cacheKeys.allBookingsAr('*'));
                    if (allBookingsKeys.length) keysToDel.push(...allBookingsKeys);
                    if (keysToDel.length > 0) await redisClient.del(keysToDel);
                }
            });

            recordAuditLog(AuditLogAction.BOOKING_UPDATED, {
                userId: reqDetails.actorUserId, entityName: 'Booking', entityId: bookingId.toString(),
                oldValues: currentBooking, newValues: updatedBooking, description: `Booking ${bookingId} updated.`,
                ipAddress: reqDetails.ipAddress, userAgent: reqDetails.userAgent,
            });

            if (lang === 'ar' && deeplClient) {
                return await translateBookingFields(updatedBooking, 'AR', 'EN');
            }
            return updatedBooking;
        } catch (error) {
            console.error(`Failed to update booking ${id}: ${error.message}`);
            throw new Error(`Failed to update booking ${id}: ${error.message}`);
        }
    },

    // 6. Delete Booking
    async deleteBooking(id, reqDetails = {}) {
        try {
            const bookingId = parseInt(id);
            const bookingToDelete = await prisma.booking.findUnique({ where: { id: bookingId }, include: { user: true } });
            if (!bookingToDelete) throw new Error('Booking not found');

            // Concurrently delete related records and the booking itself
            await prisma.$transaction([
                prisma.reward.deleteMany({ where: { bookingId: bookingId } }),
                prisma.notification.deleteMany({ where: { entityId: id.toString(), entityType: 'Booking' }}),
                prisma.booking.delete({ where: { id: bookingId } })
            ]);

            setImmediate(async () => {
                if (redisClient.isReady) {
                    const keysToDel = [cacheKeys.bookingAr(bookingId), cacheKeys.userBookingsAr(bookingToDelete.user.uid), cacheKeys.listingBookingsAr(bookingToDelete.listingId)];
                    const allBookingsKeys = await redisClient.keys(cacheKeys.allBookingsAr('*'));
                    if (allBookingsKeys.length) keysToDel.push(...allBookingsKeys);
                    if (keysToDel.length > 0) await redisClient.del(keysToDel);
                }
            });

            recordAuditLog(AuditLogAction.BOOKING_CANCELLED, {
                userId: reqDetails.actorUserId, entityName: 'Booking', entityId: bookingId.toString(),
                oldValues: bookingToDelete, description: `Booking ${bookingId} deleted/cancelled.`,
                ipAddress: reqDetails.ipAddress, userAgent: reqDetails.userAgent,
            });

            return { message: `Booking ${bookingId} and related records deleted successfully.`, deletedBookingId: bookingToDelete.id };
        } catch (error) {
            console.error(`Failed to delete booking ${id}: ${error.message}`);
            throw new Error(`Failed to delete booking ${id}: ${error.message}`);
        }
    }
};

export default bookingService;