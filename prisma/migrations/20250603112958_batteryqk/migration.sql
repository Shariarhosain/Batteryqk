/*
  Warnings:

  - You are about to drop the column `coupon_code` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `payment_method` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `booking_id` on the `review` table. All the data in the column will be lost.
  - You are about to drop the `Coupon` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[review_id]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_coupon_code_fkey";

-- DropForeignKey
ALTER TABLE "review" DROP CONSTRAINT "review_booking_id_fkey";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "coupon_code",
DROP COLUMN "payment_method",
ADD COLUMN     "review_id" INTEGER,
ADD COLUMN     "reward_id" INTEGER;

-- AlterTable
ALTER TABLE "review" DROP COLUMN "booking_id";

-- DropTable
DROP TABLE "Coupon";

-- CreateIndex
CREATE UNIQUE INDEX "Booking_review_id_key" ON "Booking"("review_id");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "Reward"("id") ON DELETE SET NULL ON UPDATE CASCADE;
