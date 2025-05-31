-- CreateEnum
CREATE TYPE "BookingPaymentMethod" AS ENUM ('paid', 'unpaid');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "payment_method" "BookingPaymentMethod";
