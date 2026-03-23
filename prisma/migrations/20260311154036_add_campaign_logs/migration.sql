-- CreateTable
CREATE TABLE "OrderCampaign" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCampaign_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrderCampaign" ADD CONSTRAINT "OrderCampaign_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
