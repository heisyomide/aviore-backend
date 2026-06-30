import { Prisma, ProductStatus, VendorStatus } from '@prisma/client';

export const activeProductFilter: Prisma.ProductWhereInput = {
  status: ProductStatus.APPROVED,
  isActive: true,
  isDeleted: false,
};

export function buildVendorWhereClause(searchTerm?: string): Prisma.VendorWhereInput {
  return {
    status: VendorStatus.ACTIVE,
    isVerified: true,
    NOT: { slug: '' },
    products: {
      some: activeProductFilter,
    },
    ...(searchTerm && {
      OR: [
        { storeName: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
      ],
    }),
  };
}