import prisma from '../utils/prismaClient.js';
import { recordAuditLog } from '../utils/auditLogHandler.js';
import { AuditLogAction } from '@prisma/client';
import * as deepl from "deepl-node";
import nodemailer from 'nodemailer';

// --- DeepL Configuration ---
const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY || "YOUR_DEEPL_AUTH_KEY_HERE";
const deeplClient = DEEPL_AUTH_KEY !== "YOUR_DEEPL_AUTH_KEY_HERE" ? new deepl.Translator(DEEPL_AUTH_KEY) : null;

// --- Email Configuration ---
const transporter = nodemailer.createTransport({
    // Configure your email service here
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

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

async function sendBookingEmails(booking, listing, user, lang) {
    const userEmailLang = lang === 'ar' ? 'AR' : 'EN';
    const adminEmailLang = 'EN'; // Admin always gets English
    
    // User email content
    let userSubject = lang === 'ar' ? 'تأكيد الحجز' : 'Booking Confirmation';
    let userMessage = lang === 'ar' 
        ? `مرحباً ${user.fname || 'العميل'},\n\nتم تأكيد حجزك للخدمة: ${listing.name}\nتاريخ الحجز: ${booking.bookingDate}\nعدد الأشخاص: ${booking.numberOfPersons}\n\nشكراً لاختيارك خدماتنا.`
        : `Hello ${user.fname || 'Customer'},\n\nYour booking has been confirmed for: ${listing.name}\nBooking Date: ${booking.bookingDate}\nNumber of Persons: ${booking.numberOfPersons}\n\nThank you for choosing our services.`;

    // Admin email content (always in English)
    let adminSubject = 'New Booking Notification';
    let adminMessage = `Hello,\n\nA new booking has been created for your listing: ${listing.name}\nCustomer: ${user.fname} ${user.lname}\nEmail: ${user.email}\nBooking Date: ${booking.bookingDate}\nNumber of Persons: ${booking.numberOfPersons}\n\nPlease review and manage this booking.`;

    // Send emails
    try {
        // Send to user
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: userSubject,
            text: userMessage
        });

        // Send to admin (you'll need to implement admin lookup logic)
        // For now, using a default admin email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.ADMIN_EMAIL,
            subject: adminSubject,
            text: adminMessage
        });
    } catch (error) {
        console.error('Email sending error:', error);
    }
}

const bookingService = {
    // 1. Create booking
    
async createBooking(data, userId, lang = 'en', reqDetails = {}) {
    try {
        const { listingId, bookingDate, additionalNote, numberOfPersons, ageGroup } = data;

        // Get listing details
        const listing = await prisma.listing.findUnique({
            where: { id: listingId },
            include: {
                selectedMainCategories: true,
                selectedSubCategories: true,
                selectedSpecificItems: true
            }
        });

        if (!listing) {
            return null; // Listing not found
        }

        // Get user details
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return null; // User not found
        }

        // Handle translation based on language
        let noteForDatabase = additionalNote;
        const originalNote = additionalNote; // Keep original for return

        if (lang === 'ar' && additionalNote && deeplClient) {
            // If Arabic, translate to English for database storage
            noteForDatabase = await translateText(additionalNote, 'EN-US', 'AR');
        }
        // If English, store directly without translation

        // Create booking
        const booking = await prisma.booking.create({
            data: {
                userId: userId,
                listingId: listingId,
                bookingDate: bookingDate ? new Date(bookingDate) : null,
                additionalNote: noteForDatabase, // Store English in DB
                ageGroup: ageGroup,
                numberOfPersons: numberOfPersons ? parseInt(numberOfPersons) : null,
                status: 'PENDING'
            },
            include: {
                user: true,
                listing: {
                    include: {
                        selectedMainCategories: true,
                        selectedSubCategories: true,
                        selectedSpecificItems: true
                    }
                },
                review: true
            }
        });

        // Create reward (50 points)
      

        // Create notification
        
     

        // Send emails
        await sendBookingEmails(booking, listing, user, lang);

        // Record audit log
        recordAuditLog(AuditLogAction.BOOKING_CREATED, {
            userId: userId,
            entityName: 'Booking',
            entityId: booking.id,
            newValues: booking,
            description: `Booking created for listing '${listing.name}'`,
            ipAddress: reqDetails.ipAddress,
            userAgent: reqDetails.userAgent,
        });

        // Return booking in requested language
        let result = booking;
        if (lang === 'ar' && deeplClient) {
            result = {
                ...booking,
                additionalNote: originalNote, // Return original Arabic note
                listing: {
                    ...booking.listing,
                    name: await translateText(booking.listing.name, 'AR', 'EN'),
                    description: await translateText(booking.listing.description, 'AR', 'EN')
                }
            };
        }

        return result;
    } catch (error) {
        throw new Error(`Failed to create booking: ${error.message}`);
    }
},

    // 2. Get all bookings with filters and pagination
    async getAllBookings(filters = {}, lang = 'en') {
        try {
            const {
                page = 1,
                limit = 10,
                date,
                agegroup,
                status,
                mainCategoryIds,
                subCategoryIds,
                specificItemIds,
                minPrice,
                maxPrice
            } = filters;

            const skip = (page - 1) * limit;

            // Build where clause
            let whereClause = {};

            if (date) {
                whereClause.bookingDate = {
                    gte: new Date(date),
                    lt: new Date(new Date(date).getTime() + 24 * 60 * 60 * 1000)
                };
            }

            if (status) {
                whereClause.status = status;
            }

            // Listing filters
            let listingFilters = {};

            if (agegroup) {
                listingFilters.agegroup = {
                    hasSome: Array.isArray(agegroup) ? agegroup : [agegroup]
                };
            }

            if (mainCategoryIds && mainCategoryIds.length > 0) {
                listingFilters.selectedMainCategories = {
                    some: {
                        id: { in: mainCategoryIds.map(id => parseInt(id)) }
                    }
                };
            }

            if (subCategoryIds && subCategoryIds.length > 0) {
                listingFilters.selectedSubCategories = {
                    some: {
                        id: { in: subCategoryIds.map(id => parseInt(id)) }
                    }
                };
            }

            if (specificItemIds && specificItemIds.length > 0) {
                listingFilters.selectedSpecificItems = {
                    some: {
                        id: { in: specificItemIds.map(id => parseInt(id)) }
                    }
                };
            }

            if (minPrice || maxPrice) {
                listingFilters.price = {};
                if (minPrice) listingFilters.price.gte = parseFloat(minPrice);
                if (maxPrice) listingFilters.price.lte = parseFloat(maxPrice);
            }

            if (Object.keys(listingFilters).length > 0) {
                whereClause.listing = listingFilters;
            }

            const [bookings, total] = await Promise.all([
                prisma.booking.findMany({
                    where: whereClause,
                    include: {
                        user: {
                            select: {
                                id: true,
                                fname: true,
                                lname: true,
                                email: true
                            }
                        },
                        listing: {
                            include: {
                                selectedMainCategories: true,
                                selectedSubCategories: true,
                                selectedSpecificItems: true
                            }
                        },
                        review: true
                    },
                    orderBy: { createdAt: 'desc' },
                    skip: skip,
                    take: parseInt(limit)
                }),
                prisma.booking.count({ where: whereClause })
            ]);

            let result = bookings;

            // Translate if Arabic
            if (lang === 'ar' && deeplClient) {
                result = await Promise.all(
                    bookings.map(async (booking) => ({
                        ...booking,
                        additionalNote: booking.additionalNote ? await translateText(booking.additionalNote, 'AR', 'EN') : booking.additionalNote,
                        listing: booking.listing ? {
                            ...booking.listing,
                            name: await translateText(booking.listing.name, 'AR', 'EN'),
                            description: await translateText(booking.listing.description, 'AR', 'EN')
                        } : null,
                        review: booking.review ? {
                            ...booking.review,
                            comment: await translateText(booking.review.comment, 'AR', 'EN')
                        } : null
                    }))
                );
            }

            return {
                bookings: result,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            throw new Error(`Failed to get bookings: ${error.message}`);
        }
    },

    // 3. Get booking by ID
    async getBookingById(id, lang = 'en') {
        try {
            const booking = await prisma.booking.findUnique({
                where: { id: parseInt(id) },
                include: {
                    user: {
                        select: {
                            id: true,
                            fname: true,
                            lname: true,
                            email: true
                        }
                    },
                    listing: {
                        include: {
                            selectedMainCategories: true,
                            selectedSubCategories: true,
                            selectedSpecificItems: true
                        }
                    },
                    review: true
                }
            });

            if (!booking) return null;

            let result = booking;

            // Translate if Arabic
            if (lang === 'ar' && deeplClient) {
                result = {
                    ...booking,
                    additionalNote: booking.additionalNote ? await translateText(booking.additionalNote, 'AR', 'EN') : booking.additionalNote,
                    listing: booking.listing ? {
                        ...booking.listing,
                        name: await translateText(booking.listing.name, 'AR', 'EN'),
                        description: await translateText(booking.listing.description, 'AR', 'EN')
                    } : null,
                    review: booking.review ? {
                        ...booking.review,
                        comment: await translateText(booking.review.comment, 'AR', 'EN')
                    } : null
                };
            }

            return result;
        } catch (error) {
            throw new Error(`Failed to get booking: ${error.message}`);
        }
    },

    // 4. Get bookings by user UID
    async getBookingsByUserUid(uid, lang = 'en') {
        try {
            const user = await prisma.user.findUnique({
                where: { uid: uid }
            });

            if (!user) {
                throw new Error('User not found');
            }

            const bookings = await prisma.booking.findMany({
                where: { userId: user.id },
                include: {
                    listing: {
                        include: {
                            selectedMainCategories: true,
                            selectedSubCategories: true,
                            selectedSpecificItems: true
                        }
                    },
                    review: true
                },
                orderBy: { createdAt: 'desc' }
            });

            let result = bookings;

            // Translate if Arabic
            if (lang === 'ar' && deeplClient) {
                result = await Promise.all(
                    bookings.map(async (booking) => ({
                        ...booking,
                        additionalNote: booking.additionalNote ? await translateText(booking.additionalNote, 'AR', 'EN') : booking.additionalNote,
                        listing: booking.listing ? {
                            ...booking.listing,
                            name: await translateText(booking.listing.name, 'AR', 'EN'),
                            description: await translateText(booking.listing.description, 'AR', 'EN')
                        } : null,
                        review: booking.review ? {
                            ...booking.review,
                            comment: await translateText(booking.review.comment, 'AR', 'EN')
                        } : null
                    }))
                );
            }

            return result;
        } catch (error) {
            throw new Error(`Failed to get user bookings: ${error.message}`);
        }
    },

    // 5. Update booking
    async updateBooking(id, data, lang = 'en', reqDetails = {}) {
        try {
            const bookingId = parseInt(id);
            
            const currentBooking = await prisma.booking.findUnique({
                where: { id: bookingId },
                include: {
                    listing: true,
                    user: true
                }
            });

            if (!currentBooking) {
                throw new Error('Booking not found');
            }

            let updateData = { ...data };

            // Translate additional note if Arabic
            if (lang === 'ar' && data.additionalNote && deeplClient) {
                updateData.additionalNote = await translateText(data.additionalNote, 'EN-US', 'AR');
            }

            // Update booking date if provided
            if (data.bookingDate) {
                updateData.bookingDate = new Date(data.bookingDate);
            }

            // Update number of persons if provided
            if (data.numberOfPersons) {
                updateData.numberOfPersons = parseInt(data.numberOfPersons);
            }

            const updatedBooking = await prisma.booking.update({
                where: { id: bookingId },
                data: updateData,
                include: {
                    user: {
                        select: {
                            id: true,
                            fname: true,
                            lname: true,
                            email: true
                        }
                    },
                    listing: {
                        include: {
                            selectedMainCategories: true,
                            selectedSubCategories: true,
                            selectedSpecificItems: true
                        }
                    },
                    review: true
                }
            });

            // Record audit log
            recordAuditLog(AuditLogAction.BOOKING_UPDATED, {
                userId: reqDetails.actorUserId,
                entityName: 'Booking',
                entityId: bookingId,
                oldValues: currentBooking,
                newValues: updatedBooking,
                description: `Booking ${bookingId} updated`,
                ipAddress: reqDetails.ipAddress,
                userAgent: reqDetails.userAgent,
            });

            let result = updatedBooking;

            // Return in requested language
            if (lang === 'ar' && deeplClient) {
                result = {
                    ...updatedBooking,
                    additionalNote: data.additionalNote || updatedBooking.additionalNote,
                    listing: updatedBooking.listing ? {
                        ...updatedBooking.listing,
                        name: await translateText(updatedBooking.listing.name, 'AR', 'EN'),
                        description: await translateText(updatedBooking.listing.description, 'AR', 'EN')
                    } : null
                };
            }

            return result;
        } catch (error) {
            throw new Error(`Failed to update booking: ${error.message}`);
        }
    },

    // 6. Delete booking
    async deleteBooking(id, reqDetails = {}) {
        try {
            const bookingId = parseInt(id);
            
            const booking = await prisma.booking.findUnique({
                where: { id: bookingId }
            });

            if (!booking) {
                throw new Error('Booking not found');
            }

            // Delete the booking (this will set related review's booking field to null due to schema)
            const deletedBooking = await prisma.booking.delete({
                where: { id: bookingId }
            });

            // Record audit log
            recordAuditLog(AuditLogAction.BOOKING_CANCELLED, {
                userId: reqDetails.actorUserId,
                entityName: 'Booking',
                entityId: bookingId,
                oldValues: booking,
                description: `Booking ${bookingId} deleted`,
                ipAddress: reqDetails.ipAddress,
                userAgent: reqDetails.userAgent,
            });

            return deletedBooking;
        } catch (error) {
            throw new Error(`Failed to delete booking: ${error.message}`);
        }
    }
};

export default bookingService;