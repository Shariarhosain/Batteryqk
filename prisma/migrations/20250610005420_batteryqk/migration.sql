/*
  Warnings:

  - You are about to drop the column `reason` on the `Reward` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "reward_category" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- AlterTable
ALTER TABLE "Reward" DROP COLUMN "reason",
ADD COLUMN     "category" "reward_category" DEFAULT 'BRONZE';
