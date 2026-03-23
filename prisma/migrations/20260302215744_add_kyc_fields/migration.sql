-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NOT_SUBMITTED');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "idImage" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" TEXT,
ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED';
