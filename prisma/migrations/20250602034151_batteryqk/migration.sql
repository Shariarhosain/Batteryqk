/*
  Warnings:

  - The `location` column on the `Listing` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "location",
ADD COLUMN     "location" TEXT[];
