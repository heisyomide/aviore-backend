import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';

export interface NotificationPayload {
  userId: string;
  userEmail?: string;
  title: string;
  message: string;
  category:
    | 'orderUpdates'
    | 'promotions'
    | 'chatMessages'
    | 'storeActivity'
    | 'priceDrops'
    | 'withdrawals'
    | 'payouts'
    | 'security'
    | 'system';
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  private readonly categoryMap = {
    orderUpdates: 'orderUpdates',
    promotions: 'promotions',
    chatMessages: 'chatMessages',
    storeActivity: 'storeActivity',
    priceDrops: 'priceDrops',
    withdrawals: null,
    payouts: null,
    security: null,
    system: null,
  } as const;

  // ✅ FIXED: Separated Prisma and accurately bound forwardRef directly to MailService
  constructor(
    private readonly prisma: PrismaService,

    @Inject(forwardRef(() => MailService))
    private readonly mailService: MailService,
  ) {}

  private async getSettings(userId: string) {
    let settings = await this.prisma.notificationSetting.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await this.prisma.notificationSetting.create({
        data: { userId },
      });
    }
    return settings;
  }

  async send(payload: NotificationPayload) {
    const { userId, title, message, category } = payload;

    try {
      const settings = await this.getSettings(userId);
      const mappedCategory = this.categoryMap[category];

      // Check preference array constraints if explicitly bound to a user preference field
      if (mappedCategory && settings[mappedCategory as keyof typeof settings] === false) {
        this.logger.log(`Notification skipped: User ${userId} has turned off ${category} preferences.`);
        return null;
      }

      // ✅ FIXED: Removed the fatal 'if (!settings.pushEnabled) return null' blockage line.
      // We always write the row record to the user's database history feed log.
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type: category.toUpperCase(), // Aligns with 'CHAT_MESSAGES', 'SECURITY', 'SYSTEM'
          isRead: false,
        },
      });

      // 📲 External push dispatch step can be conditionally triggered downstream here:
      if (settings.pushEnabled) {
        // Trigger real-time mechanisms like Socket.io gateway emit / Firebase Web Push here later!
        this.logger.log(`[Push Dispatch Channel Triggered] for user ${userId}`);
      }

      return notification;
    } catch (error) {
      this.logger.error(`🔴 FAILED TO CREATE NOTIFICATION FOR USER ${userId}:`, error);
      return null;
    }
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      return null;
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

async markAllAsRead(userId: string) {
  return this.prisma.notification.updateMany({ // ✅ Single '.prisma'
    where: {
      userId,
      isRead: false,
    },
    data: { isRead: true },
  });
}

  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }

  async getFeed(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async broadcast(title: string, message: string) {
    const users = await this.prisma.user.findMany({
      select: { id: true },
    });

    // Uses the fixed send method to safely register all entries
    await Promise.all(
      users.map((user) =>
        this.send({
          userId: user.id,
          title,
          message,
          category: 'system',
        }),
      ),
    );

    return {
      success: true,
      recipients: users.length,
    };
  }
}