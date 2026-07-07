import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service';
// 🌟 FIX: Removed the duplicate import of MailService from line 10 
// since it's declared locally right at the bottom of this file.
import * as webpush from 'web-push';
import { MailService } from 'src/mail/mail.service';

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
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  private readonly categoryMap = {
    orderUpdates: 'orderUpdates',
    promotions: 'promotions',
    chatMessages: 'chatMessages',
    storeActivity: 'storeActivity',
    priceDrops: 'priceDrops',
    withdrawals: 'withdrawals',
    payouts: 'payouts',
    security: 'security',
    system: 'system',
  } as const;

  constructor(
    private readonly prisma: PrismaService,

    @Inject(forwardRef(() => MailService))
    private readonly mailService: MailService,
  ) {}

  onModuleInit() {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@shopaviore.store',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    this.logger.log('🚀 Web-Push encryption engine initialized with VAPID credentials.');
  }

  async saveSubscription(userId: string, subscriptionDto: any) {
    const { endpoint, keys } = subscriptionDto;
    
    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      create: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });
  }

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

      if (mappedCategory && settings[mappedCategory as keyof typeof settings] === false) {
        this.logger.log(`Notification skipped: User ${userId} has turned off ${category} preferences.`);
        return null;
      }

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type: category.toUpperCase(),
          isRead: false,
        },
      });

      if (settings.pushEnabled) {
        this.logger.log(`[Push Dispatch Channel Triggered] for user ${userId}`);
        this.dispatchWebPush(userId, title, message);
      }

      return notification;
    } catch (error) {
      this.logger.error(`🔴 FAILED TO CREATE NOTIFICATION FOR USER ${userId}:`, error);
      return null;
    }
  }

  private async dispatchWebPush(userId: string, title: string, message: string) {
    const devices = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (!devices.length) return;

    const payload = JSON.stringify({
      title: title,
      body: message,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [100, 50, 100],
      data: { 
        url: '/dashboard/notifications' 
      }
    });

    await Promise.all(
      devices.map(async (device) => {
        const pushSubscriptionObj = {
          endpoint: device.endpoint,
          keys: {
            p256dh: device.p256dh,
            auth: device.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscriptionObj, payload);
          this.logger.log(`✅ Push successfully routed to device connection endpoint: ${device.id}`);
        } catch (error: any) {
          this.logger.error(`🔴 Failed pushing to device endpoint: ${device.id}`, error);
          if (error.statusCode === 410 || error.statusCode === 404) {
            await this.prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => {});
            this.logger.warn(`Cleaned up expired subscription instance token: ${device.id}`);
          }
        }
      }),
    );
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) return null;
    
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
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
