/*
  Warnings:

  - Added the required column `discount` to the `Campaign` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('LOCKED', 'AVAILABLE', 'PAID', 'REFUNDED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commission" DECIMAL(12,2),
ADD COLUMN     "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'LOCKED',
ADD COLUMN     "totalPaid" DECIMAL(12,2),
ADD COLUMN     "vendorEarning" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "metadata" TEXT;

-- CreateTable
CREATE TABLE "CampaignProduct" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "CampaignProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignProduct_campaignId_productId_key" ON "CampaignProduct"("campaignId", "productId");

-- AddForeignKey
ALTER TABLE "CampaignProduct" ADD CONSTRAINT "CampaignProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProduct" ADD CONSTRAINT "CampaignProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
