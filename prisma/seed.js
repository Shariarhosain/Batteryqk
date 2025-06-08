import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting seed...');

    // Create 10 Users
    const users = [];
    for (let i = 0; i < 10; i++) {
        const user = await prisma.user.create({
            data: {
                fname: faker.person.firstName(),
                lname: faker.person.lastName(),
                email: faker.internet.email(),
                uid: faker.string.uuid(),
                password: faker.internet.password(),
            },
        });
        users.push(user);
    }
    console.log('Created 10 users');

    // Create 5 Main Categories
    const mainCategories = [];
    const mainCategoryNames = ['Entertainment', 'Sports', 'Education', 'Health & Wellness', 'Adventure'];
    
    for (const name of mainCategoryNames) {
        const mainCategory = await prisma.mainCategoryOption.create({
            data: { name },
        });
        mainCategories.push(mainCategory);
    }
    console.log('Created 5 main categories');

    // Create 3 Sub Categories for each Main Category (15 total)
    const subCategories = [];
    for (const mainCategory of mainCategories) {
        for (let i = 1; i <= 3; i++) {
            const subCategory = await prisma.subCategoryOption.create({
                data: {
                    name: `${mainCategory.name} Sub ${i}`,
                    mainCategoryId: mainCategory.id,
                },
            });
            subCategories.push(subCategory);
        }
    }
    console.log('Created 15 sub categories');

    // Create 15 Specific Items (1 for each sub category)
    const specificItems = [];
    for (const subCategory of subCategories) {
        const specificItem = await prisma.specificItemOption.create({
            data: {
                name: `${subCategory.name} Specific`,
                subCategoryId: subCategory.id,
                mainCategoryId: subCategory.mainCategoryId,
            },
        });
        specificItems.push(specificItem);
    }
    console.log('Created 15 specific items');

    // Create 50 Listings
    const listings = [];
    const ageGroups = ['0-2 year', '3-5 year', '6-10 year', '11-15 year', '25+ year'];
    const facilities = ['WiFi', 'Parking', 'Pool', 'Restaurant', 'Gym', 'Spa', 'Pet Friendly'];
    const operatingHours = ['Mon-Fri: 9am-5pm', 'Sat-Sun: 10am-4pm'];

    for (let i = 0; i < 50; i++) {
        const randomMainCategory = faker.helpers.arrayElement(mainCategories);
        const relatedSubCategories = subCategories.filter(sub => sub.mainCategoryId === randomMainCategory.id);
        const randomSubCategory = faker.helpers.arrayElement(relatedSubCategories);
        const relatedSpecificItems = specificItems.filter(item => item.subCategoryId === randomSubCategory.id);
        const randomSpecificItem = faker.helpers.arrayElement(relatedSpecificItems);

        const listing = await prisma.listing.create({
            data: {
                name: faker.company.name(),
                price: faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
                main_image: faker.image.url(),
                sub_images: Array.from({ length: 3 }, () => faker.image.url()),
                agegroup: faker.helpers.arrayElements(ageGroups, { min: 1, max: 3 }),
                location: [faker.location.city(), faker.location.state(), faker.location.country()],
                facilities: faker.helpers.arrayElements(facilities, { min: 2, max: 5 }),
                operatingHours: operatingHours,
                description: faker.lorem.paragraphs(2),
                selectedMainCategories: {
                    connect: [{ id: randomMainCategory.id }]
                },
                selectedSubCategories: {
                    connect: [{ id: randomSubCategory.id }]
                },
                selectedSpecificItems: {
                    connect: [{ id: randomSpecificItem.id }]
                }
            },
        });
        listings.push(listing);
    }
    console.log('Created 50 listings');

    // Create 25 Bookings
    const bookings = [];
    for (let i = 0; i < 25; i++) {
        const booking = await prisma.booking.create({
            data: {
                userId: faker.helpers.arrayElement(users).id,
                listingId: faker.helpers.arrayElement(listings).id,
                bookingDate: faker.date.future(),
                additionalNote: faker.lorem.sentence(),
                ageGroup: faker.helpers.arrayElement(ageGroups),
                numberOfPersons: faker.number.int({ min: 1, max: 10 }),
                status: faker.helpers.arrayElement(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
            },
        });
        bookings.push(booking);
    }
    console.log('Created 25 bookings');

    // Create 20 Reviews (6 with 5 stars, 14 with random ratings)
    const reviews = [];
    for (let i = 0; i < 20; i++) {
        const rating = i < 6 ? 5 : faker.number.int({ min: 1, max: 5 });
        const review = await prisma.review.create({
            data: {
                userId: faker.helpers.arrayElement(users).id,
                listingId: faker.helpers.arrayElement(listings).id,
                rating: rating,
                status: faker.helpers.arrayElement(['ACCEPTED', 'REJECTED']),
                comment: faker.lorem.paragraph(),
            },
        });
        reviews.push(review);
    }
    console.log('Created 20 reviews');

    // Create Rewards for users
    for (const user of users) {
        await prisma.reward.create({
            data: {
                userId: user.id,
                points: faker.number.int({ min: 100, max: 1000 }),
                description: 'Welcome bonus points',
                reason: 'New user registration',
            },
        });
    }
    console.log('Created rewards for all users');

    // Create Notifications for users
    const notificationTypes = ['BOOKING', 'SYSTEM', 'LOYALTY', 'PROMOTION', 'REMINDER', 'CANCELLATION', 'GENERAL'];
    for (const user of users) {
        for (let i = 0; i < 3; i++) {
            await prisma.notification.create({
                data: {
                    userId: user.id,
                    title: faker.lorem.words(3),
                    message: faker.lorem.sentence(),
                    type: faker.helpers.arrayElement(notificationTypes),
                    isRead: faker.datatype.boolean(),
                    link: faker.internet.url(),
                    entityId: faker.string.uuid(),
                    entityType: 'booking',
                },
            });
        }
    }
    console.log('Created notifications for all users');

    // Create Audit Logs
    const auditActions = ['USER_REGISTERED', 'BOOKING_CREATED', 'LISTING_CREATED', 'NOTIFICATION_SENT'];
    for (let i = 0; i < 50; i++) {
        await prisma.auditLog.create({
            data: {
                userId: faker.helpers.arrayElement(users).id,
                action: faker.helpers.arrayElement(auditActions),
                entityName: faker.helpers.arrayElement(['User', 'Booking', 'Listing']),
                entityId: faker.string.uuid(),
                description: faker.lorem.sentence(),
                ipAddress: faker.internet.ip(),
                userAgent: faker.internet.userAgent(),
            },
        });
    }
    console.log('Created 50 audit logs');

    console.log('Seed completed successfully!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });