import { Controller, Get, Patch, Body, Req, UseGuards, Param, Post } from '@nestjs/common'; // 🌟 Added Post
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from './notification.service';

@ApiTags('User Notifications Pipeline')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // 🌟 ADDED: Device Token Registration Intake Endpoint
  @Post('subscribe')
  @ApiOperation({ summary: 'Register browser PWA push subscription credentials mapping to user context' })
  async subscribeDevice(@Req() req: any, @Body() subscriptionDto: any) {
    return this.notificationService.saveSubscription(req.user.id, subscriptionDto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Retrieve target notification preferences toggles map' })
  async getSettings(@Req() req: any) {
    let settings = await this.prisma.notificationSetting.findUnique({
      where: { userId: req.user.id },
    });

    if (!settings) {
      settings = await this.prisma.notificationSetting.create({
        data: { userId: req.user.id },
      });
    }
    return settings;
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update specific channel distribution toggles dynamically' })
  async updateSettings(@Req() req: any, @Body() updateDto: Record<string, boolean>) {
    return this.prisma.notificationSetting.upsert({
      where: { userId: req.user.id },
      update: updateDto,
      create: {
        userId: req.user.id,
        ...updateDto,
      },
    });
  }

  @Get('feed')
  @ApiOperation({ summary: 'Fetch timeline history array logs for the authenticated user context' })
  async getUserFeed(@Req() req: any) {
    return this.prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count current unread notifications' })
  async unreadCount(@Req() req: any) {
    return {
      count: await this.prisma.notification.count({
        where: {
          userId: req.user.id,
          isRead: false,
        },
      }),
    };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark specific notification as read' })
  async markRead(@Param('id') id: string, @Req() req: any) {
    return this.notificationService.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notification logs as read' })
  async markAllRead(@Req() req: any) {
    return this.notificationService.markAllAsRead(req.user.id);
  }
}