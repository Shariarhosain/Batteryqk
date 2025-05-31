/*
  Warnings:

  - The `specific_item` column on the `Category` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `opening_hours` column on the `Category` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `opening_day` to the `Category` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "opening_day" DATE NOT NULL,
DROP COLUMN "specific_item",
ADD COLUMN     "specific_item" TEXT[],
DROP COLUMN "opening_hours",
ADD COLUMN     "opening_hours" TIME[];
