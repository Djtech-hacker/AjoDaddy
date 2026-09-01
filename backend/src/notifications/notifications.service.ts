// ============================================================
// NOTIFICATIONS MODULE — In-app + Email (Resend) + Realtime
// ============================================================

import {
  Module, Controller, Get, Patch, Param, Query,
  UseGuards, Req, Injectable, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';

interface CreateNotificationParams {
  userId:  string;
  type:    string;
  title:   string;
  body:    string;
  data?:   any;
  sendEmail?: boolean;
  emailSubject?: string;
  emailHtml?:    string;
}

@Injectable()
export class NotificationsService {
  private readonly logger  = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private socketServer: any;

  constructor(
    private readonly prisma:         PrismaService,
    private readonly configService:  ConfigService,
  ) {
    this.resend = new Resend(this.configService.get('resend.apiKey'));
  }

  setSocketServer(server: any) { this.socketServer = server; }

  async create(params: CreateNotificationParams) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type:   params.type as any,
        title:  params.title,
        body:   params.body,
        data:   params.data || {},
      },
    });

    if (this.socketServer) {
      this.socketServer.to(`user:${params.userId}`).emit('notification', {
        id:        notification.id,
        type:      notification.type,
        title:     notification.title,
        body:      notification.body,
        data:      notification.data,
        createdAt: notification.createdAt,
      });
    }

    if (params.sendEmail && params.emailHtml) {
      await this.sendEmail(params.userId, params.emailSubject || params.title, params.emailHtml);
    }

    return notification;
  }

  async sendEmail(userId: string, subject: string, html: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user) return;

    try {
      await this.resend.emails.send({
        from:    this.configService.get('resend.emailFrom') as string,
        to:      user.email,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${user.email}:`, err.message);
    }
  }

  getWelcomeEmailHtml(firstName: string, verifyUrl: string): string {
    return `
      <div style="font-family: 'Plus Jakarta Sans', sans-serif; max-width: 600px; margin: 0 auto; background: #F8F6F1; padding: 40px 24px;">
        <div style="background: #0B0A08; border-radius: 16px; padding: 40px; text-align: center; margin-bottom: 32px;">
          <h1 style="color: #fff; font-size: 28px; font-weight: 800; margin: 0 0 8px;">Welcome to PayPaddy</h1>
          <p style="color: rgba(255,255,255,0.5); font-size: 14px; margin: 0;">Save together. Grow together.</p>
        </div>
        <div style="background: #fff; border-radius: 16px; padding: 32px; margin-bottom: 24px;">
          <h2 style="color: #111009; font-size: 20px; font-weight: 700; margin: 0 0 12px;">Hi ${firstName}! 👋</h2>
          <p style="color: #6B6760; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
            Your PayPaddy account has been created. Verify your email to start saving with your community.
          </p>
          <a href="${verifyUrl}" style="display: inline-block; background: #111009; color: #fff; font-size: 14px; font-weight: 700; padding: 14px 28px; border-radius: 12px; text-decoration: none;">
            Verify Email Address →
          </a>
        </div>
        <p style="color: #9B9690; font-size: 12px; text-align: center; margin: 0;">
          © 2025 PayPaddy Technologies Ltd · Lagos · Accra · London
        </p>
      </div>
    `;
  }

  getPayoutEmailHtml(firstName: string, amount: number, groupName: string): string {
    return `
      <div style="font-family: 'Plus Jakarta Sans', sans-serif; max-width: 600px; margin: 0 auto; background: #F8F6F1; padding: 40px 24px;">
        <div style="background: #1B5C3C; border-radius: 16px; padding: 40px; text-align: center; margin-bottom: 32px;">
          <p style="color: #A8E03A; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 12px;">Payout Incoming</p>
          <h1 style="color: #fff; font-size: 40px; font-weight: 800; margin: 0 0 8px;">₦${amount.toLocaleString()}</h1>
          <p style="color: rgba(255,255,255,0.6); font-size: 14px; margin: 0;">From ${groupName}</p>
        </div>
        <div style="background: #fff; border-radius: 16px; padding: 32px;">
          <h2 style="color: #111009; font-size: 20px; font-weight: 700; margin: 0 0 12px;">Hi ${firstName}! 🎉</h2>
          <p style="color: #6B6760; font-size: 14px; line-height: 1.6;">
            It's your turn! ₦${amount.toLocaleString()} will be transferred to your registered bank account within 24 hours.
          </p>
        </div>
      </div>
    `;
  }

  async getNotifications(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const skip  = (page - 1) * limit;
    const where: any = { userId };
    if (unreadOnly) where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data:  { isRead: true, readAt: new Date() },
    });
    return { message: 'Marked as read' };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data:  { isRead: true, readAt: new Date() },
    });
    return { message: 'All notifications marked as read' };
  }
}

// ── Notifications Controller ──────────────────────────────────

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get my notifications' })
  getNotifications(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('unreadOnly') unreadOnly = false,
  ) {
    return this.notificationsService.getNotifications(req.user.id, +page, +limit, Boolean(unreadOnly));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.id, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@Req() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }
}

@Module({
  controllers: [NotificationsController],
  providers:   [NotificationsService],
  exports:     [NotificationsService],
})
export class NotificationsModule {}