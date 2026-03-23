-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "commission" DOUBLE PRECISION,
ADD COLUMN     "payoutStatus" TEXT DEFAULT 'PENDING',
ADD COLUMN     "vendorEarning" DOUBLE PRECISION;
