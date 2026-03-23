/*
  Warnings:

  - Made the column `perUserLimit` on table `Coupon` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PLATFORM', 'VENDOR');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_COUPON';

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "maxDiscountAmount" DECIMAL(10,2),
ADD COLUMN     "type" "CouponType" NOT NULL DEFAULT 'VENDOR',
ALTER COLUMN "endDate" DROP DEFAULT,
ALTER COLUMN "perUserLimit" SET NOT NULL,
ALTER COLUMN "perUserLimit" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponId" TEXT;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignParticipant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignParticipant_campaignId_vendorId_key" ON "CampaignParticipant"("campaignId", "vendorId");

-- CreateIndex
CREATE INDEX "Coupon_vendorId_idx" ON "Coupon"("vendorId");

-- CreateIndex
CREATE INDEX "Coupon_isActive_startDate_endDate_idx" ON "Coupon"("isActive", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignParticipant" ADD CONSTRAINT "CampaignParticipant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignParticipant" ADD CONSTRAINT "CampaignParticipant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
