// ============================================================
// PAY SMALL SMALL: CHAT between the customer and the vendor
// ============================================================
//
// One thread per order (created when the plan starts). Only the customer and the
// vendor of that order can read or write in it. Messages are plain text.
// The screen asks for new messages every few seconds, so no socket is needed.

import { Injectable, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

const MAX_LEN = 2000;
const LAST_N = 100;
// Tell the other person about a new message at most once per burst
const NOTIFY_GAP_MS = 10 * 60 * 1000;

@Injectable()
export class SsChatService {
  private readonly logger = new Logger('SsChatService');

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private shortName(u?: { firstName?: string | null; lastName?: string | null } | null) {
    if (!u) return 'Customer';
    const last = (u.lastName || '').trim();
    return `${(u.firstName || 'Customer').trim()}${last ? ' ' + last[0].toUpperCase() + '.' : ''}`;
  }

  // Loads the thread and makes sure this person is the customer or the vendor of the order
  private async threadFor(userId: string, threadId: string) {
    const t: any = await this.prisma.ssChatThread.findUnique({
      where: { id: threadId },
      include: {
        order: {
          select: {
            orderNumber: true,
            product: { select: { name: true } },
            customer: { select: { firstName: true, lastName: true } },
            vendor: { select: { firstName: true, vendorProfile: { select: { businessName: true } } } },
          },
        },
      },
    });
    if (!t || (t.customerId !== userId && t.vendorId !== userId)) throw new NotFoundException('Chat not found');

    const customerName = this.shortName(t.order.customer);
    const vendorName = t.order.vendor?.vendorProfile?.businessName || t.order.vendor?.firstName || 'Vendor';
    const isCustomer = t.customerId === userId;
    return {
      t, isCustomer,
      myName: isCustomer ? customerName : vendorName,
      otherName: isCustomer ? vendorName : customerName,
      otherId: isCustomer ? t.vendorId : t.customerId,
    };
  }

  private present(m: any, userId: string, names: { customerId: string; customerName: string; vendorName: string }) {
    return {
      id: m.id,
      mine: m.senderId === userId,
      senderName: m.senderId === names.customerId ? names.customerName : names.vendorName,
      content: m.isDeleted ? null : m.content,
      isDeleted: m.isDeleted,
      createdAt: m.createdAt,
    };
  }

  async listMessages(userId: string, threadId: string) {
    const ctx = await this.threadFor(userId, threadId);
    const { t } = ctx;

    const rows = (await this.prisma.ssChatMessage.findMany({
      where: { threadId }, orderBy: { createdAt: 'desc' }, take: LAST_N,
    })).reverse();

    // Mark what the other person wrote as read by me
    await this.prisma.ssChatMessage.updateMany({
      where: { threadId, senderId: { not: userId }, NOT: { readBy: { has: userId } } },
      data: { readBy: { push: userId } },
    });

    const names = {
      customerId: t.customerId,
      customerName: ctx.isCustomer ? ctx.myName : ctx.otherName,
      vendorName: ctx.isCustomer ? ctx.otherName : ctx.myName,
    };
    return {
      thread: {
        id: t.id, isOpen: t.isOpen, otherName: ctx.otherName,
        productName: t.order.product.name, orderNumber: t.order.orderNumber,
      },
      messages: rows.map((m: any) => this.present(m, userId, names)),
    };
  }

  async sendMessage(userId: string, threadId: string, content: string) {
    const text = (content || '').trim();
    if (!text) throw new BadRequestException('Type a message first.');
    if (text.length > MAX_LEN) throw new BadRequestException(`Messages can be at most ${MAX_LEN} characters.`);

    const ctx = await this.threadFor(userId, threadId);
    if (!ctx.t.isOpen) throw new ForbiddenException('This chat is closed.');

    const prev = await this.prisma.ssChatMessage.findFirst({
      where: { threadId }, orderBy: { createdAt: 'desc' }, select: { senderId: true, createdAt: true },
    });

    const msg = await this.prisma.ssChatMessage.create({
      data: { threadId, senderId: userId, type: 'TEXT' as any, content: text, readBy: [userId] },
    });
    await this.prisma.ssChatThread.update({ where: { id: threadId }, data: { lastMessageAt: msg.createdAt } });

    const quiet = !prev || prev.senderId !== userId || Date.now() - prev.createdAt.getTime() > NOTIFY_GAP_MS;
    if (quiet) {
      try {
        const payload: any = {
          userId: ctx.otherId, type: 'SS_NEW_MESSAGE',
          title: `New message from ${ctx.myName}`,
          body: `${ctx.t.order.product.name}: ${text.length > 80 ? text.slice(0, 80) + '…' : text}`,
          data: { threadId, orderId: ctx.t.orderId },
        };
        await this.notifications.create(payload);
      } catch (err: any) {
        this.logger.warn(`Chat notification failed: ${err?.message}`);
      }
    }

    return {
      id: msg.id, mine: true, senderName: ctx.myName,
      content: msg.content, isDeleted: false, createdAt: msg.createdAt,
    };
  }

  async deleteMessage(userId: string, threadId: string, messageId: string) {
    await this.threadFor(userId, threadId);
    const res = await this.prisma.ssChatMessage.updateMany({
      where: { id: messageId, threadId, senderId: userId, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date(), content: null },
    });
    if (res.count === 0) throw new NotFoundException('Message not found');
    return { message: 'Message deleted.' };
  }
}