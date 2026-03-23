/*
  Warnings:

  - You are about to drop the column `minOrderAmount` on the `Coupon` table. All the data in the column will be lost.
  - You are about to drop the column `validUntil` on the `Coupon` table. All the data in the column will be lost.
  - The `discountType` column on the `Coupon` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `discountValue` on the `Coupon` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - The `status` column on the `Ticket` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `action` on the `AuditLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "AnnouncementTarget" AS ENUM ('ALL', 'USERS', 'VENDORS');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('APPROVE_VENDOR_KYC', 'REJECT_VENDOR_KYC', 'BAN_USER', 'UNBAN_USER', 'DELETE_PRODUCT', 'APPROVE_PRODUCT', 'REJECT_PRODUCT', 'APPROVE_PAYOUT', 'FORCE_REFUND', 'CREATE_COUPON');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FraudType" AS ENUM ('MULTIPLE_FAILED_LOGINS', 'SUSPICIOUS_PAYOUT', 'MULTIPLE_ACCOUNTS', 'RAPID_ORDER_CANCELLATION', 'CHARGEBACK_RISK');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'SELLER_RESPONDED', 'BUYER_RESPONDED', 'UNDER_REVIEW', 'RESOLVED_REFUND', 'RESOLVED_REPLACEMENT', 'REJECTED', 'CLOSED');

-- DropForeignKey
ALTER TABLE "Coupon" DROP CONSTRAINT "Coupon_vendorId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "targetType" TEXT,
DROP COLUMN "action",
ADD COLUMN     "action" "AuditAction" NOT NULL;

-- AlterTable
ALTER TABLE "Coupon" DROP COLUMN "minOrderAmount",
DROP COLUMN "validUntil",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "endDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "minOrderValue" DECIMAL(10,2),
ADD COLUMN     "perUserLimit" INTEGER,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "usageLimit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "usedCount" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "discountType",
ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "vendorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "status",
ADD COLUMN     "status" "TicketStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "targetGroup" "AnnouncementTarget" NOT NULL,
    "adminId" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "vendorId" TEXT,
    "orderId" TEXT,
    "severity" "FraudSeverity" NOT NULL,
    "type" "FraudType" NOT NULL,
    "description" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "refundAmount" DECIMAL(10,2),
    "resolution" TEXT,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeMessage" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudLog_userId_idx" ON "FraudLog"("userId");

-- CreateIndex
CREATE INDEX "FraudLog_vendorId_idx" ON "FraudLog"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_orderId_key" ON "Dispute"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeMessage" ADD CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
