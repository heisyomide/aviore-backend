-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'WITHDRAW', 'REFUND');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "commission" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
ADD COLUMN     "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "walletBalance" DECIMAL(65,30) NOT NULL DEFAULT 0.0;

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_reference_key" ON "WalletTransaction"("reference");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
