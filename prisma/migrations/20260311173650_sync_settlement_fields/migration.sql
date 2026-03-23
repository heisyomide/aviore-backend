-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SALE_SETTLEMENT';

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "metadata" JSONB;
