import { Prisma } from '@prisma/client';

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    images?: { select: { imageUrl: true } } | true;
    variants?: { select: { id: true; price: true; sku?: true; stock: true } } | true;
    vendor?: { select: { id: true; storeName: true; isVerified: true; imageUrl?: true } };
    category?: { select: { name: true; slug: true } };
  };
}>;

export interface NormalizedProductOutput {
  id: string;
  title: string;
  slug?: string;
  price: number;
  stock: number;
  displayPrice: number;
  totalStock: number;
  image: string;
  description?: string;
  createdAt: Date;
  vendorId: string;
  categoryId: string;
  vendor?: { id: string; storeName: string; isVerified: boolean; imageUrl?: string | null };
  category?: { name: string; slug: string };
  [key: string]: any; // Allow for extra properties like campaign discounts passed downstream
}

export function resolveImage(product: ProductWithRelations): string {
  const firstVariantImage = (product.variants as any)?.[0]?.images?.[0]?.imageUrl;
  const firstProductImage = (product.images as any)?.[0]?.imageUrl;
  return firstVariantImage || firstProductImage || '/placeholder.png';
}

export function calculateVariantPrice(product: ProductWithRelations): number {
  const variants = (product.variants || []) as any[];
  const variantPrices = variants.map((v) => Number(v.price) || 0).filter(Boolean);
  return variantPrices.length > 0 ? Math.min(...variantPrices) : Number(product.price) || 0;
}

export function calculateTotalStock(product: ProductWithRelations): number {
  const variants = (product.variants || []) as any[];
  if (variants.length > 0) {
    return variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  }
  return Number(product.stock) || 0;
}

export function normalizeProduct(product: ProductWithRelations): NormalizedProductOutput {
  const displayPrice = calculateVariantPrice(product);
  const totalStock = calculateTotalStock(product);
  const image = resolveImage(product);

  return {
    ...product,
    price: displayPrice,
    stock: totalStock,
    displayPrice,
    totalStock,
    image,
  };
}