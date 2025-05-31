/*
  Warnings:

  - You are about to drop the column `images` on the `Listing` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "images",
ADD COLUMN     "main_image" TEXT,
ADD COLUMN     "sub_images" TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "password" TEXT;
