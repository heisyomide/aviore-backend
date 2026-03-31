import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';
import { CreateAddressDto } from './dto/create-address.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(private prisma: PrismaService) {}

  // --- IDENTITY LOGIC ---
  async createUser(email: string, pass: string, role: 'ADMIN' | 'VENDOR' | 'CUSTOMER') {
    const hashedPassword = await bcrypt.hash(pass, 12);
    return this.prisma.user.create({
      data: { email, password: hashedPassword, role },
    });
  }


  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

// --- DASHBOARD OVERVIEW ---
// --- DASHBOARD OVERVIEW ---
async getDashboardOverview(userId: string) {
  const [orders, reviewCount] = await Promise.all([
    this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.review.count({
      where: { userId }, // This will now work perfectly
    }),
  ]);

  return {
    totalOrders: orders.length,
    pendingOrders: orders.filter(o => o.status === 'PENDING' || o.status === 'PROCESSING').length,
    deliveredOrders: orders.filter(o => o.status === 'DELIVERED').length,
    totalReviews: reviewCount,
    recentOrders: orders.slice(0, 5).map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      status: order.status,
      totalAmount: order.totalAmount,
    })),
  };
}

  // --- ORDER MANAGEMENT ---
 

async getOrderHistory(userId: string) {
  return this.prisma.order.findMany({
    where: { userId },
    include: {
      // Include items so we know which products to review
      items: {
        include: { 
          product: { 
            select: { 
              id: true, 
              title: true, 
              images: true, // Needed for the "View Details" page
              price: true 
            } 
          } 
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

// src/users/users.service.ts

async cancelOrder(userId: string, orderId: string) {
  // Find the order and verify it belongs to the user
  const order = await this.prisma.order.findFirst({
    where: { id: orderId, userId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  // Only allow cancellation if the order is still PENDING
  if (order.status !== 'PENDING') {
    throw new BadRequestException('Order cannot be cancelled at this stage.');
  }

  return this.prisma.order.update({
    where: { id: orderId },
    data: { status: 'CANCELLED' },
  });
}

async getOrderDetails(userId: string, orderId: string) {
  const order = await this.prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      items: {
        include: { product: true }
      },
      // Include shipping address if you have that relation
    }
  });
  if (!order) throw new NotFoundException('Order not found');
  return order;
}

//REVIEWS

async getUserReviews(userId: string) {
  // 1. Fetch from Registry
  const reviews = await this.prisma.review.findMany({
    where: { userId },
    include: {
      product: {
        select: { 
          title: true,
          images: { select: { imageUrl: true }, take: 1 } 
        }
      },
      // Note: Removed vendorReply because your error log says it doesn't exist.
      // We will use the 'reply' field and 'vendor' relation instead.
      vendor: {
        select: { storeName: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // 2. Analytics Calculation
  const totalReviews = reviews.length;
  const averageRating = totalReviews > 0 
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews 
    : 0;

  // 3. Formatted Response
  return {
    stats: {
      totalReviews,
      averageRating: parseFloat(averageRating.toFixed(1)),
      helpfulVotes: 12 // Placeholder for UI consistency
    },
    reviews: reviews.map(r => ({
      id: r.id,
      productName: r?.product?.title || 'Unknown Artifact',
      productImage: r?.product?.images?.[0]?.imageUrl || null,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      // FIX: Your schema uses a direct 'reply' field on the Review model
      reply: r.reply ? {
        content: r.reply,
        storeName: r?.vendor?.storeName || 'Vendor'
      } : null
    }))
  };
}

async deleteReview(userId: string, reviewId: string) {
  const review = await this.prisma.review.findFirst({
    where: { 
      id: reviewId,
      userId: userId // Security check: Ensure the review belongs to the user
    },
  });

  if (!review) {
    throw new NotFoundException('Review not found or you do not have permission to delete it');
  }

  return this.prisma.review.delete({
    where: { id: reviewId },
  });
}


async updateReview(userId: string, reviewId: string, data: { rating?: number; comment?: string }) {
  // 1. Verify ownership
  const review = await this.prisma.review.findFirst({
    where: { 
      id: reviewId,
      userId: userId 
    },
  });

  if (!review) {
    throw new NotFoundException('Review not found or unauthorized');
  }

  // 2. Perform the update
  return this.prisma.review.update({
    where: { id: reviewId },
    data: {
      rating: data.rating,
      comment: data.comment,
    },
  });
}

  // --- PROFILE & PASSWORD MANAGEMENT ---
// src/users/users.service.ts

// backend: src/users/users.service.ts

async getProfile(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true, 
      lastName: true,
      phone: true,
      createdAt: true,
      _count: {
        select: {
          orders: true,
          reviews: true,
        },
      },
    },
  });

  if (!user) throw new NotFoundException('User not found');

  // Concatenate name for the frontend; fallback to 'User' to avoid 'Guest'
  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();

  return {
    ...user,
    name: fullName || 'User', 
  };
}

async updateProfile(userId: string, data: { firstName?: string; lastName?: string; phone?: string; email?: string }) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundException('User not found');

  return this.prisma.user.update({
    where: { id: userId },
    data,
  });
}


// users.service.ts
async recordProductView(userId: string, productId: string) {
    try {
      // First, verify product exists to prevent ghost history
      const productExists = await this.prisma.product.findUnique({
        where: { id: productId },
      });

      if (!productExists) throw new NotFoundException("Product node not found.");

      return await this.prisma.browsingHistory.upsert({
        where: {
          userId_productId: { userId, productId },
        },
        update: { viewedAt: new Date() },
        create: { userId, productId },
      });
    } catch (error) {
      this.logger.error(`HISTORY_RECORD_ERROR: ${error.message}`);
      throw error;
    }
  }

  /**
   * 📂 GET USER HISTORY
   * Optimized to fetch only necessary UI artifacts.
   */
  async getHistory(userId: string) {
    return this.prisma.browsingHistory.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            price: true,
            images: {
              take: 1, // Only need the first image for history cards
              select: { imageUrl: true }
            },
          },
        },
      },
      orderBy: { viewedAt: 'desc' },
      take: 30, // Firm limit: keeps the dashboard fast and clean
    });
  }

  /**
   * 🗑️ CLEAR REGISTRY
   */
  async clearHistory(userId: string) {
    try {
      return await this.prisma.browsingHistory.deleteMany({
        where: { userId },
      });
    } catch (error) {
      this.logger.error(`HISTORY_CLEAR_ERROR: ${error.message}`);
      throw new Error("Failed to clear browsing registry.");
    }
  }


async getFollowedVendors(userId: string) {
  const follows = await this.prisma.vendorFollower.findMany({
    where: { userId },
    include: {
      vendor: {
        include: {
          _count: {
            select: { followers: true }
          }
        }
      }
    }
  });

  return follows.map(f => ({
    id: f.vendor.id,
    storeName: f.vendor.storeName, 
    followersCount: f.vendor._count.followers,
    isVerified: f.vendor.isVerified,
    rating: 4.8 // Placeholder until your Review model is ready
  }));
}

  // --- ADDRESS MANAGEMENT ---
// users.service.ts

async getAddresses(userId: string) {
  return this.prisma.address.findMany({
    where: { userId },
    orderBy: { isDefault: 'desc' }, // Ensures the default one is always first in the list
  });
}

async addAddress(userId: string, data: CreateAddressDto) {
  try {
    const count = await this.prisma.address.count({ where: { userId } });
    
    return await this.prisma.address.create({
      data: {
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        street: data.street,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode || "", // Ensures it's never null
        userId: userId,
        isDefault: count === 0, // First one is default
      },
    });
  } catch (error) {
    throw new BadRequestException("LOGISTICS_REGISTRY_FAILURE: Check identity fields.");
  }
}

async updateAddress(userId: string, addressId: string, data: CreateAddressDto) {
  // Use findFirst to ensure the address actually belongs to the user before updating
  const address = await this.prisma.address.findFirst({
    where: { id: addressId, userId }
  });

  if (!address) throw new NotFoundException("Address node not found in your registry.");

  return await this.prisma.address.update({
    where: { id: addressId },
    data: {
      fullName: data.fullName,
      phoneNumber: data.phoneNumber,
      street: data.street,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode || "",
    },
  });
}
async setDefaultAddress(userId: string, addressId: string) {
  return await this.prisma.$transaction(async (tx) => {
    // 1. Reset all to false
    await tx.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // 2. Set the target to true
    return await tx.address.update({
      where: { id: addressId, userId }, // Extra safety: ensure the address belongs to this user
      data: { isDefault: true },
    });
  });
}

// Add this to your UsersService
// Add this to your UsersService


async deleteAddress(userId: string, addressId: string) {
  const addressToDelete = await this.prisma.address.findUnique({
    where: { id: addressId },
  });

  const result = await this.prisma.address.delete({
    where: { id: addressId, userId },
  });

  // Logic: If the deleted address was the default, make the next one default
  if (addressToDelete?.isDefault) {
    const nextAddress = await this.prisma.address.findFirst({
      where: { userId },
    });
    if (nextAddress) {
      await this.setDefaultAddress(userId, nextAddress.id);
    }
  }

  return result;
}


async update2FA(userId: string, enable: boolean) {
  // 1. Verify user exists
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  // 2. Update the status
  return this.prisma.user.update({
    where: { id: userId },
    data: { is2faEnabled: enable },
    select: {
      id: true,
      email: true,
      is2faEnabled: true, // Return the new status to the frontend
    },
  });
}

// Add this to your UsersService class
async getSessions(userId: string) {
  return this.prisma.session.findMany({
    where: { userId },
    orderBy: { lastUsed: 'desc' },
    take: 5, // Limit to recent 5 for the security overview
  });
}

async recordSession(userId: string, device: string, ipAddress: string) {
  // Set all previous sessions to isCurrent: false for this user
  await this.prisma.session.updateMany({
    where: { userId, isCurrent: true },
    data: { isCurrent: false },
  });

  // Create the new active session
  return this.prisma.session.create({
    data: {
      userId,
      device,
      ipAddress,
      isCurrent: true,
    },
  });
}

async getNotificationSettings(userId: string) {
  let settings = await this.prisma.notificationSetting.findUnique({
    where: { userId },
  });

  // If settings don't exist, create default ones
  if (!settings) {
    settings = await this.prisma.notificationSetting.create({
      data: { userId },
    });
  }
  return settings;
}

async updateNotificationSettings(userId: string, data: any) {
  return this.prisma.notificationSetting.update({
    where: { userId },
    data: data, // Prisma will only update the fields passed (e.g., { emailEnabled: true })
  });
}

// Add these to your existing UsersService class

// 1. FAQ Logic
async getFaqs() {
  return this.prisma.fAQ.findMany();
}

// 2. Ticket Logic (The "Open Ticket" button)
async createTicket(userId: string, data: { subject: string; message: string }) {
  return this.prisma.ticket.create({
    data: {
      userId,
      subject: data.subject,
      message: data.message,
    },
  });
}

async getUserTickets(userId: string) {
  return this.prisma.ticket.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

// 3. Live Chat Initialization (The "Live Chat" button)
// backend: src/users/users.service.ts

/**
 * FETCH_PROTOCOL: Retrieve existing chat without creating ghost rows.
 * Used when the page first loads to show history.
 */
async getChat(orderId: string, userId: string) { // Added userId here
  const conversation = await this.prisma.orderConversation.findUnique({
    where: { orderId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      order: { 
        select: { 
          id: true, 
          status: true,
          orderNumber: true 
        } 
      },
    }
  });

  // Security Check: Ensure the user requesting the chat is the one who owns it
  if (conversation && conversation.userId !== userId) {
    throw new ForbiddenException('You do not have permission to view this inquiry node.');
  }

  return conversation;
}

/**
 * INITIALIZATION_PROTOCOL: The actual "Handshake."
 * Triggered ONLY when the first message is transmitted.
 */
async initiateConversation(data: { 
  orderId: string; 
  userId: string; 
  vendorId: string; 
  content: string 
}) {
  return this.prisma.orderConversation.upsert({
    where: { orderId: data.orderId },
    update: { 
      updatedAt: new Date(),
      messages: {
        create: {
          content: data.content,
          senderRole: 'USER',
          senderId: data.userId, // FIX: Added required senderId
        }
      }
    },
    create: {
      orderId: data.orderId,
      userId: data.userId,
      vendorId: data.vendorId,
      messages: {
        create: [
          {
            content: data.content,
            senderRole: 'USER',
            senderId: data.userId, // FIX: Added required senderId
          }
        ]
      }
    },
    include: {
      messages: true,
      order: { select: { id: true } }
    }
  });
}
// 4. Returns Logic (The "Returns" button)
/**
 * REVERSAL_REGISTRY_PROTOCOL:
 * Atomic Upsert ensures only one return request exists per order.
 * This prevents Prisma P2002 Unique Constraint crashes.
 */
async createReturn(userId: string, data: { 
  orderId: string; 
  vendorId: string; 
  reason: string; 
  description: string 
}) {
  return this.prisma.returnRequest.upsert({
    // 1. IDENTITY CHECK: Look for an existing request linked to this order
    where: { 
      orderId: data.orderId 
    },
    
    // 2. SYNCHRONIZATION: If it exists, update the context rather than crashing
    update: {
      reason: data.reason,
      description: data.description,
      status: 'PENDING', // Re-verify status on update
      updatedAt: new Date(),
    },
    
    // 3. INITIALIZATION: If it doesn't exist, create the artifact
    create: {
      userId,
      orderId: data.orderId,
      vendorId: data.vendorId,
      reason: data.reason,
      description: data.description,
      status: 'PENDING',
    },
  });
}
async deleteAccount(userId: string) {
  // 1. Check if user exists first
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundException('User not found');

  // 2. Perform the deletion
  return await this.prisma.$transaction(async (tx) => {
    // Delete related data first (unless you have CASCADE delete set in Prisma)
    await tx.address.deleteMany({ where: { userId } });
    
    // You might want to delete wishlist, cart, etc. here too
    // await tx.wishlist.deleteMany({ where: { userId } });

    // Finally, delete the user
    return await tx.user.delete({
      where: { id: userId },
    });
  });
}
}

