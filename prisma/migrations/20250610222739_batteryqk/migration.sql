/*
  Warnings:

  - You are about to drop the column `reward_id` on the `Booking` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[booking_id]` on the table `Reward` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_reward_id_fkey";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "reward_id";

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "booking_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Reward_booking_id_key" ON "Reward"("booking_id");

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
