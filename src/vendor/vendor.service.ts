import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Readable } from 'stream';
import { VendorCreateProductDto  } from './dto/vendor-product.dto';
import { OrderStatus, Prisma, ProductStatus } from '@prisma/client'; // Import the auto-generated enum
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; 
import { Roles } from '../auth/roles.decorator';
// Replace your old cloudinary import with this:
import { v2 as cloudinary } from 'cloudinary';
import * as crypto from 'crypto';
import * as Tesseract from 'tesseract.js';
import { NotificationService } from '../notification/notification.service';


@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);
  createProduct(vendorId: any, dto: VendorCreateProductDto , file: Express.Multer.File) {
    throw new Error('Method not implemented.');
  }

private encryptIdNumber(idNumber: string): string {
    const secretKey = process.env.KYC_ENCRYPTION_KEY;
    if (!secretKey || secretKey.length !== 32) {
      throw new Error('Critical: KYC_ENCRYPTION_KEY must be exactly 32 characters long in your .env file');
    }
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secretKey), iv);
    
    let encrypted = cipher.update(idNumber.trim().toUpperCase(), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Returns compound colon-separated crypt string (IV:AuthTag:Ciphertext)
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * 🔑 ADMIN UTILITY METHOD - REVERSE ID TEXT DECRYPTION
   * Decrypts the database text value back to a plaintext string for compliance auditing.
   */
  decryptIdNumber(encryptedData: string): string {
    const secretKey = process.env.KYC_ENCRYPTION_KEY;
    if (!secretKey) throw new Error('Encryption secret key matrix not loaded');

    const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      return encryptedData; // Fallback context in case unencrypted data exists
    }

    const deCipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(secretKey), Buffer.from(ivHex, 'hex'));
    deCipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = deCipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += deCipher.final('utf8');
    return decrypted;
  }

  /**
   * 🔒 ADMIN UTILITY METHOD - GENERATE ACCESS URL
   * Dynamically configures credentials to sign secure viewing instances.
   */
  generateSecureViewingUrl(publicId: string): string {
    cloudinary.config({
      cloud_name: process.env.KC_CLOUDINARY_CLOUD_NAME?.trim(),
      api_key: process.env.KC_CLOUDINARY_API_KEY?.trim(),
      api_secret: process.env.KC_CLOUDINARY_API_SECRET?.trim(),
    });

    return cloudinary.utils.private_download_url(publicId, 'jpg', {
      resource_type: 'image',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 600, // Valid for exactly 10 minutes
    });
  }
  constructor(private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Fetches dashboard statistics for the logged-in vendor.
   */
async getVendorDashboard(vendorId: string) {
  const vendor = await this.prisma.vendor.findUnique({
    where: {
      id: vendorId,
    },
    include: {
      vendorWallet: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!vendor) {
    throw new NotFoundException(
      'VENDOR_PROFILE_NOT_FOUND',
    );
  }

const paidStatuses: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.COMPLETED,
];

  const [
    orderStats,
    productCount,
    recentOrders,
  ] = await Promise.all([
    this.prisma.orderItem.aggregate({
      where: {
        product: {
          vendorId,
        },
        order: {
          status: {
            in: paidStatuses,
          },
        },
      },
      _sum: {
        vendorEarning: true,
      },
      _count: {
        id: true,
      },
    }),

    this.prisma.product.count({
      where: {
        vendorId,
        status: 'APPROVED',
      },
    }),

    this.prisma.orderItem.findMany({
      where: {
        product: {
          vendorId,
        },
      },
      take: 5,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        order: {
          include: {
            user: true,
          },
        },
        product: {
          select: {
            title: true,
          },
        },
      },
    }),
  ]);

  const wallet = vendor.vendorWallet;

  return {
    profile: {
      storeName: vendor.storeName,
      isVerified: vendor.isVerified,
      ownerName: [
        vendor.user?.firstName,
        vendor.user?.lastName,
      ]
        .filter(Boolean)
        .join(' ') || 'Vendor',
      slug: vendor.slug,
    },

    wallet: {
      availableBalance: Number(
        wallet?.availableBalance ?? 0,
      ),
      pendingBalance: Number(
        wallet?.pendingBalance ?? 0,
      ),
      totalEarnings: Number(
        wallet?.totalEarnings ?? 0,
      ),
    },

    stats: {
      totalOrders:
        orderStats._count?.id ?? 0,

      totalRevenue: Number(
        orderStats._sum
          ?.vendorEarning ?? 0,
      ),

      activeProducts: productCount,
    },

    recentOrders: recentOrders.map(
      (item) => ({
        id: item.orderId,

        artifact:
          item.product?.title ??
          'Product',

        customer:
          item.order?.user
            ? [
                item.order.user
                  .firstName,
                item.order.user
                  .lastName,
              ]
                .filter(Boolean)
                .join(' ')
            : 'Guest',

        amount: Number(
          item.vendorEarning ?? 0,
        ),

        status:
          item.order?.status ??
          'PENDING',

        date: item.createdAt,
      }),
    ),
  };
}

async getPublicProfileBySlug(slug: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { slug },
      select: {
        storeName: true,
        imageUrl: true,
        description: true,
        isVerified: true,
        createdAt: true,
        _count: {
          select: { products: true }
        }
      },
    });

    if (!vendor) throw new NotFoundException('Vendor Node not found');
    return vendor;
  }

  // 🚀 SLUG GENERATOR HELPER
  slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }


async requestWithdrawal(vendorId: string, amount: number) {
  const wallet = await this.prisma.vendorWallet.findUnique({
    where: { vendorId },
    include: {
  vendor: {
    include: {
      user: true,
    },
  },
}
  });

  if (!wallet) {
    throw new NotFoundException('WALLET_NOT_FOUND');
  }

  if (Number(wallet.availableBalance) < amount) {
    throw new BadRequestException(
      'INSUFFICIENT_AVAILABLE_BALANCE'
    );
  }

  // =========================
  // BANK VALIDATION (CRITICAL)
  // =========================
  const vendor = wallet.vendor;

  if (
    !vendor.bankName ||
    !vendor.accountNumber ||
    !vendor.accountName
  ) {
    throw new BadRequestException(
      'BANK_DETAILS_NOT_CONFIGURED'
    );
  }

  return this.prisma.$transaction(async (tx) => {
    // 1. MOVE MONEY TO PENDING (NOT JUST DECREMENT)
    await tx.vendorWallet.update({
      where: { vendorId },
      data: {
        availableBalance: { decrement: amount },
        pendingBalance: { increment: amount },
      },
    });

    // 2. CREATE WITHDRAWAL REQUEST (REAL BANK DATA)
    const request = await tx.withdrawalRequest.create({
      data: {
        amount,
        vendorId,
        status: 'PENDING',

        bankDetails: {
          bankName: vendor.bankName,
          bankCode: vendor.bankCode,
          accountNumber: vendor.accountNumber,
          accountName: vendor.accountName,
        },

        metadata: {
          requestedAt: new Date(),
          vendorEmail: vendor.userId ? 'linked' : null,
        },
      },
    });
    await this.notificationService.send({
  userId: vendor.userId,
  userEmail: vendor.user?.email,
  title: 'Withdrawal Requested',
  message: `Your withdrawal request of ₦${amount.toLocaleString()} has been submitted and is awaiting approval.`,
  category: 'withdrawals',
});

    // 3. LEDGER ENTRY
await tx.walletTransaction.create({
  data: {
    vendorId,
    amount: -amount,
    type: 'WITHDRAW',
    status: 'PENDING',

    withdrawalRequestId: request.id,

    reference: `WDR-${request.id
      .slice(-8)
      .toUpperCase()}`,

    description:
      'Withdrawal request initiated',
  },
});

    return request;
  });
}
  // --- PLATFORM TICKETS (Admin Support) ---
async createTicket(vendorId: string, data: any) {
  // 1. IDENTITY RESOLUTION
  const vendor = await this.prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { userId: true } 
  });

  // 2. NULL GUARD (Fixes TS Error 18047)
  if (!vendor) {
    throw new NotFoundException(`Registry Error: Vendor node [${vendorId}] not found.`);
  }

  // 3. ATOMIC DATA ENTRY
  return this.prisma.ticket.create({
    data: {
      userId: vendor.userId, // Now safe to access
      subject: data.subject,
      message: data.message,
      status: 'OPEN',
    },
  });
}

  async getVendorTickets(vendorId: string) {
    return this.prisma.ticket.findMany({
      where: { userId: vendorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- ORDER CONVERSATIONS (Customer Support) ---
// vendor.service.ts

async getVendorConversations(userId: string) {
  // 1. Identity Resolution: Map User to Vendor Node
  const vendor = await this.prisma.vendor.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!vendor) throw new ForbiddenException('Merchant_Identity_Sync_Failed');

  // 2. Data Registry Fetch: Retrieve conversations with full context
  return this.prisma.orderConversation.findMany({
    where: { vendorId: vendor.id },
    include: {
      // SOURCE OF TRUTH: The linked Order entity
      order: {
        select: {
          id: true,           // The real CUID (SH5E...)
          orderNumber: true,
          status: true,
        }
      },
      user: {
        select: { firstName: true, lastName: true },
      },
      messages: {
        // Snippet Protocol: Fetch only the absolute latest message
        take: 1,
        orderBy: { createdAt: 'desc' }, 
        select: {
          content: true,
          createdAt: true,
          senderRole: true,
        }
      },
    },
    // Sort inbox by activity heartbeat
    orderBy: { updatedAt: 'desc' }, 
  });
}

async getConversationById(conversationId: string, userId: string) {
  // 1. Resolve the Merchant (Vendor)
  const vendor = await this.prisma.vendor.findUnique({
    where: { userId },
    select: { id: true }
  });

  if (!vendor) throw new ForbiddenException('Merchant_Identity_Sync_Failed');

  // 2. DATA SYNCHRONIZATION
  // We use the 'id' (cm...) to find the conversation
  const conversation = await this.prisma.orderConversation.findUnique({
    where: { 
      id: conversationId, // Use the actual chat ID
    },
    include: {
      order: {
        select: {
          id: true,          // The REAL Order ID (CMMI...)
          orderNumber: true, 
          status: true,
        }
      },
      user: { 
        select: { firstName: true, lastName: true } 
      },
      messages: { 
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          content: true,
          senderRole: true,
          createdAt: true,
        }
      },
    },
  });

  // Security Check: Make sure this vendor actually owns this chat
  if (!conversation || conversation.vendorId !== vendor.id) {
    throw new NotFoundException('Conversation_Trace_Not_Found');
  }

  return conversation;
}
  async getWalletStats(vendorId: string) {
  // 1. Get the main wallet balances
  const wallet = await this.prisma.vendorWallet.findUnique({
    where: { vendorId }
  });

  // 2. Get total successful withdrawals
  const totalWithdrawn = await this.prisma.walletTransaction.aggregate({
    where: { 
      vendorId, 
      type: 'WITHDRAW', 
      status: 'COMPLETED' 
    },
    _sum: { amount: true }
  });

  // 3. Get recent transactions
  const transactions = await this.prisma.walletTransaction.findMany({
    where: { vendorId },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  return {
    wallet,
    totalWithdrawn: Math.abs(Number(totalWithdrawn._sum.amount || 0)),
    transactions
  };
}


async getFullProfile(vendorId: string) {
  // 1. Fetch the vendor using the correct relation names from your schema
  const vendor = await this.prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      vendorWallet: true, // Matches your schema: 'vendorWallet'
    },
  });

  // 2. Fixes the "'vendor' is possibly null" error
  if (!vendor) {
    throw new NotFoundException('Vendor profile not found');
  }

  // 3. Map the data safely
  return {
    ownerName: `${vendor.user.firstName} ${vendor.user.lastName}`,
    email: vendor.user.email,
    storeName: vendor.storeName,
    // These will work after you run the prisma migration above
    slug: vendor.slug || '',
    description: vendor.description || '',
    shippingFee: vendor.shippingFee || 0,
    // Fetching bank details from the linked vendorWallet
bankName: vendor.bankName || '',
accountNumber: vendor.accountNumber || '',
accountName: vendor.accountName || '',
bankCode: vendor.bankCode ||'',
    isVerified: vendor.isVerified,
    kycStatus: vendor.kycStatus,
  };
}


async updateFullProfile(vendorId: string, data: {
  storeName?: string;
  slug?: string;
  description?: string;
  shippingFee?: number;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  bankCode?: string;
}) {
  // 1. Slug Validation (only if slug is being updated)
  if (data.slug) {
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(data.slug)) {
      throw new BadRequestException('Slug must be lowercase letters, numbers, and hyphens only.');
    }

    const duplicate = await this.prisma.vendor.findFirst({
      where: {
        slug: data.slug.toLowerCase(),
        NOT: { id: vendorId },
      },
    });

    if (duplicate) {
      throw new BadRequestException('This store URL slug is already in use.');
    }
  }

  // 2. Perform the Update
  // If Prisma Generate was successful, bankName will no longer show an error here
  try {
    const updated = await this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        storeName: data.storeName,
        slug: data.slug?.toLowerCase(),
        description: data.description,
        shippingFee: data.shippingFee !== undefined ? Number(data.shippingFee) : undefined,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        accountName: data.accountName,
        bankCode: data.bankCode,
      },
    });

    return {
      status: 'success',
      message: 'Settings updated successfully',
      data: updated
    };
  } catch (error) {
    console.error(error);
    throw new BadRequestException('Update failed. Ensure you have run prisma generate.');
  }
}

  /**
   * Submits vendor KYC with ID document upload to Cloudinary.
   * Re-configures Cloudinary right before upload to avoid lost config issues.
   */
async submitKyc(userId: string, idType: string, idNumber: string, file: Express.Multer.File) {
    // 1. Structural file verification validation bounds
    if (!file?.buffer) {
      throw new BadRequestException('ID document image file is required');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only image files (JPEG, PNG, WEBP) are supported for local automated scanning');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds the protective 5MB ingestion ceiling');
    }

    // 2. Vendor existence verification
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor profile not found. Ensure your account role status is configured as VENDOR.');
    }

    try {
      // ─── 3. LOCAL IN-BUILT OCR PROCESSING ENGINE (100% FREE) ───
      console.log('[IN-BUILT-OCR] Processing image buffer natively in server memory...');
      
      const ocrResult = await Tesseract.recognize(
        file.buffer,
        'eng', 
        { logger: (m) => console.log(`[OCR Node Status]: ${m.status} -> ${Math.round(m.progress * 100)}%`) }
      );

      const extractedTextBlock = ocrResult.data.text || '';
      console.log('[IN-BUILT-OCR] Native text parsing routine complete.');

      // Normalize strings to match cleanly (remove dashes, spaces, slashes, punctuation)
      const cleanSubmittedId = idNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const cleanExtractedText = extractedTextBlock.replace(/[^A-Z0-9]/gi, '').toUpperCase();

      // ─── 4. RUN AUTONOMOUS MATCH LOGIC CHECK ───
      let finalKycStatus: 'APPROVED' | 'REJECTED' = 'REJECTED';
      
      if (cleanExtractedText.includes(cleanSubmittedId) && cleanSubmittedId.length > 2) {
        console.log(`[KYC-OCR MATCH SUCCESS] ID verified natively! Text block matches data payload.`);
        finalKycStatus = 'APPROVED';
      } else {
        console.warn(`[KYC-OCR MISMATCH DETECTED] Target string missing from image parsing context output.`);
        finalKycStatus = 'REJECTED';
      }

      // Cryptographically obscure plain text before committing to DB
      const encryptedIdString = this.encryptIdNumber(idNumber);

      // ─── 5. CLOUDINARY CONFIGURATION FOR DEDICATED KYC ACCOUNT ───
      const kycCloudName = process.env.KC_CLOUDINARY_CLOUD_NAME?.trim();
      const kycApiKey = process.env.KC_CLOUDINARY_API_KEY?.trim();
      const kycApiSecret = process.env.KC_CLOUDINARY_API_SECRET?.trim();

      if (!kycCloudName || !kycApiKey || !kycApiSecret) {
        throw new Error('Dedicated KYC Cloudinary credentials missing at instance lifecycle runtime');
      }

      // Reconfigure standard instance configurations with target vault variables safely
      cloudinary.config({
        cloud_name: kycCloudName,
        api_key: kycApiKey,
        api_secret: kycApiSecret,
      });

      console.log('[KYC] Initializing upload stream to hidden repository directory path');

      const uploadResult = await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            type: 'authenticated', 
            access_mode: 'authenticated',
            folder: `isolated_vendor_kyc_vault/${vendor.id}`,
            public_id: `${idType.toLowerCase()}_secure_${Date.now()}`,
            resource_type: 'image',
            overwrite: true,
          },
          (error, result) => {
            if (error) {
              console.error('[Cloudinary Enclave Upload Error]:', error);
              return reject(error);
            }
            if (!result) {
              return reject(new Error('Cloudinary stream resolved without returning contextual metadata payload objects'));
            }
            resolve(result);
          },
        );

        Readable.from(file.buffer).pipe(uploadStream);
      });

      if (!uploadResult?.public_id) {
        throw new Error('Cloudinary ingestion completed successfully but omitted unique public_id tracking strings');
      }

      // ─── 6. UPDATE VENDOR DATABASE RECORD ───
      const updatedVendor = await this.prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          idType,
          idNumber: encryptedIdString,      
          idImage: uploadResult.public_id,   
          kycStatus: finalKycStatus,        
        },
      });

      console.log('[KYC] Success — Vendor KYC vault sealed under tracking registration identifier:', uploadResult.public_id);

      return {
        vendor: updatedVendor,
        aiVerifiedMatch: finalKycStatus === 'APPROVED'
      };
    } catch (error) {
      console.error('[KYC_VAULT_EXCEPTION_NODE]:', error);
      
      if (error instanceof BadRequestException) throw error;
      
      throw new InternalServerErrorException(
        'An error occurred while transmitting your identity documents into the cryptographic vault. Please try again.',
      );
    }
  }



  //==========================================
  // COUPONS
  //=========================================


  // ────────────────────────────────────────────────
  //  Follow / Unfollow Vendor
  // ────────────────────────────────────────────────
  async followVendor(vendorId: string, userId: string) {
    try {
      return await this.prisma.vendorFollower.create({
        data: { vendorId, userId },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('You are already following this vendor');
      }
      throw error;
    }
  }

  async unfollowVendor(vendorId: string, userId: string) {
    return this.prisma.vendorFollower.delete({
      where: {
        vendorId_userId: { vendorId, userId },
      },
    });
  }

  async getFollowedVendors(userId: string) {
    const follows = await this.prisma.vendorFollower.findMany({
      where: { userId },
      include: {
        vendor: {
          include: {
            _count: { select: { followers: true } },
          },
        },
      },
    });

    return follows.map((follow) => ({
      id: follow.vendor.id,
      storeName: follow.vendor.storeName,
      followersCount: follow.vendor._count.followers,
      isVerified: follow.vendor.isVerified,
      rating: 4.8, // Placeholder — replace with real aggregated rating if implemented
    }));
  }


async markOrderAsCompleted(orderId: string, vendorId: string) {
  return await this.prisma.$transaction(async (tx) => {
    // 1. Fetch order with items and product context
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });

    if (!order) throw new NotFoundException('Order registry node not found');
    
    // 🛡️ SECURITY: Ownership Verification
    if (order.vendorId !== vendorId) {
      throw new ForbiddenException('UNAUTHORIZED_PROTOCOL: You do not own this order registry.');
    }

    if (order.status === 'COMPLETED') return { status: 'ALREADY_COMPLETED' };

    // 2. STATUS TRANSITION & TOTAL PAID RECOVERY
    // If Webhook failed, totalPaid will be null. We recover it using totalAmount.
    await tx.order.update({
      where: { id: orderId },
      data: { 
        status: 'COMPLETED',
        totalPaid: order.totalPaid ? order.totalPaid : order.totalAmount // ✅ Fix: Fill the Total Paid NULL
      },
    });

    let totalReleased = 0;

    // 3. SETTLEMENT ENGINE
    for (const item of order.items) {
      // 🛡️ RECOVERY MATH: Calculate 90/10 split on the fly
      const unitPrice = Number(item.priceAtPurchase || 0);
      const totalGross = unitPrice * item.quantity;
      
      const calculatedCommission = totalGross * 0.10; // 10% Platform Revenue
      const calculatedEarning = totalGross - calculatedCommission; // 90% Vendor Share

      // Only move money if it hasn't been paid already
      if (item.payoutStatus !== 'PAID' && totalGross > 0) {
        
        // 💰 UPDATE WALLET: Release from Escrow to Liquidity
        await tx.vendorWallet.update({
          where: { vendorId: vendorId },
          data: {
            // Only decrement pending if it was actually put there by a webhook
            // Otherwise, just increment available balance
            pendingBalance: { decrement: item.vendorEarning ? Number(item.vendorEarning) : 0 },
            availableBalance: { increment: calculatedEarning },
          },
        });

        // 📝 UPDATE ORDER ITEM: Fill both Earning and Commission
        await tx.orderItem.update({
          where: { id: item.id },
          data: { 
            vendorEarning: calculatedEarning, // ✅ No more NULL
            commission: calculatedCommission, // ✅ No more NULL
            payoutStatus: 'PAID' 
          },
        });

        totalReleased += calculatedEarning;
      }
    }

    this.logger.log(`💰 AUDIT_COMPLETE: Order ${orderId} finalized. Platform Fee: ₦${Number(order.totalAmount) * 0.10}`);
    
    return { 
      success: true, 
      message: 'Settlement and Audit finalized', 
      data: { releasedAmount: totalReleased } 
    };
  });
}


  // ────────────────────────────────────────────────
  //  Vendor Profile (public/private view)
  // ────────────────────────────────────────────────
  async getVendorProfile(vendorId: string, currentUserId?: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { followers: true, products: true },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    let isFollowing = false;
    if (currentUserId) {
      const follow = await this.prisma.vendorFollower.findUnique({
        where: {
          vendorId_userId: { vendorId, userId: currentUserId },
        },
      });
      isFollowing = !!follow;
    }

    return {
      ...vendor,
      followersCount: vendor._count.followers,
      productsCount: vendor._count.products,
      isFollowing,
    };
  }


  


  // src/vendor/vendor.service.ts

async findPublicVendors(params: { 
  isVerified?: boolean; 
  limit?: number; 
  search?: string 
}) {
  const { isVerified, limit = 6, search = '' } = params;

  // 🛡️ FIRM FILTER LOGIC: 
  // 1. Swapped 'isActive' for 'status' to match your schema.
  // 2. Ensuring 'isVerified' is only added if explicitly requested.
  const whereClause: any = {
    status: 'ACTIVE', 
    ...(isVerified !== undefined && { isVerified }), 
    ...(search && {
      OR: [
        { storeName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  try {
    const vendors = await this.prisma.vendor.findMany({
      where: whereClause,
      take: limit,
      select: {
        id: true,
        storeName: true,
        isVerified: true,
        idImage: true,      // Using idImage as per your schema
        imageUrl: true,     // Included imageUrl as it exists in your schema
        description: true,
        _count: {
          select: { 
            products: true,
            followers: true 
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return { 
      status: 'SUCCESS',
      count: vendors.length,
      data: vendors 
    };
  } catch (error) {
    console.error("VENDOR_QUERY_FAILURE", error);
    throw new Error("Failed to retrieve public vendor registry.");
  }
}
// src/vendor/vendor.service.ts

async getOrderDetails(orderId: string, vendorId: string) {
  return this.prisma.order.findFirst({
    where: { id: orderId, vendorId },
    include: {
      user: {
        select: { firstName: true, lastName: true, email: true }
      },
      items: {
        include: {
          product: {
            select: { 
              title: true, 
              images: {
                select: { 
                  imageUrl: true // <--- Changed from 'url' to 'imageUrl'
                },
                take: 1
              }
            }
          }
        }
      }
    }
  });
}
  


// src/vendor/vendor.service.ts

// src/vendor/vendor.service.ts

async updateOrderStatus(
  orderId: string, 
  vendorId: string, 
  dto: { status: string; trackingNumber?: string; carrier?: string } // Shift to string or Item-level enum if preferred
) {
  // 1. VERIFY OWNER ISOLATION & UPDATE THE SPECIFIC ITEM STATUS
  const vendorItems = await this.prisma.orderItem.findMany({
    where: {
      orderId: orderId,
      vendorId: vendorId // Directly use the item-level vendorId from your schema
    }
  });

  if (!vendorItems.length) {
    throw new ForbiddenException(
      'Order not found or access denied: You do not own any items in this checkout registry.'
    );
  }

  // Define database updates for this vendor's specific order items
  const itemUpdateData: any = {
    status: dto.status // ✅ Crucial: Advance this vendor's items independently (e.g., 'PROCESSING', 'SHIPPED')
  };

  // If the vendor is marking their item status as COMPLETED, move their financial state out of escrow locking
  if (dto.status === 'COMPLETED') {
    itemUpdateData.payoutStatus = 'SETTLED';
  }

  // Execute the isolated update on the sub-items
  await this.prisma.orderItem.updateMany({
    where: {
      orderId: orderId,
      vendorId: vendorId
    },
    data: itemUpdateData
  });

  this.logger.log(`✅ Vendor ${vendorId} advancing order items toward state: ${dto.status}`);

  // 2. LIFECYCLE EVALUATION FOR MULTI-VENDOR FLOW
  // Check if there are ANY items left in the entire checkout order that belong to OTHER vendors 
  // and are still lingering behind in a less progressive state.
  const incompleteOtherVendorItems = await this.prisma.orderItem.count({
    where: {
      orderId: orderId,
      vendorId: { not: vendorId }, // Look exclusively at peer items
      status: { notIn: ['COMPLETED', 'SHIPPED'] } // Items that haven't cleared the fulfillment cycle
    }
  });

  // Calculate what the parent Order status should drop down to
  let parentOrderStatus: OrderStatus = OrderStatus.PROCESSING;

  if (incompleteOtherVendorItems === 0 && dto.status === 'COMPLETED') {
    // If every vendor has completely delivered their split allocations, close the master order lifecycle
    parentOrderStatus = OrderStatus.COMPLETED;
  } else if (dto.status === 'PENDING') {
    parentOrderStatus = OrderStatus.PENDING;
  } else {
    // If this vendor is finished or shipped, but peers are still processing/pending, 
    // keep the master order active as PROCESSING so the customer knows things are still moving.
    parentOrderStatus = OrderStatus.PROCESSING;
    this.logger.log(`📦 Parent Order ${orderId} held at PROCESSING because other vendors have pending allocations.`);
  }

  // 3. SAFELY UPDATE THE PARENT ORDER Lifecycle Status & Global Logistics Tracking (if applicable)
  const order = await this.prisma.order.update({
    where: { id: orderId },
    data: {
      status: parentOrderStatus,
      // Note: Tracking properties can be handled on individual item rows if vendors ship separately,
      // but if tracking at parent level, append safely:
      ...(dto.trackingNumber && { trackingNumber: dto.trackingNumber }),
      ...(dto.carrier && { carrier: dto.carrier }),
    },
    include: {
      user: true,
    },
  });

  // 4. AUTO-TRIGGER ESCROW RELEASE FOR THIS SPECIFIC VENDOR
  if (dto.status === 'COMPLETED') {
    try {
      this.logger.log(`🔄 Auto-routing Order ${orderId} line-items to settlement engine for Vendor ${vendorId}`);
      await this.markOrderAsCompleted(orderId, vendorId); 
    } catch (settleError: unknown) {
      const errorMessage = settleError instanceof Error ? settleError.message : String(settleError);
      this.logger.error(`SETTLEMENT_AUTORUN_FAILED for Vendor ${vendorId}: ${errorMessage}`);
    }
  }

  // 5. DISPATCH CUSTOMIZED USER NOTIFICATIONS
  try {
    let messageText = `Your order items have been updated to ${dto.status}.`;
    let notificationTitle = 'Order Updated';

    if (dto.status === 'SHIPPED') {
      notificationTitle = 'Order Part-Shipped!';
      messageText = `Good news! A portion of your package has been handed over to the courier. Carrier: ${dto.carrier ?? 'Standard'}, Tracking Number: ${dto.trackingNumber ?? 'N/A'}`;
    } else if (dto.status === 'COMPLETED') {
      notificationTitle = incompleteOtherVendorItems > 0 ? 'Order Partially Delivered' : 'Order Fully Completed!';
      messageText = incompleteOtherVendorItems > 0
        ? `A portion of your items has been successfully delivered by the vendor.`
        : `Your entire order has been fully completed and delivered!`;
    }

    await this.notificationService.send({
      userId: order.userId,
      userEmail: order.user.email,
      title: notificationTitle,
      message: messageText, 
      category: 'orderUpdates',
    });
  } catch (notifyError: unknown) {
    const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
    this.logger.error(`NOTIFICATION_DISPATCH_FAILED: ${errorMessage}`);
  }

  return order;
}



async getCustomerDetails(vendorId: string, userId: string) {
  return this.prisma.orderItem.findMany({
    where: {
      product: { vendorId: vendorId },
      order: { userId: userId }
    },
    select: {
      id: true,
      priceAtPurchase: true,
      quantity: true,
      product: {
        select: {
          title: true,
          images: { take: 1 }
        }
      },
      order: {
        select: {
          orderNumber: true,
          status: true,
          createdAt: true
        }
      }
    },
    orderBy: { order: { createdAt: 'desc' } }
  });
}

async getReturnRequests(userId: string) {
  const vendor = await this.prisma.vendor.findUnique({
    where: { userId },
    select: { id: true }
  });


  

  if (!vendor) throw new NotFoundException('Vendor_Registry_Not_Found');

  return this.prisma.returnRequest.findMany({
    where: { 
      vendorId: vendor.id,
      status: 'PENDING' 
    },
    include: {
      user: {
        select: { firstName: true, lastName: true }
      },
      // Ensure 'order' relation exists in schema.prisma before including here
      order: {
        select: { id: true, totalAmount: true }
      }
    }
  });
}


// src/vendor/vendor.service.ts

// src/vendor/vendor.service.ts

// src/vendor/vendor.service.ts

async triggerReturnMediation(returnId: string, vendorId: string, reason: string) {
  // 1. IDENTITY_CHECK: Find the return using your actual schema fields
  // Your schema has vendorId directly on the ReturnRequest
  const returnRequest = await this.prisma.returnRequest.findUnique({
    where: { id: returnId },
  });

  // 2. PROTOCOL_VALIDATION
  if (!returnRequest) {
    throw new NotFoundException('MEDIATION_NODE_NOT_FOUND: Request does not exist.');
  }

  // Ensure the vendor attempting to mediate is the one assigned to this return
  if (returnRequest.vendorId !== vendorId) {
    throw new ForbiddenException('UNAUTHORIZED_PROTOCOL: You do not own this return registry.');
  }

  // 3. STATUS_TRANSITION & REGISTRY_UPDATE
  // We use 'adminDecision' because 'notes' does not exist in your schema
  return this.prisma.returnRequest.update({
    where: { id: returnId },
    data: {
      status: 'UNDER_MEDIATION',
      adminDecision: `VENDOR_DISPUTE_SIGNAL: ${reason}`, // Mapping to your adminDecision field
      updatedAt: new Date(),
    },
  });
}

async getVendorCustomers(vendorId: string) {
  const customers = await this.prisma.user.findMany({
    where: {
      orders: {
        some: {
          items: {
            some: {
              product: { vendorId: vendorId }
            }
          }
        }
      }
    },
    include: {
      orders: {
        where: {
          items: { some: { product: { vendorId: vendorId } } }
        },
        select: {
          totalAmount: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  return customers.map(customer => {
    // 1. Calculate total spent by converting Decimal to Number
    const totalSpent = customer.orders.reduce((sum, order) => {
      return sum + Number(order.totalAmount);
    }, 0);

    // 2. Format a professional name string
    const fullName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(' ');

    return {
      id: customer.id,
      name: fullName || customer.email.split('@')[0],
      email: customer.email,
      phone: customer.phone || 'N/A',
      ordersCount: customer.orders.length,
      totalSpent: totalSpent,
      lastOrderDate: customer.orders[0]?.createdAt 
        ? new Date(customer.orders[0].createdAt).toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          })
        : 'No Orders'
    };
  });
}
// inside vendor.service.ts

async getInventory(vendorId: string) {
  const products = await this.prisma.product.findMany({
    where: { vendorId },
    include: {
      images: { take: 1 },
      category: { select: { name: true } },
      variants: {
        select: {
          id: true,
          price: true,
          stock: true,
        },
      },
    },
  });

  return products.map((p) => {
    const totalStock = p.variants.reduce(
      (sum, v) => sum + (Number(v.stock) || 0),
      0
    );

    const minPrice =
      p.variants.length > 0
        ? Math.min(...p.variants.map((v) => Number(v.price) || 0))
        : Number(p.price) || 0;

    return {
      ...p,
      displayStock: totalStock,
      displayPrice: minPrice,
    };
  });
}

async updateBulkStock(vendorId: string, updates: Record<string, number>) {
  // We use a transaction to ensure all updates happen together
  return this.prisma.$transaction(
    Object.entries(updates).map(([productId, quantity]) =>
      this.prisma.product.update({
        where: { 
          id: productId, 
          vendorId: vendorId // Ensures the vendor owns the product they are updating
        },
        data: { stock: quantity },
      }),
    ),
  );
}

async getReviews(vendorId: string) {
  return this.prisma.review.findMany({
    where: { vendorId: vendorId },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          images: { take: 1 }
        }
      },
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async replyToReview(vendorId: string, reviewId: string, replyText: string) {
  return this.prisma.review.update({
    where: { 
      id: reviewId,
      vendorId: vendorId // Security: Ensures vendor owns the review
    },
    data: { reply: replyText }
  });
}

  // ────────────────────────────────────────────────
  //  Product Analytics (basic summary)
  // ────────────────────────────────────────────────
async getVendorAnalytics(vendorId: string) {
  // 1. Fetch products along with their corresponding order items cleanly
  const products = await this.prisma.product.findMany({
    where: { 
      vendorId,
      isDeleted: false
    },
    include: {
      orderItems: true, 
    },
  });

  // 2. Process data nodes across the product array
  const productPerformance = products.map((product) => {
    const items = product.orderItems || [];
    
    // Convert numbers explicitly during collection evaluation
    const revenue = items.reduce((sum, item) => {
      const priceAtSale = Number(item.priceAtPurchase || product.price || 0);
      const quantity = Number(item.quantity || 0);
      return sum + (priceAtSale * quantity);
    }, 0);

    const salesCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    return {
      title: product.title || 'Unknown Product',
      revenue: Number(revenue),
      salesCount: Number(salesCount),
      stock: Number(product.stock || 0),
    };
  });

  // 3. Aggregate root total metrics
  const totalRevenue = productPerformance.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalOrders = productPerformance.reduce((acc, curr) => acc + curr.salesCount, 0);

  // 4. Map down high yield nodes (Guarded against 0 division metrics)
  const topProducts = productPerformance
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      revenue: p.revenue,
      salesCount: p.salesCount,
      stock: p.stock,
      revenuePercentage: totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 100) : 0
    }));

  return {
    summary: {
      totalRevenue: Number(totalRevenue),
      totalOrders: Number(totalOrders),
      productCount: Number(products.length),
    },
    topProducts,
  };
}
}