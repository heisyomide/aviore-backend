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
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { VendorCreateProductDto  } from './dto/vendor-product.dto';
import { OrderStatus } from '@prisma/client'; // Import the auto-generated enum
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; 
import { Roles } from '../auth/roles.decorator';


@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);
  createProduct(vendorId: any, dto: VendorCreateProductDto , file: Express.Multer.File) {
    throw new Error('Method not implemented.');
  }
  constructor(private readonly prisma: PrismaService) {}

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
          user: { select: { email: true } } 
        } 
      } 
    } 
  });

  if (!wallet || Number(wallet.availableBalance) < amount) {
    throw new BadRequestException('Insufficient available balance for withdrawal protocol');
  }

  return this.prisma.$transaction(async (tx) => {
    // 1. Deduct from wallet immediately
    await tx.vendorWallet.update({
      where: { vendorId },
      data: { availableBalance: { decrement: amount } }
    });

    // 2. Initialize the Withdrawal Request with REQUIRED bankDetails
    const request = await tx.withdrawalRequest.create({
      data: {
        amount: amount, // Prisma handles number to Decimal conversion
        vendorId,
        status: 'PENDING',
        // In a production app, you would fetch these from the Vendor's stored payout profile
        bankDetails: {
          bankName: "Registry Settlement Bank",
          accountNumber: "0000000000",
          accountName: wallet.vendor.storeName
        },
        metadata: {
          requestedBy: wallet.vendor.user.email,
          ipAddress: "Handshake_Protocol_Secure"
        }
      }
    });

    // 3. Log the Debit Transaction for the Vendor's ledger
    await tx.walletTransaction.create({
      data: {
        vendorId,
        amount: -amount,
        type: 'WITHDRAW',
        status: 'PENDING',
        reference: `WDR-${request.id.slice(-6).toUpperCase()}`
      }
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
    bankName: (vendor.vendorWallet as any)?.bankName || 'Not Set',
    accountNumber: (vendor.vendorWallet as any)?.accountNumber || '',
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
    // 1. File validation
    if (!file?.buffer) {
      throw new BadRequestException('ID document image is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed (JPEG, PNG, etc.)');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    // 2. Vendor existence check
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor profile not found. Ensure your account role is VENDOR.');
    }

    try {
      // ─── Re-configure Cloudinary RIGHT BEFORE upload ─────────────
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
      const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
      const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

      console.log('[KYC] Cloudinary env check at upload time:', {
        cloudName: cloudName || 'MISSING',
        apiKeyExists: !!apiKey,
        apiSecretExists: !!apiSecret,
      });

      if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Cloudinary credentials missing at upload time');
      }

      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });

      console.log('[KYC] Cloudinary re-configured successfully for this request');

      // ─── 3. Upload to Cloudinary ────────────────────────────────
      console.log('[KYC] Starting upload →', {
        userId,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });

      const uploadResult = await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'aviore_vendors_kyc',
            resource_type: 'image',
            type: 'private',
            overwrite: true,
          },
          (error, result) => {
            if (error) {
              console.error('[Cloudinary Upload Error]:', error);
              return reject(error);
            }

            if (!result) {
              return reject(new Error('Cloudinary returned no result object'));
            }

            console.log('[Cloudinary Success] URL:', result.secure_url);
            resolve(result);
          },
        );

        Readable.from(file.buffer).pipe(uploadStream);
      });

      if (!uploadResult?.secure_url) {
        throw new Error('Cloudinary upload succeeded but no secure_url returned');
      }

      const secureUrl = uploadResult.secure_url;

      // ─── 4. Update vendor record ────────────────────────────────
      const updatedVendor = await this.prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          idType,
          idNumber,
          idImage: secureUrl,
          kycStatus: 'PENDING',
          // kycSubmittedAt: new Date(),   // ← Uncomment ONLY after adding this field to schema.prisma
        },
      });

      console.log('[KYC] Success — Vendor updated with image:', secureUrl);

      return updatedVendor;
    } catch (error) {
      console.error('[KYC_UPLOAD_ERROR]:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        fileName: file?.originalname,
        fileSize: file?.size,
        mimeType: file?.mimetype,
      });

      throw new InternalServerErrorException(
        'An error occurred while processing your identity documents. Please try again.',
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
      // 1. Fetch order with security check (ensures this vendor owns the order)
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException('Order registry not found');
      
      // 🛡️ Security Guard: Prevent unauthorized vendors from settling funds
      if (order.vendorId !== vendorId) {
        throw new Error('UNAUTHORIZED_SETTLEMENT_ATTEMPT');
      }

      if (order.status === 'COMPLETED') return { status: 'ALREADY_COMPLETED' };

      // 2. MARK ORDER AS COMPLETED
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'COMPLETED' },
      });

      // 3. RELEASE FUNDS FROM ESCROW
      for (const item of order.items) {
        if (item.vendorEarning && item.payoutStatus === 'LOCKED') {
          const earning = Number(item.vendorEarning);

          // 🛡️ Fix TS2322 by ensuring vendorId is not null/undefined
          if (order.vendorId) {
            await tx.vendorWallet.update({
              where: { vendorId: order.vendorId },
              data: {
                pendingBalance: { decrement: earning },
                availableBalance: { increment: earning },
              },
            });

            await tx.orderItem.update({
              where: { id: item.id },
              data: { payoutStatus: 'PAID' },
            });
          }
        }
      }

      this.logger.log(`💰 LIQUIDITY_RELEASED: Order ${orderId} finalized for vendor ${vendorId}`);
      
      return { status: 'SUCCESS', releasedAmount: order.totalAmount };
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
  dto: { status: OrderStatus; trackingNumber?: string; carrier?: string }
) {
  try {
    return await this.prisma.order.update({
      where: { 
        id: orderId,
        vendorId: vendorId // 🛡️ Security: Ensures the vendor owns this order
      },
      data: { 
        status: dto.status,
        // Only update tracking if the values are actually sent in the request
        ...(dto.trackingNumber && { trackingNumber: dto.trackingNumber }),
        ...(dto.carrier && { carrier: dto.carrier }),
      }
    });
  } catch (error) {
    // Prisma throws P2025 if the record isn't found or doesn't match the where clause
    if (error.code === 'P2025') {
      throw new ForbiddenException('Order not found or access denied');
    }
    throw new InternalServerErrorException('Could not update order status');
  }
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
  return this.prisma.product.findMany({
    where: { vendorId },
    select: {
      id: true,
      title: true,
      stock: true,
      price: true,
      images: { take: 1 },
      category: { select: { name: true } },
    },
    orderBy: { stock: 'asc' }, // Low stock items at the top
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
  // 1. Fetch products with their related order items
  const products = await this.prisma.product.findMany({
    where: { 
      vendorId,
      isDeleted: false // Good practice to exclude deleted items from analytics
    },
    include: {
      orderItems: true, 
    },
  });

  // 2. Process metrics for each product
  const productPerformance = products.map((product) => {
    // Standardizing the relation access (handling 'items' or 'orderItems')
    const items = product.orderItems || [];
    
    // Calculate total revenue for this specific product
    const revenue = items.reduce((sum, item) => {
      // Use price at time of sale if it exists, otherwise fallback to current price
      const priceAtSale = Number(item.priceAtPurchase || product.price || 0);
      const quantity = item.quantity || 0;
      return sum + (priceAtSale * quantity);
    }, 0);

    // Calculate total units sold
    const salesCount = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

    return {
      title: product.title,
      revenue,
      salesCount,
      stock: product.stock,
    };
  });

  // 3. Aggregate high-level summary data
  const totalRevenue = productPerformance.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalOrders = productPerformance.reduce((acc, curr) => acc + curr.salesCount, 0);

  return {
    summary: {
      totalRevenue,
      totalOrders,
      productCount: products.length,
    },
    // Top 5 products by revenue for the dashboard leaderboard
    topProducts: productPerformance
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
  };
}// Ensure this closing brace exists!
}