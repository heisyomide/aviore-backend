import { Injectable, NotFoundException, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { VendorStatus, ProductStatus,WithdrawalStatus, KycStatus, AuditAction, OrderStatus, CouponType, Prisma, DiscountType, DisputeStatus, TicketStatus, Role} from '@prisma/client';
import { startOfDay, startOfMonth, subDays, format } from 'date-fns';
import { v2 as cloudinary } from 'cloudinary';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';
import { PaymentsService } from '../payments/payments.service';
import { GrowthMetricsQueryDto } from './dto/growth-metrics-query.dto';
import { GrowthVendorsActivationService } from 'src/growth/vendors/vendors-activation.service';
import { NotificationService } from 'src/notification/notification.service';



@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
   private resend = new Resend(process.env.RESEND_API_KEY);
 constructor(
  private prisma: PrismaService,
  private paymentsService: PaymentsService,
  private readonly activationService: GrowthVendorsActivationService,
   private readonly notificationService: NotificationService,

) {}



  // =========================================================
  // DASHBOARD OVERVIEW
  // =========================================================

async getAdminDashboardOverview() {
    // We use 'month' as the default range for the revenue summary cards
    const [
      performance,
      revenue,
      chart,
      pendingWithdrawals,
      pendingProducts,
      pendingKyc
    ] = await Promise.all([
      this.getPerformanceStats(),
      this.calculateRevenueStats('month'),
      this.getRevenueChartData(),
      this.prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.product.count({ where: { status: 'PENDING' } }),
      this.prisma.vendor.count({ where: { kycStatus: 'PENDING' } })
    ]);

    return {
      performance,
      revenue,
      chart,
      moderation: {
        pendingWithdrawals,
        pendingProducts,
        pendingKyc
      }
    };
  }

  // =========================================================
  // VENDOR MANAGEMENT
  // =========================================================

async getPendingKycVendors() {
  return this.prisma.vendor.findMany({
    where: { kycStatus: 'PENDING' },
    include: {
      user: {
        select: { firstName: true, lastName: true, email: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async getAllVendors() {
  return this.prisma.vendor.findMany({
    include: {
      user: true,
      _count: { select: { products: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

  // admin.service.ts

// src/admin/admin.service.ts

async approveVendorKyc(vendorId: string, adminId: string) {
  return this.prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Node not found');

    const updated = await tx.vendor.update({
      where: { id: vendorId },
      data: {
        kycStatus: 'APPROVED',
        status: 'ACTIVE',
        isVerified: true
      }
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'APPROVE_VENDOR_KYC',
        targetId: vendorId,
        targetType: 'VENDOR',
        details: `IDENTITY_AUTHORIZED: ${vendor.storeName}`
      }
    });

    return updated;
  });
}

// THIS WAS THE MISSING METHOD CAUSING YOUR ERROR
async rejectVendorKyc(vendorId: string, adminId: string, reason: string) {
  return this.prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Node not found');

    const updated = await tx.vendor.update({
      where: { id: vendorId },
      data: {
        kycStatus: 'REJECTED',
        status: 'PENDING_APPROVAL', // Merchant must resubmit
        isVerified: false
      }
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'REJECT_VENDOR_KYC',
        targetId: vendorId,
        targetType: 'VENDOR',
        details: `IDENTITY_REJECTED: ${reason}`
      }
    });

    return updated;
  });
}



  // =========================================================
  // USER MANAGEMENT
  // =========================================================

// src/admin/admin.service.ts

async getAllUsers() {
  return this.prisma.user.findMany({
    // Explicitly select fields to include the virtual _count property
    select: {
      id: true,
      email: true,
        firstName:            true,
  lastName:             true,
      role: true,
      isActive: true,
      createdAt: true,
      // This maps to the user._count.orders field in your frontend
      _count: {
        select: { orders: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async toggleUserBlock(userId: string, adminId: string) {
  return this.prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Security: Prevent an admin from blocking themselves
    if (user.id === adminId) {
      throw new BadRequestException('Action denied: You cannot block your own account.');
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive }
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: updated.isActive ? AuditAction.UNBAN_USER : AuditAction.BAN_USER,
        targetId: userId,
        targetType: 'USER',
        details: `Account status changed to ${updated.isActive ? 'Active' : 'Banned'}`
      }
    });

    return updated;
  });
}




/**
 * Fetch all orders with User and Store details for the Admin Dashboard
 */
async getAllOrders() {
  return this.prisma.order.findMany({
    include: {
      // 💡 1. Fetch user metadata directly
      user: {
        select: { firstName: true, lastName: true, email: true }
      },
      // 💡 2. Fetch the Order's Vendor store name directly from the parent relation
      vendor: {
        select: { storeName: true }
      },
      // 💡 3. Fetch list items and their matching titles safely
      items: {
        include: {
          product: { 
            select: { 
              title: true
              // Removed the invalid vendor relation traversal from here
            } 
          },
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

  /**
   * Updates order status and logs the protocol change
   */
  async updateOrderStatus(orderId: string, status: OrderStatus, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Verify order exists
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { user: { select: { email: true } } }
      });

      if (!order) throw new NotFoundException('Order node not found');

      // 2. Update status
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status }
      });

      // 3. Create Audit Log
      // Note: Cast as any to bypass the missing UPDATE_ORDER_STATUS in your enum
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'APPROVE_PAYOUT' as AuditAction, // Temporary fallback or use type cast
          targetId: orderId,
          targetType: 'ORDER',
          details: `Order status for ${order.user.email} changed to ${status}`
        }
      });

      return updatedOrder;
    });
  }




  //=================================
  //CATEGORIES
  //=================================
  // src/admin/admin.service.ts

// src/admin/admin.service.ts

async createCategory(name: string, adminId: string, parentId?: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();

  return this.prisma.$transaction(async (tx) => {
    const category = await tx.category.create({ 
      data: { 
        name, 
        slug,
        parentId: parentId || null // Link to parent if provided
      } 
    });
    
    await tx.auditLog.create({
      data: {
        adminId,
        action: 'CREATE_COUPON' as any,
        targetId: category.id,
        targetType: 'CATEGORY',
        details: `STRUCTURE_UPDATE: ${name} ${parentId ? `under parent ${parentId}` : '(Root)'}`
      }
    });
    
    return category;
  });
}

async getAllCategories() {
  return this.prisma.category.findMany({
    include: {
      parent: { select: { name: true } }, // Show who the parent is
      _count: { select: { products: true, children: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

// src/admin/admin.service.ts

async deleteCategory(id: string, adminId: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. Check for linked products or subcategories
    const category = await tx.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { 
            products: true, 
            children: true 
          }
        }
      }
    });

    if (!category) throw new NotFoundException('Taxonomy node not found');

    // 2. Safety Guard: Prevent deletion if dependencies exist
    if (category._count.products > 0) {
      throw new BadRequestException(
        `PROTOCOL_VIOLATION: Cannot delete category with ${category._count.products} linked products.`
      );
    }

    if (category._count.children > 0) {
      throw new BadRequestException(
        `PROTOCOL_VIOLATION: Cannot delete parent node with ${category._count.children} active subcategories.`
      );
    }

    // 3. Execute Deletion
    await tx.category.delete({ where: { id } });

    // 4. Log the action
    await tx.auditLog.create({
      data: {
        adminId,
        action: 'DELETE_PRODUCT' as any, // Temporary mapping
        targetId: id,
        targetType: 'CATEGORY',
        details: `DECOMMISSIONED_NODE: ${category.name}`
      }
    });

    return { success: true, message: 'Node successfully purged from registry.' };
  });
}


  // =========================================================
  // PRODUCT MODERATION
  // =========================================================

async getPendingProducts() {
  return this.prisma.product.findMany({
    where: { 
      status: ProductStatus.PENDING,
      isDeleted: false,           // ← This was missing
    },
    include: {
      vendor: { select: { storeName: true } },
      images: true,               // general images
      variants: {
        include: {
          images: true              // variant images
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

// Inside your updateProductStatus method
// Inside your updateProductStatus method
// src/admin/admin.service.ts

async updateProductStatus(id: string, status: ProductStatus, adminId: string) {
  // 🟥 FIX: Typed tx as any here to ensure seamless database method passing
  return this.prisma.$transaction(async (tx: any) => {
    // 1. FETCH PRODUCT WITH COMPLETE VENDOR GRAPH RELATION MAPPINGS
    const existingProduct = await tx.product.findUnique({
      where: { id },
      include: {
        vendor: {
          include: {
            user: true
          }
        }
      }
    });

    if (!existingProduct) {
      throw new Error("Product not found");
    }

    if (existingProduct.isDeleted) {
      throw new Error("Cannot update status of a deleted product");
    }

    // Optional: Only allow changing PENDING products
    if (existingProduct.status !== ProductStatus.PENDING) {
      throw new Error(`Product is already ${existingProduct.status}`);
    }

    // 2. NOW PERFORM THE UPDATE
    const updatedProduct = await tx.product.update({
      where: { id },
      data: { 
        status,
        ...(status === ProductStatus.APPROVED && { isActive: true })
      }
    });

    // 3. AUDIT LOG MAPPING LOGIC
    let auditAction: AuditAction;
    if (status === ProductStatus.APPROVED) {
      auditAction = AuditAction.APPROVE_PRODUCT;
    } else if (status === ProductStatus.REJECTED) {
      auditAction = AuditAction.REJECT_PRODUCT;
    } else {
      auditAction = AuditAction.DELETE_PRODUCT;
    }

    await tx.auditLog.create({
      data: {
        adminId,
        action: auditAction,
        targetId: id,
        targetType: 'PRODUCT',
        details: `Product status updated from ${existingProduct.status} to ${status}`,
      }
    });

    // 4. DYNAMIC ADMIN ACTION NOTIFICATION DISPATCHER
    if (existingProduct.vendor?.user) {
      const vendorUser = existingProduct.vendor.user;
      
      // 🟥 FIXES: Changed existingProduct.name to existingProduct.title across all 3 strings
      const productTitle = (existingProduct as any).title || (existingProduct as any).name || 'Your product';
      
      let notificationTitle = 'Product Under Review 🛒';
      let notificationMessage = `Your product update for "${productTitle}" is currently being processed.`;

      if (status === ProductStatus.APPROVED) {
        notificationTitle = 'Product Approved! 🎉';
        notificationMessage = `Great news! Your product "${productTitle}" has been approved by administration and is now live on AVIORÈ.`;
      } else if (status === ProductStatus.REJECTED) {
        notificationTitle = 'Product Modification Required ⚠️';
        notificationMessage = `Your product submission "${productTitle}" was not approved. Please review our marketplace guidelines and update your listing parameters.`;
      }

      await this.notificationService.send({
        userId: vendorUser.id,
        userEmail: vendorUser.email,
        title: notificationTitle,
        message: notificationMessage,
        category: 'storeActivity',
      });
    }

    // 5. AUTOMATIC GROWTH INTERCEPTOR HOOK
    if (status === ProductStatus.APPROVED || status === ProductStatus.REJECTED) {
      await this.activationService.evaluateVendorActivationWithTx(
        existingProduct.vendorId, 
        tx
      );
    }

    return updatedProduct;
  });
}

  async toggleProductVisibility(id: string, isActive: boolean) {
    return this.prisma.product.update({
      where: { id },
      data: { isActive }
    });
  }



  //=====================================================
  // COUPONS & CAMPAINGS
  //======================================================

/**
   * DEPLOY_PLATFORM_COUPON
   * Initializes a global discount subsidized by the platform treasury.
   */
async createPlatformCoupon(data: any, adminId: string) {
  const code = data.code.toUpperCase().trim();

  const existing = await this.prisma.coupon.findUnique({
    where: { code },
  });

  if (existing) {
    throw new BadRequestException(
      "CODE_CONFLICT: Coupon already exists."
    );
  }

  if (Number(data.discountValue) <= 0) {
    throw new BadRequestException("INVALID_DISCOUNT_VALUE");
  }

  if (
    data.discountType === "PERCENTAGE" &&
    Number(data.discountValue) > 100
  ) {
    throw new BadRequestException("PERCENTAGE_CANNOT_EXCEED_100");
  }

  const endDate = new Date(data.endDate);

  if (endDate <= new Date()) {
    throw new BadRequestException(
      "INVALID_EXPIRY: End date must be in the future."
    );
  }

  return this.prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.create({
      data: {
        code,
        description: data.description || "Seasonal Platform Promotion",
        type: CouponType.PLATFORM,
        discountType: data.discountType,
        discountValue: new Prisma.Decimal(data.discountValue),
        minOrderValue: data.minOrderValue
          ? new Prisma.Decimal(data.minOrderValue)
          : null,
        usageLimit: Number(data.usageLimit || 100),
        perUserLimit: Number(data.perUserLimit || 1),
        startDate: data.startDate ? new Date(data.startDate) : new Date(),
        endDate,
        vendorId: null,
        isActive: true,
      },
    });

    const discountLabel =
      coupon.discountType === "PERCENTAGE" ? "%" : "₦";

    await tx.auditLog.create({
      data: {
        adminId,
        action: AuditAction.CREATE_COUPON,
        targetId: coupon.id,
        targetType: "COUPON",
        details: `ADMIN_SUBSIDY: ${coupon.code} initialized (${coupon.discountValue}${discountLabel})`,
      },
    });

    return coupon;
  });
}

async toggleCouponStatus(id: string, adminId: string) {
  const coupon = await this.prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new NotFoundException('Coupon not found');

  return this.prisma.coupon.update({
    where: { id },
    data: { isActive: !coupon.isActive }
  });
}



  /**
   * Fetches all active and historical promotions across the platform.
   */
  async getPromotionsOverview() {
    return this.prisma.coupon.findMany({
      include: { 
        vendor: { 
          select: { storeName: true } 
        } 
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  //===================================================
  // DISPUTES
  //================================================
  // src/admin/admin.service.ts

/**
 * FETCH_ALL_DISPUTES
 * Retrieves all conflict nodes for the Arbitration Center.
 */
async getAllDisputes() {
  return this.prisma.dispute.findMany({
    include: {
      // Replaced totalPrice with 'total' to match your Schema
      order: { 
        select: { 
          totalAmount: true, 
          status: true 
        } 
      },
      evidences: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * RESOLVE_DISPUTE
 * Atomic transaction to render arbitration verdict.
 */
async resolveDispute(id: string, adminId: string, action: string, data: any) {
  return this.prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({
      where: { id },
      include: { order: true }
    });

    if (!dispute) throw new NotFoundException('DISPUTE_NODE_NOT_FOUND');

    let finalStatus: DisputeStatus;
    let orderStatus: OrderStatus = dispute.order.status;
    let resolutionDetails = "";

    switch (action) {
      case 'REFUND_FULL':
        finalStatus = 'RESOLVED_REFUND';
        orderStatus = 'CANCELLED';
        resolutionDetails = "FULL_REFUND_AUTHORIZED_BY_ADMIN";
        break;
      
      case 'PAY_VENDOR':
        finalStatus = 'CLOSED';
        resolutionDetails = "DISPUTE_REJECTED_FUNDS_RELEASED_TO_VENDOR";
        break;

      case 'PARTIAL_REFUND':
        finalStatus = 'RESOLVED_REFUND';
        // Fixed the template literal syntax here to stop the 'Cannot find name' error
        resolutionDetails = `PARTIAL_REFUND_AUTHORIZED: ₦${data.amount || 0}`;
        break;

      default:
        finalStatus = 'CLOSED';
        resolutionDetails = "DISPUTE_CLOSED_NO_ACTION";
    }

    // 1. Synchronize Dispute Record
    const updatedDispute = await tx.dispute.update({
      where: { id },
      data: {
        status: finalStatus,
        resolution: data.resolution || resolutionDetails,
        refundAmount: data.amount ? new Prisma.Decimal(data.amount) : dispute.refundAmount,
        adminId
      }
    });

    // 2. Synchronize Order State
    await tx.order.update({
      where: { id: dispute.orderId },
      data: { status: orderStatus }
    });

    // 3. Register Action in Audit Ledger
    await tx.auditLog.create({
      data: {
        adminId,
        action: 'UPDATE_DISPUTE' as any,
        targetId: id,
        targetType: 'DISPUTE',
        details: resolutionDetails
      }
    });

    return updatedDispute;
  });
}


//===================================================
// REVIEWS
//===============================================

// src/admin/admin.service.ts

async getAllReviews() {
  return this.prisma.review.findMany({
    include: {
      product: { select: { title: true, images: true } },
      user: { select: { firstName: true, lastName: true } },
      vendor: { select: { storeName: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async moderateReview(id: string, adminId: string, action: 'DELETE' | 'HIDE' | 'FLAG') {
  return this.prisma.$transaction(async (tx) => {
    if (action === 'DELETE') {
      const deleted = await tx.review.delete({ where: { id } });
      await tx.auditLog.create({
        data: { adminId, action: 'DELETE_REVIEW' as any, targetId: id, targetType: 'REVIEW', details: 'REVIEW_PERMANENTLY_REMOVED' }
      });
      return deleted;
    }

    // Logic for HIDE (assuming you add an 'isVisible' field to schema later)
    // For now, let's log the moderation flag
    await tx.auditLog.create({
      data: { adminId, action: 'FLAG_REVIEW' as any, targetId: id, targetType: 'REVIEW', details: `REVIEW_${action}_ACTION` }
    });
    
    return { success: true, action };
  });
}


//====================================================
//  SUPPORTS
//==================================================
/**
   * TICKET_QUEUE_PROTOCOL
   * Fetches the global support queue with user dossiers attached.
   */
  async getSupportQueue() {
    return this.prisma.ticket.findMany({
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * TICKET_UPDATE_PROTOCOL
   * Updates the status of a specific ticket node and logs the change.
   */
  async updateTicket(id: string, data: { status: TicketStatus }, adminId: string) {
    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('TICKET_NOT_FOUND: Sequence non-existent.');

    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.update({
        where: { id },
        data: { status: data.status },
      });

      // Audit Log for Admin Accountability
      await tx.auditLog.create({
        data: {
          adminId,
          action: AuditAction.UPDATE_ORDER, // Or a specific SUPPORT_ACTION if you add it to your enum
          targetId: id,
          targetType: 'TICKET',
          details: `STATUS_OVERRIDE: ${existing.status} -> ${data.status}`,
        },
      });

      return ticket;
    });
  }

  //=======================================================
  // Notifications
  //====================================================
  // src/admin/admin.service.ts



// src/admin/admin.service.ts

async executeBroadcast(dto: { 
  title: string; 
  message: string; 
  target: 'ALL' | 'VENDORS' | 'CUSTOMERS';
  channels: { email: boolean; push: boolean; sms: boolean };
}, adminId: string) {
  
  // 1. IDENTITY MAPPING PROTOCOL
  const roleMapping: Record<string, Role | undefined> = {
    'VENDORS': Role.VENDOR,
    'CUSTOMERS': Role.CUSTOMER,
    'ALL': undefined,
  };

  const targetRole = roleMapping[dto.target];

  // 2. FETCH AUDIENCE FROM REGISTRY
  const users = await this.prisma.user.findMany({
    where: targetRole ? { role: targetRole } : {},
    select: { id: true, email: true, pushToken: true }
  });

  if (users.length === 0) {
    return { status: 'NO_TARGETS_FOUND', results: { pushCount: 0, emailCount: 0, feedCount: 0 } };
  }

  const results = { pushCount: 0, emailCount: 0, feedCount: 0 };

  // 3. PERSISTENT IN-APP FEED NOTIFICATION PIPELINE
  try {
    const feedRecords = users.map(user => ({
      userId: user.id,
      title: dto.title,
      message: dto.message,
      type: 'BROADCAST', // ✅ FIXED: Added the mandatory required schema field
      isRead: false,
    }));

    // Use Prisma's high-speed createMany protocol for raw execution speed
    const batchFeed = await this.prisma.notification.createMany({
      data: feedRecords,
      skipDuplicates: true,
    });
    
    results.feedCount = batchFeed.count;
  } catch (feedError: any) {
    console.error('🔴 BROADCAST_FEED_SYNC_FAIL:', feedError.message);
  }

  // 4. PUSH RELAY (Firebase Batch Protocol)
  if (dto.channels.push) {
    const tokens = users.map(u => u.pushToken).filter(t => !!t) as string[];
    
    if (tokens.length > 0) {
      for (let i = 0; i < tokens.length; i += 500) {
        const batch = tokens.slice(i, i + 500);
        await admin.messaging().sendEachForMulticast({
          tokens: batch,
          notification: { title: dto.title, body: dto.message },
          data: { type: 'BROADCAST_ALERT' }
        });
        results.pushCount += batch.length;
      }
    }
  }

  // 5. EMAIL RELAY (Resend Batch Protocol)
  if (dto.channels.email) {
    const emailList = users.map(u => u.email).filter(email => !!email);
    
    if (emailList.length > 0) {
      try {
        const batchSize = 100;
        
        for (let i = 0; i < emailList.length; i += batchSize) {
          const emailChunk = emailList.slice(i, i + batchSize);
          
          const batchPayload = emailChunk.map(targetEmail => ({
            from: 'AVIORÈ <no-reply@shopaviore.store>',
            to: targetEmail,
            subject: dto.title,
            html: `
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>${dto.title}</title>
                </head>
                <body style="margin: 0; padding: 40px 20px; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #0a0a0a; border: 1px solid #141414; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                    
                    <tr>
                      <td style="padding: 40px 40px 20px 40px; text-align: left;">
                        <span style="font-size: 20px; font-weight: 800; letter-spacing: 4px; color: #ffffff; text-transform: uppercase;">AVIORÈ</span>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 40px;">
                        <div style="height: 1px; background: linear-gradient(90deg, #1f1f1f 0%, rgba(31,31,31,0) 100%);"></div>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 40px 40px 30px 40px;">
                        <h1 style="color: #ffffff; font-size: 26px; font-weight: 400; letter-spacing: -0.5px; line-height: 1.3; margin: 0 0 24px 0; text-transform: capitalize;">
                          ${dto.title}
                        </h1>
                        <p style="color: #a3a3a3; font-size: 15px; line-height: 1.7; font-weight: 300; margin: 0 0 32px 0;">
                          ${dto.message.replace(/\n/g, '<br>')}
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td style="padding: 0 40px 40px 40px;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 1px solid #141414; padding-top: 24px;">
                          <tr>
                            <td>
                              <p style="margin: 0 0 4px 0; font-size: 10px; font-weight: 600; color: #404040; text-transform: uppercase; letter-spacing: 2px;">
                                Secure Distribution // Aviorè Command Center
                              </p>
                              <p style="margin: 0; font-size: 11px; color: #262626;">
                                This message was transmitted securely via internal system configurations.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>

                  </table>
                </body>
              </html>
            `,
          }));

          await this.resend.batch.send(batchPayload);
          results.emailCount += emailChunk.length;
        }
      } catch (error) {
        console.error('SECURE_EMAIL_BATCH_FAILURE:', error);
      }
    }
  }

  // 6. LOG AUTHORITY ACTION
  await this.prisma.auditLog.create({
    data: {
      adminId,
      action: 'UPDATE_COUPON' as any, 
      targetType: 'SYSTEM_BROADCAST',
      targetId: 'GLOBAL',
      details: `DEPLOYED: ${dto.title} | Target: ${dto.target} | Push: ${results.pushCount} | Email: ${results.emailCount} | In-App Feed: ${results.feedCount}`,
    },
  });

  return { status: 'TRANSMISSION_COMPLETE', results };
}


//==================================================
// DECURITY
//=================================================
// src/admin/admin.service.ts

// 1. Fetch Failed Login Clusters (Potential Brute Force)
// src/admin/admin.service.ts

// =========================================================
// SECURITY & THREAT INTELLIGENCE
// =========================================================

// src/admin/admin.service.ts

async getSecurityIntelligence() {
  const oneDayAgo = subDays(new Date(), 1);

  // 1. ASYNC INTELLIGENCE GATHERING
  const [threatLogs, blockedIps, loginStats] = await Promise.all([
    // Fetch 20 most recent high-risk events (Removed empty include to fix TypeScript 'never' error)
    this.prisma.loginLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' }
    }),
    
    // Total active blocks in the firewall with Admin attribution
    this.prisma.blockedIp.findMany({
      include: { admin: { select: { firstName: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    
    // Aggregate status for the last 24 hours
    this.prisma.loginLog.groupBy({
      by: ['status'],
      where: { createdAt: { gte: oneDayAgo } },
      _count: { status: true } // Explicitly count the status field
    })
  ]);

  // 2. ANALYTICS PROCESSING
  // Use a safer reduction method to handle empty loginStats
  const failedCount = loginStats.find(s => s.status === 'FAILED')?._count.status || 0;
  const successCount = loginStats.find(s => s.status === 'SUCCESS')?._count.status || 0;
  const totalLogins = failedCount + successCount;

  // 3. DYNAMIC THREAT CALCULATION
  // We calculate the failure rate to determine if an attack is in progress
  const failureRate = totalLogins > 0 ? (failedCount / totalLogins) * 100 : 0;
  
  let threatLevel: 'STABLE' | 'ELEVATED' | 'CRITICAL' = 'STABLE';
  if (failureRate > 40 || failedCount > 50) {
    threatLevel = 'CRITICAL'; // High volume or high ratio of failures
  } else if (failureRate > 15 || failedCount > 10) {
    threatLevel = 'ELEVATED';
  }

  return {
    threatLogs,
    blockedIps,
    stats: {
      totalLogins,
      failedCount,
      successCount,
      failureRate: parseFloat(failureRate.toFixed(2)),
      blockedCount: blockedIps.length,
      threatLevel
    }
  };
}

/**
 * BLOCK_ENDPOINT_PROTOCOL
 * Manually blacklists an IP address from accessing any platform route.
 */
async blockIpAddress(ip: string, reason: string, adminId: string) {
  return this.prisma.$transaction(async (tx) => {
    const block = await tx.blockedIp.create({
      data: { ip, reason, adminId }
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'BAN_USER' as any, // Standardizing action
        targetId: ip,
        targetType: 'IP_ADDRESS',
        details: `FIREWALL_BLOCK: ${reason}`
      }
    });

    return block;
  });
}

// =========================================================
// FRAUD DETECTION RADAR
// =========================================================

async getFraudDetectionReport() {
  const [highValueOrders, suspiciousReviews] = await Promise.all([
    // 1. High-Value Anomalies (Orders > 500k awaiting approval)
    this.prisma.order.findMany({
      where: { 
        totalAmount: { gte: 500000 },
        status: OrderStatus.PAID 
      },
      include: { user: { select: { firstName: true, email: true } } },
      orderBy: { totalAmount: 'desc' }
    }),
    
    // 2. Review Clusters (Multiple reviews from the same IP/User in 24hrs)
    this.prisma.review.findMany({
      take: 10,
      include: { 
        user: { select: { firstName: true } },
        product: { select: { title: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  return {
    anomalies: {
      highValueOrders,
      suspiciousReviews,
      totalAlerts: highValueOrders.length + suspiciousReviews.length
    }
  };
}


  /**
   * FAQ_REGISTRY_PROTOCOL
   * Manages the knowledge base registry.
   */
  async manageFAQ(data: { question: string; answer: string; category: string }) {
    if (!data.question || !data.answer) {
      throw new BadRequestException('KNOWLEDGE_BASE_ERROR: Fields cannot be null.');
    }

    return this.prisma.fAQ.create({
      data: {
        question: data.question,
        answer: data.answer,
        category: data.category.toUpperCase().trim(),
      },
    });
  }

  /**
   * FETCH_KNOWLEDGE_BASE
   * Fetches all FAQs grouped by category for the registry view.
   */
  async getFAQRegistry() {
    return this.prisma.fAQ.findMany({
      orderBy: [{ category: 'asc' }, { question: 'asc' }],
    });
  }


  //====================================================
  // SETTINGS
  //====================================================
  // src/admin/admin.service.ts

async getPlatformSettings() {
  const settings = await this.prisma.systemSetting.findMany();
  // Transform array into a clean object for the frontend
  return settings.reduce((acc, curr) => ({
    ...acc, [curr.key]: curr.value 
  }), {});
}

async updateSetting(key: string, value: string, adminId: string) {
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'UPDATE_SETTING' as any,
        targetId: key,
        targetType: 'SYSTEM_CONFIG',
        details: `SETTING_CHANGED: ${key} set to ${value}`
      }
    });

    return updated;
  });
}


  // =========================================================
  // PAYOUTS
  // =========================================================

/**
   * Fetch all withdrawal requests currently awaiting authorization.
   */
async getPendingWithdrawals() {
    return this.prisma.withdrawalRequest.findMany({
      where: { status: WithdrawalStatus.PENDING },
      include: { 
        vendor: { 
          select: { 
            storeName: true, 
            id: true 
          } 
        } 
      },
      orderBy: { createdAt: 'asc' } 
    });
  }

  /**
   * Authorize and Complete a Vendor Payout.
   * Utilizes a transaction to ensure status update and audit logs are atomic.
   */
async approveWithdrawal(
  id: string,
  adminId: string,
) {
  return this.prisma.$transaction(
    async (tx) => {
const request =
  await tx.withdrawalRequest.findUnique({
    where: { id },

    include: {
      vendor: {
        include: {
          user: true,
        },
      },
    },
  });

      if (!request) {
        throw new NotFoundException(
          `Withdrawal ${id} not found`,
        );
      }
      if (
  request.status !==
  WithdrawalStatus.PENDING
) {
  throw new BadRequestException(
    'WITHDRAWAL_ALREADY_PROCESSED',
  );
}

      const bankDetails =
        request.bankDetails as {
          bankCode: string;
          bankName: string;
          accountNumber: string;
          accountName: string;
        };

      if (
        !bankDetails ||
        !bankDetails.bankCode ||
        !bankDetails.accountNumber
      ) {
        throw new BadRequestException(
          'BANK_DETAILS_MISSING',
        );
      }

      const transfer =
        await this.paymentsService.initiateTransfer({
          amount: Number(request.amount),
          bankCode: bankDetails.bankCode,
          accountNumber:
            bankDetails.accountNumber,
          narration: `Vendor payout for ${request.vendor.storeName}`,
          reference: `PAYOUT-${request.id}`,
        });

        await tx.vendorWallet.update({
  where: {
    vendorId: request.vendorId,
  },
  data: {
    pendingBalance: {
      decrement: Number(request.amount),
    },
  },
});

      const updatedRequest =
        await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status:
              WithdrawalStatus.PROCESSING,
            metadata: {
              transferId:
                transfer.id,
              transferRef:
                transfer.reference,
              approvedAt:
                new Date(),
              approvedBy: adminId,
            },
          },
        });

        await this.notificationService.send({
  userId: request.vendor.userId,
  userEmail: request.vendor.user?.email,
  title: 'Withdrawal Approved',
  message: `Your withdrawal of ₦${request.amount} is being processed by the bank.`,
  category: 'withdrawals',
});

        await tx.walletTransaction.updateMany({
  where: {
    withdrawalRequestId: request.id,
    type: 'WITHDRAW',
    status: 'PENDING',
  },
  data: {
    status: 'PROCESSING',
  },
});

      await tx.auditLog.create({
        data: {
          adminId,
          action:
            AuditAction.APPROVE_PAYOUT,
          targetId: id,
          targetType:
            'WITHDRAWAL',
          details: `PAYOUT SENT: ₦${request.amount}`,
        },
      });

      return {
        message:
          'PAYOUT_TRANSFER_INITIATED',
        data: updatedRequest,
        transfer,
      };
    },
  );
}

async rejectWithdrawal(
  id: string,
  adminId: string,
  reason?: string,
) {
  return this.prisma.$transaction(
    async (tx) => {

      // =============================
      // FIND REQUEST
      // =============================
      const request =
        await tx.withdrawalRequest.findUnique({
          where: { id },
include: {
  vendor: {
    include: {
      user: true,
    },
  },
}
        });

      if (!request) {
        throw new NotFoundException(
          `Withdrawal ${id} not found`,
        );
      }


      // =============================
      // PREVENT DOUBLE ACTION
      // =============================
      if (
        request.status !==
        WithdrawalStatus.PENDING
      ) {
        throw new BadRequestException(
          'WITHDRAWAL_ALREADY_PROCESSED',
        );
      }


      // =============================
      // RETURN FUNDS TO WALLET
      // =============================
await tx.vendorWallet.update({
  where: {
    vendorId: request.vendorId,
  },
  data: {
    availableBalance: {
      increment: Number(request.amount),
    },

    pendingBalance: {
      decrement: Number(request.amount),
    },
  },
});


      // =============================
      // UPDATE REQUEST STATUS
      // =============================
      const updatedRequest =
        await tx.withdrawalRequest.update({
          where: { id },
          data: {
            status:
              WithdrawalStatus.REJECTED,

            metadata: {
              rejectedAt: new Date(),
              rejectedBy: adminId,
              rejectionReason:
                reason ||
                'Withdrawal rejected by admin',
            },
          },
        });

        await this.notificationService.send({
  userId: request.vendor.userId,
  userEmail: request.vendor.user?.email,
  title: 'Withdrawal Rejected',
  message:
    reason ||
    'Your withdrawal request was rejected by the administrator.',
  category: 'withdrawals',
});

        await tx.walletTransaction.updateMany({
  where: {
    withdrawalRequestId: request.id,
    type: 'WITHDRAW',
    status: 'PENDING',
  },
  data: {
    status: 'REJECTED',
  },
});


      // =============================
      // AUDIT LOG
      // =============================
      await tx.auditLog.create({
        data: {
          adminId,
          action:
            AuditAction.REJECT_PAYOUT,
          targetId: id,
          targetType:
            'WITHDRAWAL',
          details: `PAYOUT REJECTED: ₦${request.amount}`,
        },
      });


      return {
        success: true,
        message:
          'WITHDRAWAL_REJECTED_AND_FUNDS_RETURNED',
        data: updatedRequest,
      };
    },
  );
}
  // =========================================================
  // ANALYTICS
  // =========================================================

async calculateRevenueStats(range: string = 'month') {
    const now = new Date();
    
    // 🛡️ Fix TS2454: Initialize with a default value immediately
    let startDate = new Date(0); 

    if (range === 'today') startDate = startOfDay(now);
    else if (range === 'week') startDate = subDays(now, 7);
    else if (range === 'month') startDate = startOfMonth(now);

    // 📊 REVENUE_AGGREGATION_PROTOCOL
    const stats = await this.prisma.order.aggregate({
      where: {
        // ✅ CRITICAL: Include both PAID (shipping) and COMPLETED (delivered)
        status: {
          in: [OrderStatus.PAID, OrderStatus.COMPLETED]
        },
        createdAt: { gte: startDate }
      },
      // ✅ Use totalPaid: This represents actual money confirmed in system
      _sum: { totalPaid: true },
      _count: { id: true }
    });

    const revenue = Number(stats._sum.totalPaid ?? 0);
    const orderCount = stats._count.id ?? 0;

    return {
      revenue,
      orders: orderCount,
      commission: revenue * 0.10 // Platform's 10% share
    };
  }

  async getRevenueChartData() {
    const last7Days = subDays(new Date(), 7);

    // 🛡️ Ensure the chart also pulls COMPLETED orders
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PAID, OrderStatus.COMPLETED] },
        createdAt: { gte: last7Days }
      },
      select: {
        totalPaid: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    });

    // Grouping logic for the frontend chart
    const chartMap = new Map();
    
    // Initialize last 7 days with 0
    for (let i = 6; i >= 0; i--) {
      const date = subDays(new Date(), i).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      chartMap.set(date, 0);
    }

    // Fill with real data
    orders.forEach(order => {
      const date = order.createdAt.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      if (chartMap.has(date)) {
        chartMap.set(date, chartMap.get(date) + Number(order.totalPaid || 0));
      }
    });

    return Array.from(chartMap, ([date, amount]) => ({ date, amount }));
  }

  // =========================================================
  // AUDIT LOGS
  // =========================================================

  async getTransactionLog() {
    return this.prisma.auditLog.findMany({
      include: {
        admin: {
          select: { firstName: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // src/admin/admin.service.ts

async getMarketIntelligence(range: string) {
  const startDate = this.getStartDateFromRange(range);

  // 1. Fetch OrderItems with their Product's Category info
  const orderItems = await this.prisma.orderItem.findMany({
    where: { 
      order: { 
        status: OrderStatus.PAID, 
        createdAt: { gte: startDate } 
      } 
    },
    include: { 
      product: { 
        select: { 
          category: { select: { name: true } } 
        } 
      } 
    }
  });

  // 2. Aggregate Sales by Category Name
  const categoryMap = new Map<string, number>();

  orderItems.forEach((item) => {
    const categoryName = item.product?.category?.name || 'Uncategorized';
    const amount = Number(item.priceAtPurchase) * item.quantity; // Total for this line item
    
    categoryMap.set(
      categoryName, 
      (categoryMap.get(categoryName) || 0) + amount
    );
  });

  // Convert Map to Recharts-friendly format
  const categories = Array.from(categoryMap.entries()).map(([name, value]) => ({
    name,
    value: parseFloat(value.toFixed(2))
  }));

  // 3. Revenue vs Order Volume (Bar Chart)
  const revenueTrends = await this.getRevenueTrends(startDate);

  // 4. Top Performing Merchants
  const topVendorsRaw = await this.prisma.vendor.findMany({
    take: 5,
    include: {
      _count: {
        select: { 
          orders: { where: { status: OrderStatus.PAID, createdAt: { gte: startDate } } } 
        }
      },
      orders: {
        where: { status: OrderStatus.PAID, createdAt: { gte: startDate } },
        select: { totalAmount: true }
      }
    }
  });

  const topVendors = topVendorsRaw.map(v => ({
    storeName: v.storeName,
    salesCount: v._count.orders,
    revenue: v.orders.reduce((acc, curr) => acc + Number(curr.totalAmount), 0),
    growth: 12.5, // Placeholder for period-over-period logic
    rating: 4.5
  })).sort((a, b) => b.revenue - a.revenue);

  return { categories, revenueTrends, topVendors };
}

/**
 * Helper: Generates Date objects based on the range string
 */
private getStartDateFromRange(range: string): Date {
  const now = new Date();
  switch (range) {
    case 'today': return startOfDay(now);
    case '7d':    return subDays(now, 7);
    case '30d':   return subDays(now, 30);
    case '90d':   return subDays(now, 90);
    case '1y':    return subDays(now, 365);
    default:      return subDays(now, 7);
  }
}

/**
 * Helper: Groups paid orders by date for bar chart visualization
 */
private async getRevenueTrends(startDate: Date) {
  const orders = await this.prisma.order.findMany({
    where: { status: OrderStatus.PAID, createdAt: { gte: startDate } },
    select: { totalAmount: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  });

  const groups = orders.reduce((acc, order) => {
    const dateLabel = format(order.createdAt, 'MMM dd');
    if (!acc[dateLabel]) {
      acc[dateLabel] = { date: dateLabel, revenue: 0, orders: 0 };
    }
    acc[dateLabel].revenue += Number(order.totalAmount);
    acc[dateLabel].orders += 1;
    return acc;
  }, {} as Record<string, { date: string; revenue: number; orders: number }>);

  return Object.values(groups);
}

  // =========================================================
  // PERFORMANCE STATS
  // =========================================================

  async getPerformanceStats() {
    const [users, vendors, products, orders] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.vendor.count({ where: { status: 'ACTIVE' } }),
      this.prisma.product.count(),
      this.prisma.order.count()
    ]);

    return {
      totalUsers: users,
      activeVendors: vendors,
      totalProducts: products,
      totalOrders: orders
    };
  }

async getPlatformGrowthMetrics(query: GrowthMetricsQueryDto) {
  try {
    const { timeRange } = query;
    
    // 1. Calculate historical date boundaries based on the timeRange query parameter
    let targetDays = 7;
    if (timeRange === '30d') targetDays = 30;
    if (timeRange === '90d') targetDays = 90;
    if (timeRange === '1y') targetDays = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - targetDays);
    const endDate = new Date(); // Current timestamp

    // 2. Build the dynamic date filters
    const dateFilter = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    const [
      totalUsers,
      referredSignups,
      verifiedReferrals,
      totalVouchersIssued,
      totalVouchersRedeemed,
    ] = await this.prisma.$transaction([
      // 1. Total core user accounts base (Scoped to timeframe)
      this.prisma.user.count({ where: dateFilter }),

      // 2. Raw referred signups captured
      this.prisma.referralLog.count({ where: dateFilter }),

      // 3. Count rows that successfully flipped the verification milestone
      this.prisma.referralLog.count({ 
        where: { 
          ...dateFilter,
          isQualified: true 
        } 
      }),

      // 4. Total promotional assets generated
      this.prisma.voucher.count({ where: dateFilter }),

      // 5. Total metrics drawn out of processing states
      this.prisma.voucher.count({ 
        where: { 
          ...dateFilter,
          status: 'USED' 
        } 
      }),
    ]);

    // Calculate the Virality Coefficient (K-Factor)
    const kFactor = totalUsers > 0 ? referredSignups / totalUsers : 0;

    // Calculate conversion rate of referred invites to fully verified checks
    const referralConversionRate = referredSignups > 0 
      ? (verifiedReferrals / referredSignups) * 100 
      : 0;

    // Calculate financial utilization rate (Voucher Burn Rate)
    const voucherBurnRate = totalVouchersIssued > 0 
      ? (totalVouchersRedeemed / totalVouchersIssued) * 100 
      : 0;

    return {
      timestamp: new Date(),
      meta: {
        isFilteredRange: true,
        startDate: startDate,
        endDate: endDate,
      },
      summary: {
        totalPlatformUsers: totalUsers,
        rawReferredSignups: referredSignups,
        qualifiedReferrals: verifiedReferrals,
        vouchersIssuedCount: totalVouchersIssued,
        vouchersRedeemedCount: totalVouchersRedeemed,
      },
      performanceIndicators: {
        kFactor: Number(kFactor.toFixed(2)),
        conversionRatePercent: Number(referralConversionRate.toFixed(1)),
        voucherBurnRatePercent: Number(voucherBurnRate.toFixed(1)),
      },
    };
  } catch (error: any) {
    this.logger.error(`GROWTH_ANALYTICS_AGGREGATION_FAILED: ${error.message}`, error.stack);
    throw error;
  }
}

// Separate metric block to catch system exploits
async getTopGrowthDrivers(limit = 10) {
  try {
    return await this.prisma.referralLog.groupBy({
      by: ['referrerId'],
      _count: {
        id: true,
      },
      where: { isQualified: true },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
      take: limit,
    });
  } catch (error: any) {
    this.logger.error(`TOP_GROWTH_DRIVERS_FETCH_FAILED: ${error.message}`, error.stack);
    throw error;
  }
}
}