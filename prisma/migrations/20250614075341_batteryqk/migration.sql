/*
  Warnings:

  - A unique constraint covering the columns `[sub_category_id,name]` on the table `SpecificItemOption` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[main_category_id,name]` on the table `SubCategoryOption` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "SpecificItemOption" DROP CONSTRAINT "SpecificItemOption_main_category_id_fkey";

-- DropForeignKey
ALTER TABLE "SpecificItemOption" DROP CONSTRAINT "SpecificItemOption_sub_category_id_fkey";

-- DropForeignKey
ALTER TABLE "SubCategoryOption" DROP CONSTRAINT "SubCategoryOption_main_category_id_fkey";

-- DropIndex
DROP INDEX "SpecificItemOption_name_key";

-- DropIndex
DROP INDEX "SubCategoryOption_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "SpecificItemOption_sub_category_id_name_key" ON "SpecificItemOption"("sub_category_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubCategoryOption_main_category_id_name_key" ON "SubCategoryOption"("main_category_id", "name");

-- AddForeignKey
ALTER TABLE "SubCategoryOption" ADD CONSTRAINT "SubCategoryOption_main_category_id_fkey" FOREIGN KEY ("main_category_id") REFERENCES "MainCategoryOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificItemOption" ADD CONSTRAINT "SpecificItemOption_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "SubCategoryOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecificItemOption" ADD CONSTRAINT "SpecificItemOption_main_category_id_fkey" FOREIGN KEY ("main_category_id") REFERENCES "MainCategoryOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
