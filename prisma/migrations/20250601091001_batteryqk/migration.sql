/*
  Warnings:

  - You are about to drop the column `category_id` on the `Listing` table. All the data in the column will be lost.
  - You are about to drop the `Category` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_category_id_fkey";

-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "category_id",
ADD COLUMN     "age_group" TEXT[],
ADD COLUMN     "facilities" TEXT[],
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "location" TEXT;

-- DropTable
DROP TABLE "Category";

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
CREATE UNIQUE INDEX "MainCategoryOption_name_key" ON "MainCategoryOption"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategoryOption_name_key" ON "SubCategoryOption"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SpecificItemOption_name_key" ON "SpecificItemOption"("name");

-- CreateIndex
CREATE INDEX "_ListingToMainCategoryOption_B_index" ON "_ListingToMainCategoryOption"("B");

-- CreateIndex
CREATE INDEX "_ListingToSubCategoryOption_B_index" ON "_ListingToSubCategoryOption"("B");

-- CreateIndex
CREATE INDEX "_ListingToSpecificItemOption_B_index" ON "_ListingToSpecificItemOption"("B");

-- CreateIndex
CREATE INDEX "idx_listing_name" ON "Listing"("name");

-- CreateIndex
CREATE INDEX "idx_listing_price" ON "Listing"("price");

-- AddForeignKey
ALTER TABLE "SubCategoryOption" ADD CONSTRAINT "SubCategoryOption_main_category_id_fkey" FOREIGN KEY ("main_category_id") REFERENCES "MainCategoryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificItemOption" ADD CONSTRAINT "SpecificItemOption_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "SubCategoryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificItemOption" ADD CONSTRAINT "SpecificItemOption_main_category_id_fkey" FOREIGN KEY ("main_category_id") REFERENCES "MainCategoryOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
