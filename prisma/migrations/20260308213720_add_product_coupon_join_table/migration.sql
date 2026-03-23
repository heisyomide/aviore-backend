-- CreateTable
CREATE TABLE "ProductCoupon" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductCoupon_couponId_idx" ON "ProductCoupon"("couponId");

-- CreateIndex
CREATE INDEX "ProductCoupon_vendorId_idx" ON "ProductCoupon"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCoupon_productId_couponId_key" ON "ProductCoupon"("productId", "couponId");

-- AddForeignKey
ALTER TABLE "ProductCoupon" ADD CONSTRAINT "ProductCoupon_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCoupon" ADD CONSTRAINT "ProductCoupon_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
