import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcrypt';

dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// --- COMPLETE CATEGORY DATA ---
const categoriesData = [
  {
    name: 'Fashion',
    children: [
      {
        name: 'Women Fashion',
        children: [
          'Dresses',
          'Tops',
          'Jeans',
          'Skirts',
          'Two Piece Sets',
          'Lingerie',
          'Abayas',
          'Jumpsuits',
        ],
      },

      {
        name: 'Men Fashion',
        children: [
          'Shirts',
          'T-Shirts',
          'Jeans',
          'Native Wear',
          'Trousers',
          'Suits',
          'Shorts',
        ],
      },

      {
        name: 'Footwear',
        children: [
          'Sneakers',
          'Heels',
          'Slides',
          'Sandals',
          'Boots',
        ],
      },

      {
        name: 'Bags',
        children: [
          'Handbags',
          'Crossbody Bags',
          'Backpacks',
          'Wallets',
        ],
      },

      {
        name: 'Watches & Jewelry',
        children: [
          'Watches',
          'Necklaces',
          'Bracelets',
          'Rings',
          'Earrings',
        ],
      },

      {
        name: 'Wigs & Hair',
        children: [
          'Human Hair',
          'Bone Straight',
          'Curly Wigs',
          'Frontal Wigs',
          'Closures',
          'Hair Bundles',
        ],
      },
    ],
  },

  {
    name: 'Beauty & Skincare',
    children: [
      {
        name: 'Skincare',
        children: [
          'Face Creams',
          'Body Creams',
          'Face Wash',
          'Serums',
          'Sunscreen',
          'Soaps',
        ],
      },

      {
        name: 'Makeup',
        children: [
          'Lipsticks',
          'Powders',
          'Foundations',
          'Lashes',
          'Beauty Tools',
        ],
      },

      {
        name: 'Fragrances',
        children: [
          'Perfumes',
          'Body Sprays',
          'Oils',
        ],
      },

      {
        name: 'Haircare',
        children: [
          'Shampoo',
          'Conditioners',
          'Hair Oils',
          'Hair Treatment',
        ],
      },
    ],
  },

  {
    name: 'Accessories',
    children: [
      'Sunglasses',
      'Caps',
      'Belts',
      'Phone Accessories',
      'Fashion Accessories',
    ],
  },
];

/**
 * RECURSIVE_SEED_ENGINE
 * Generates SEO-friendly hierarchical slugs and nested categories.
 */
async function seedCategory(item: any, parentId: string | null = null, parentSlug: string = "") {
  const baseSlug = item.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
  // Use parent slug prefix to avoid collisions (e.g., 'home-living-e-books' vs 'media-e-books')
  const slug = parentSlug ? `${parentSlug}-${baseSlug}` : baseSlug;
  
  const category = await prisma.category.upsert({
    where: { slug: slug },
    update: { parentId: parentId },
    create: {
      name: item.name,
      slug: slug,
      parentId: parentId,
    },
  });

  if (item.children && item.children.length > 0) {
    for (const child of item.children) {
      const childItem = typeof child === 'string' ? { name: child } : child;
      await seedCategory(childItem, category.id, slug);
    }
  }
}

async function main() {
  console.log('🚀 INITIALIZING_AVIORE_MASTER_SEED...');

  try {
    // 1. DATA PURGE (Nuclear Option)
    console.log('--- PURGING_DATABASE_REGISTRY ---');
    const tablenames = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== '_prisma_migrations')
      .map((name) => `"${name}"`)
      .join(', ');

  

    // 2. CATEGORY HIERARCHY
    console.log('--- BUILDING_CATEGORY_TREE ---');
    for (const rootCat of categoriesData) {
      await seedCategory(rootCat);
    }

    // 3. CORE IDENTITY SEEDING
    console.log('--- GENERATING_MASTER_VENDOR_IDENTITY ---');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash('AvioreVendor2026!', saltRounds);

    // Using a transaction to ensure User and Vendor are created together
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: 'ayomide.com',
          password: hashedPassword,
          role: 'VENDOR',
          firstName: 'Avicore',
          lastName: 'Official',
          referralCode: 'AVR-SEED1',
        },
      });

      const vendor = await tx.vendor.create({
        data: {
          storeName: 'Avicore Official Store',
          userId: user.id,
          isVerified: true,
          kycStatus: 'APPROVED'
        },
      });

      return vendor;
    });

    // 4. PROMOTIONAL ASSETS
    console.log(`--- DEPLOYING_COUPONS: ${result.storeName} ---`);
    await prisma.coupon.create({
      data: {
        code: 'SAVE10',
        description: `10% site-wide discount for ${result.storeName}`,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minOrderValue: 20000,
        startDate: new Date(),
        endDate: new Date('2026-12-31'),
        isActive: true,
        vendorId: result.id,
        usageLimit: 500,
      },
    });

    console.log('✅ SEED_COMPLETE: Platform ecosystem established.');
  } catch (error) {
    console.error('❌ SEED_CRITICAL_FAILURE:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();