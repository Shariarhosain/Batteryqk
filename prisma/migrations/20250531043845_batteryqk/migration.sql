/*
  Warnings:

  - The `age` column on the `Category` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `facilities` column on the `Category` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `opening_day` column on the `Category` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Category" DROP COLUMN "age",
ADD COLUMN     "age" TEXT[],
DROP COLUMN "facilities",
ADD COLUMN     "facilities" TEXT[],
DROP COLUMN "opening_day",
ADD COLUMN     "opening_day" TEXT[],
ALTER COLUMN "opening_hours" SET DATA TYPE TEXT[];
