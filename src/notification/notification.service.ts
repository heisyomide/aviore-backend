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
private readonly logger =
new Logger(NotificationService.name);

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

constructor(
    @Inject(forwardRef(() => MailService)) // ◄ Inject lazily
private readonly prisma: PrismaService,
private readonly mailService: MailService,
) {}

private async getSettings(
userId: string,
) {
let settings =
await this.prisma.notificationSetting.findUnique({
where: {
userId,
},
});

if (!settings) {
  settings =
    await this.prisma.notificationSetting.create({
      data: {
        userId,
      },
    });
}
return settings;

}

async send(
payload: NotificationPayload,
) {
const {
userId,
title,
message,
category,
} = payload;

const settings =
  await this.getSettings(userId);
const mappedCategory =
  this.categoryMap[category];
if (
  mappedCategory &&
  settings[mappedCategory] === false
) {
  return null;
}
if (!settings.pushEnabled) {
  return null;
}
return this.prisma.notification.create({
  data: {
    userId,
    title,
    message,
    type: category.toUpperCase(),
    isRead: false,
  },
});

}

async markAsRead(
notificationId: string,
userId: string,
) {
const notification =
await this.prisma.notification.findFirst({
where: {
id: notificationId,
userId,
},
});

if (!notification) {
  return null;
}
return this.prisma.notification.update({
  where: {
    id: notificationId,
  },
  data: {
    isRead: true,
  },
});

}

async markAllAsRead(
userId: string,
) {
return this.prisma.notification.updateMany({
where: {
userId,
isRead: false,
},
data: {
isRead: true,
},
});
}

async unreadCount(
userId: string,
) {
return this.prisma.notification.count({
where: {
userId,
isRead: false,
},
});
}

async getFeed(
userId: string,
) {
return this.prisma.notification.findMany({
where: {
userId,
},
orderBy: {
createdAt: 'desc',
},
});
}

async broadcast(
title: string,
message: string,
) {
const users =
await this.prisma.user.findMany({
select: {
id: true,
},
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