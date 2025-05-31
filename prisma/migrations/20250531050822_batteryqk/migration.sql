/*
  Warnings:

  - You are about to drop the column `age` on the `Category` table. All the data in the column will be lost.
  - You are about to drop the column `facilities` on the `Category` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Category` table. All the data in the column will be lost.
  - You are about to drop the column `opening_day` on the `Category` table. All the data in the column will be lost.
  - You are about to drop the column `opening_hours` on the `Category` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Category" DROP COLUMN "age",
DROP COLUMN "facilities",
DROP COLUMN "location",
DROP COLUMN "opening_day",
DROP COLUMN "opening_hours";
