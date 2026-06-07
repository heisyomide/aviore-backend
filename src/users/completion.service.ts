// src/users/completion.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service'; // Adjust path based on your module setup
import { CompletionEngineResponse, CompletionTask } from './interfaces/completion.interface';

@Injectable()
export class CompletionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * CUSTOMER COMPLETION TRACK
   */
  async calculateCustomerStatus(userId: string): Promise<CompletionEngineResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found.');
    }

    // Map your exact schema parameters for profile check
    const isProfileComplete = !!(user.firstName && user.lastName && user.phone);

    // Verify delivery address relation list count
    const addressCount = await this.prisma.address.count({
      where: { userId },
    });
    const hasAddress = addressCount > 0;

    // Check historical checkout orders counts
    const orderCount = await this.prisma.order.count({
      where: { userId },
    });
    const hasPlacedOrder = orderCount > 0;

    const tasks: CompletionTask[] = [
      {
        id: 'customer-profile',
        title: 'Complete Profile Details',
        description: 'Ensure your profile identity details and phone records are saved completely.',
        completed: isProfileComplete,
        route: '/dashboard/profile',
      },
      {
        id: 'customer-address',
        title: 'Add Shipping Address',
        description: 'Provide your primary destination location for shipping calculations.',
        completed: hasAddress,
        route: '/dashboard/addresses',
      },
    ];

    // Growth Guidance Activation: Triggers once core configuration is complete but first purchase is pending
    if (isProfileComplete && hasAddress && !hasPlacedOrder) {
      tasks.push({
        id: 'first-order-guidance',
        title: 'Place Your First Order',
        description: 'Explore your dashboard vouchers and coupons page to claim active launch rewards!',
        completed: false,
        route: '/dashboard/coupons',
      });
    }

    const totalTasks = tasks.length;
    const completedTasksCount = tasks.filter((t) => t.completed).length;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;

    return {
      completionPercentage,
      isFullyActive: isProfileComplete && hasAddress,
      tasks,
    };
  }

  /**
   * VENDOR COMPLETION TRACK
   */
  async calculateVendorStatus(userId: string): Promise<CompletionEngineResponse> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
      select: {
        id: true,
        slug: true,
        bankName: true,
        accountNumber: true,
        description: true,
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor profile not found.');
    }

    const tasks: CompletionTask[] = [
      {
        id: 'vendor-slug',
        title: 'Configure Store URL Slug',
        description: 'Set up your unique web marketplace handle to receive traffic.',
        completed: !!vendor.slug && vendor.slug.trim().length > 0,
        route: '/vendor/settings',
      },
      {
        id: 'vendor-bank',
        title: 'Setup Payout Treasury Bank',
        description: 'Provide your payout bank name and account number for balance clearance.',
        completed: !!(vendor.bankName && vendor.accountNumber),
        route: '/vendor/settings',
      },
      {
        id: 'vendor-description',
        title: 'Write Store Description',
        description: 'Add a summary details description of your brand niche for buyer confidence.',
        completed: !!vendor.description && vendor.description.trim().length > 0,
        route: '/vendor/settings',
      },
    ];

    const totalTasks = tasks.length;
    const completedTasksCount = tasks.filter((t) => t.completed).length;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasksCount / totalTasks) * 100) : 0;

    return {
      completionPercentage,
      isFullyActive: completionPercentage === 100,
      tasks,
    };
  }
}