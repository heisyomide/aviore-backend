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
    name: 'Electronics',
    children: [
      { name: 'Mobile & Accessories', children: ['Smartphones', 'Feature Phones', 'Phone Cases', 'Screen Protectors', 'Chargers & Cables', 'Power Banks', 'Smartwatches', 'Earbuds & Headphones'] },
      { name: 'Computers', children: ['Laptops', 'Desktops', 'Monitors', 'Keyboards & Mouse', 'Storage Devices', 'Computer Accessories'] },
      { name: 'TV & Home Entertainment', children: ['Smart TVs', 'Projectors', 'Soundbars', 'Home Theater Systems', 'Streaming Devices'] },
      { name: 'Gaming', children: ['Consoles', 'Game Controllers', 'Video Games', 'Gaming Accessories'] },
    ],
  },
  {
    name: 'Fashion',
    children: [
      { name: 'Men', children: ['T-Shirts', 'Shirts', 'Jeans', 'Trousers', 'Suits', 'Footwear', 'Watches', 'Sunglasses'] },
      { name: 'Women', children: ['Dresses', 'Tops', 'Skirts', 'Jeans', 'Handbags', 'Heels', 'Jewelry'] },
      { name: 'Kids & Baby', children: ['Boys Clothing', 'Girls Clothing', 'Baby Essentials', 'School Shoes'] },
    ],
  },
  {
    name: 'Home & Living',
    children: [
      { name: 'Furniture', children: ['Sofas', 'Beds', 'Wardrobes', 'Office Chairs', 'Tables'] },
      { name: 'Home Decor', children: ['Wall Art', 'Mirrors', 'Lighting', 'Curtains', 'Rugs'] },
      { name: 'Kitchen & Dining', children: ['Cookware', 'Utensils', 'Plates & Cups', 'Storage Containers'] },
      { name: 'Home Appliances', children: ['Refrigerators', 'Washing Machines', 'Microwaves', 'Blenders', 'Irons'] },
    ],
  },
  { name: 'Groceries & Food', children: ['Beverages', 'Snacks', 'Rice & Grains', 'Oils', 'Canned Foods', 'Spices', 'Frozen Foods'] },
  { name: 'Beauty & Personal Care', children: ['Skincare', 'Haircare', 'Makeup', 'Fragrances', 'Grooming Kits', 'Shaving Products'] },
  { name: 'Health & Fitness', children: ['Supplements', 'Gym Equipment', 'Fitness Accessories', 'Medical Supplies', 'First Aid'] },
  { name: 'Automobile', children: ['Car Accessories', 'Car Parts', 'Motorcycles', 'Tires', 'Car Electronics'] },
  { name: 'Tools & Industrial', children: ['Power Tools', 'Hand Tools', 'Safety Equipment', 'Construction Materials'] },
  { name: 'Books & Media', children: ['Books', 'E-books', 'Stationery', 'Educational Materials'] },
  { name: 'Pets', children: ['Pet Food', 'Pet Toys', 'Pet Grooming', 'Pet Accessories'] },
  { name: 'Arts & Crafts', children: ['Painting Supplies', 'DIY Materials', 'Craft Tools'] },
  { name: 'Events & Party Supplies', children: ['Decorations', 'Balloons', 'Gift Items', 'Party Favors'] },
  { name: 'Business & Office', children: ['Office Supplies', 'Office Furniture', 'POS Machines', 'Packaging Materials'] },
  { name: 'Digital Products', children: ['E-books', 'Design Templates', 'Software', 'Online Courses'] },
  { name: 'Real Estate', children: ['Land', 'Houses for Sale', 'Rentals', 'Commercial Property'] },
  { name: 'Services', children: ['Home Cleaning', 'Repair Services', 'Photography', 'Event Planning', 'Freelance Services'] },
  { name: 'Luxury & Premium', children: ['Designer Fashion', 'High-end Watches', 'Premium Electronics'] },
  { name: 'Clearance & Deals', children: ['Flash Sales', 'Discounted Items', 'Bundles'] },
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

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);

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
          email: 'vendor@aviore.com',
          password: hashedPassword,
          role: 'VENDOR',
          firstName: 'Avicore',
          lastName: 'Official'
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