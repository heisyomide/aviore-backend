/*
  Warnings:

  - You are about to drop the column `storeId` on the `Coupon` table. All the data in the column will be lost.
  - You are about to drop the `Store` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StoreFollower` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `vendorId` to the `Coupon` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Coupon" DROP CONSTRAINT "Coupon_storeId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_storeId_fkey";

-- DropForeignKey
ALTER TABLE "Store" DROP CONSTRAINT "Store_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "StoreFollower" DROP CONSTRAINT "StoreFollower_storeId_fkey";

-- DropForeignKey
ALTER TABLE "StoreFollower" DROP CONSTRAINT "StoreFollower_userId_fkey";

-- AlterTable
ALTER TABLE "Coupon" DROP COLUMN "storeId",
ADD COLUMN     "vendorId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Store";

-- DropTable
DROP TABLE "StoreFollower";

-- CreateTable
CREATE TABLE "VendorFollower" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorFollower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowsingHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowsingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorFollower_vendorId_userId_key" ON "VendorFollower"("vendorId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BrowsingHistory_userId_productId_key" ON "BrowsingHistory"("userId", "productId");

-- AddForeignKey
ALTER TABLE "VendorFollower" ADD CONSTRAINT "VendorFollower_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorFollower" ADD CONSTRAINT "VendorFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowsingHistory" ADD CONSTRAINT "BrowsingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowsingHistory" ADD CONSTRAINT "BrowsingHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
