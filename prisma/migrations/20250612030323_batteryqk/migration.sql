-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKING', 'SYSTEM', 'LOYALTY', 'PROMOTION', 'REMINDER', 'CANCELLATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AuditLogAction" AS ENUM ('USER_REGISTERED', 'USER_LOGIN', 'USER_PROFILE_UPDATED', 'USER_PASSWORD_CHANGED', 'USER_DELETED', 'BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_COMPLETED', 'BOOKING_UPDATED', 'BOOKING_REMINDER_SENT', 'LISTING_CREATED', 'LISTING_UPDATED', 'LISTING_DELETED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED', 'COUPON_CREATED', 'COUPON_UPDATED', 'COUPON_DELETED', 'COUPON_APPLIED', 'REWARD_GRANTED', 'REWARD_REDEEMED', 'NOTIFICATION_SENT', 'NOTIFICATIONS_MARKED_AS_READ', 'ADMIN_ACTION', 'SYSTEM_EVENT', 'GENERAL_CREATE', 'GENERAL_UPDATE', 'GENERAL_DELETE');

-- CreateEnum
CREATE TYPE "BookingPaymentMethod" AS ENUM ('PAID', 'UNPAID');

-- CreateEnum
CREATE TYPE "reviewStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "reward_category" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "fname" TEXT,
    "lname" TEXT,
    "email" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MainCategoryOption" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MainCategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubCategoryOption" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "main_category_id" INTEGER,

    CONSTRAINT "SubCategoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecificItemOption" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sub_category_id" INTEGER,
    "main_category_id" INTEGER,

    CONSTRAINT "SpecificItemOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "price" DECIMAL(65,30),
    "main_image" TEXT,
    "sub_images" TEXT[],
    "age_group" TEXT[],
    "location" TEXT[],
    "facilities" TEXT[],
    "operating_hours" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "listing_id" INTEGER,
    "rating" INTEGER NOT NULL,
    "status" "reviewStatus",
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "listing_id" INTEGER,
    "booking_date" TIMESTAMP(3),
    "booking_hours" TEXT,
    "additional_note" TEXT,
    "age_group" TEXT,
    "number_of_persons" INTEGER,
    "payment_method" "BookingPaymentMethod" DEFAULT 'UNPAID',
    "status" "BookingStatus" DEFAULT 'PENDING',
    "review_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "points" INTEGER,
    "description" TEXT,
    "category" "reward_category" DEFAULT 'BRONZE',
    "booking_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "entity_id" TEXT,
    "entity_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" INTEGER,
    "action" "AuditLogAction" NOT NULL,
    "entity_name" TEXT,
    "entity_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "description" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ListingToMainCategoryOption" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ListingToMainCategoryOption_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ListingToSubCategoryOption" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ListingToSubCategoryOption_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ListingToSpecificItemOption" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ListingToSpecificItemOption_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_user_id_key" ON "User"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "MainCategoryOption_name_key" ON "MainCategoryOption"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategoryOption_name_key" ON "SubCategoryOption"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SpecificItemOption_name_key" ON "SpecificItemOption"("name");

-- CreateIndex
CREATE INDEX "idx_listing_name" ON "Listing"("name");

-- CreateIndex
CREATE INDEX "idx_listing_price" ON "Listing"("price");

-- CreateIndex
CREATE INDEX "review_user_id_idx" ON "review"("user_id");

-- CreateIndex
CREATE INDEX "review_listing_id_idx" ON "review"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_review_id_key" ON "Booking"("review_id");

-- CreateIndex
CREATE INDEX "Booking_user_id_idx" ON "Booking"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Reward_booking_id_key" ON "Reward"("booking_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_is_read_idx" ON "Notification"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "Notification_user_id_type_idx" ON "Notification"("user_id", "type");

-- CreateIndex
CREATE INDEX "AuditLog_user_id_idx" ON "AuditLog"("user_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_name_entity_id_idx" ON "AuditLog"("entity_name", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "_ListingToMainCategoryOption_B_index" ON "_ListingToMainCategoryOption"("B");

-- CreateIndex
CREATE INDEX "_ListingToSubCategoryOption_B_index" ON "_ListingToSubCategoryOption"("B");

-- CreateIndex
CREATE INDEX "_ListingToSpecificItemOption_B_index" ON "_ListingToSpecificItemOption"("B");

-- AddForeignKey
ALTER TABLE "SubCategoryOption" ADD CONSTRAINT "SubCategoryOption_main_category_id_fkey" FOREIGN KEY ("main_category_id") REFERENCES "MainCategoryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificItemOption" ADD CONSTRAINT "SpecificItemOption_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "SubCategoryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificItemOption" ADD CONSTRAINT "SpecificItemOption_main_category_id_fkey" FOREIGN KEY ("main_category_id") REFERENCES "MainCategoryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListingToMainCategoryOption" ADD CONSTRAINT "_ListingToMainCategoryOption_A_fkey" FOREIGN KEY ("A") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListingToMainCategoryOption" ADD CONSTRAINT "_ListingToMainCategoryOption_B_fkey" FOREIGN KEY ("B") REFERENCES "MainCategoryOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListingToSubCategoryOption" ADD CONSTRAINT "_ListingToSubCategoryOption_A_fkey" FOREIGN KEY ("A") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListingToSubCategoryOption" ADD CONSTRAINT "_ListingToSubCategoryOption_B_fkey" FOREIGN KEY ("B") REFERENCES "SubCategoryOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListingToSpecificItemOption" ADD CONSTRAINT "_ListingToSpecificItemOption_A_fkey" FOREIGN KEY ("A") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListingToSpecificItemOption" ADD CONSTRAINT "_ListingToSpecificItemOption_B_fkey" FOREIGN KEY ("B") REFERENCES "SpecificItemOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
