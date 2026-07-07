import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma.service';
import { MailService } from 'src/mail/mail.service';
import * as webpush from 'web-push';

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

  // Maps incoming interface categories cleanly to database setting fields and matching DB upper-case Enums
  private readonly categoryMap = {
    orderUpdates: { settingField: 'orderUpdates', dbType: 'ORDER_UPDATE' },
    promotions: { settingField: 'promotions', dbType: 'PROMOTION' },
    chatMessages: { settingField: 'chatMessages', dbType: 'CHAT' },
    storeActivity: { settingField: 'storeActivity', dbType: 'STORE_ACTIVITY' },
    priceDrops: { settingField: 'priceDrops', dbType: 'PRICE_DROP' },
    // Safely map secondary application types to fallback properties to ensure safe execution
    withdrawals: { settingField: 'orderUpdates', dbType: 'WITHDRAWAL' },
    payouts: { settingField: 'orderUpdates', dbType: 'PAYOUT' },
    security: { settingField: 'orderUpdates', dbType: 'SECURITY' },
    system: { settingField: 'systemEnabled' as any, dbType: 'SYSTEM' }, 
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
    // Synchronized with the singular table accessor method name
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
      const mapping = this.categoryMap[category];

      // Safely check notification toggle values dynamically using structural mapping bounds
      if (mapping && mapping.settingField in settings) {
        const isEnabled = settings[mapping.settingField as keyof typeof settings];
        if (isEnabled === false) {
          this.logger.log(`Notification skipped: User ${userId} has turned off ${category} preferences.`);
          return null;
        }
      }

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type: mapping ? mapping.dbType : 'SYSTEM',
          isRead: false,
        },
      });

      if (settings.pushEnabled) {
        this.logger.log(`[Push Dispatch Channel Triggered] for user ${userId}`);
        await this.dispatchWebPush(userId, title, message);
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

    // Standard flat object payload structure optimized for standard Service Workers parsing
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

  // Global broadcast method executing over unique users utilizing concurrency chunk safety limits
  async broadcast(title: string, message: string) {
    // 🌟 FIX: Updated filter matching your exact pluralized User schema relation 'notificationSettings'
    const targetSubscriptions = await this.prisma.pushSubscription.findMany({
      where: {
        user: {
          notificationSettings: {
            pushEnabled: true,
          },
        },
      },
      select: {
        id: true,
        endpoint: true,
        p256dh: true,
        auth: true,
        userId: true,
      },
    });

    const uniqueUserIds = Array.from(new Set(targetSubscriptions.map(s => s.userId)));

    // Sequential in-app feed processing loop utilizing core pipeline validation checks 
    for (const userId of uniqueUserIds) {
      await this.send({
        userId,
        title,
        message,
        category: 'system',
      });
    }

    // Prevents performance execution timeouts by chunking concurrent PWA payload updates into groups of 100
    const chunkSize = 100;
    const payload = JSON.stringify({
      title: title,
      body: message,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [100, 50, 100],
      data: { url: '/dashboard/notifications' }
    });

    for (let i = 0; i < targetSubscriptions.length; i += chunkSize) {
      const chunk = targetSubscriptions.slice(i, i + chunkSize);
      
      await Promise.all(
        chunk.map(async (device) => {
          const pushSubscriptionObj = {
            endpoint: device.endpoint,
            keys: {
              p256dh: device.p256dh,
              auth: device.auth,
            },
          };

          try {
            await webpush.sendNotification(pushSubscriptionObj, payload);
          } catch (error: any) {
            if (error.statusCode === 410 || error.statusCode === 404) {
              await this.prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => {});
            }
          }
        })
      );
    }

    return {
      success: true,
      recipients: uniqueUserIds.length,
    };
  }
}