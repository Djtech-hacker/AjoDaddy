// ============================================================
// PAY SMALL SMALL: CHAT between a customer and a vendor
// ============================================================
//
// A chat belongs to one customer and one vendor about one product. It can start
// BEFORE the customer buys (from the product page). When the customer starts a plan,
// that same conversation is attached to the plan, so nothing is lost.
// Only those two people can read or write in it. Messages are plain text.
// The screen asks for new messages every few seconds, so no socket is needed.
//
// A new message tells the other person in the app AND by email, at most once per
// burst of messages (10 minutes), so nobody gets spammed.

import { Injectable, BadRequestException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MailService } from '../../mail/mail.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

const MAX_LEN = 2000;
const LAST_N = 100;
const THREADS_N = 50;
const NOTIFY_GAP_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SsChatService {
  private readonly logger = new Logger('SsChatService');

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail:          MailService,
    private readonly cloudinary:    CloudinaryService,
  ) {}

  private shortName(u?: { firstName?: string | null; lastName?: string | null } | null) {
    if (!u) return 'Customer';
    const last = (u.lastName || '').trim();
    return `${(u.firstName || 'Customer').trim()}${last ? ' ' + last[0].toUpperCase() + '.' : ''}`;
  }

  // Product photos are stored as Cloudinary ids: turn the first one into a small picture link
  private thumb(images?: string[] | null) {
    return images && images[0] ? this.cloudinary.publicImageUrl(images[0], 240) : null;
  }

  // The product as the chat screens need it: its id, picture and price (in naira)
  private productInfo(prod: any) {
    return {
      productThumb: this.thumb(prod?.images),
      productPrice: prod?.price != null ? Number(prod.price) / 100 : null,
    };
  }

  private async people(customerId: string, vendorId: string) {
    const users: any[] = await this.prisma.user.findMany({
      where: { id: { in: [customerId, vendorId] } },
      select: { id: true, email: true, firstName: true, lastName: true, vendorProfile: { select: { businessName: true } } },
    });
    const customer = users.find(u => u.id === customerId);
    const vendor = users.find(u => u.id === vendorId);
    return {
      customer, vendor,
      customerName: this.shortName(customer),
      vendorName: vendor?.vendorProfile?.businessName || vendor?.firstName || 'Vendor',
    };
  }

  // Loads the thread and makes sure this person is its customer or vendor
  private async threadFor(userId: string, threadId: string) {
    if (!UUID_RE.test(threadId || '')) throw new NotFoundException('Chat not found');
    const t: any = await this.prisma.ssChatThread.findUnique({
      where: { id: threadId },
      include: {
        product: { select: { id: true, name: true, images: true, price: true } },
        order: { select: { orderNumber: true, productId: true, product: { select: { id: true, name: true, images: true, price: true } } } },
      },
    });
    if (!t || (t.customerId !== userId && t.vendorId !== userId)) throw new NotFoundException('Chat not found');

    const p = await this.people(t.customerId, t.vendorId);
    const isCustomer = t.customerId === userId;
    return {
      t, isCustomer, p,
      myName: isCustomer ? p.customerName : p.vendorName,
      otherName: isCustomer ? p.vendorName : p.customerName,
      otherId: isCustomer ? t.vendorId : t.customerId,
      otherUser: isCustomer ? p.vendor : p.customer,
      productName: t.product?.name ?? t.order?.product?.name ?? 'a product',
      productId: t.productId ?? t.order?.productId ?? null,
    };
  }

  // ── Start (or reopen) a chat from the product page, before buying ──
  async startProductChat(customerId: string, productId: string) {
    if (!UUID_RE.test(productId || '')) throw new NotFoundException('Product not found');
    const product = await this.prisma.ssProduct.findFirst({
      where: {
        id: productId, status: { in: ['ACTIVE', 'OUT_OF_STOCK'] as any },
        vendor: { vendorProfile: { is: { status: 'ACTIVE' } } },
      },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new NotFoundException('This product is not available.');
    if (product.vendorId === customerId) throw new BadRequestException('You cannot message yourself.');

    const existing = await this.prisma.ssChatThread.findFirst({
      where: { productId, customerId }, orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (existing) return { threadId: existing.id };

    const created = await this.prisma.ssChatThread.create({
      data: { productId, customerId, vendorId: product.vendorId },
      select: { id: true },
    });
    return { threadId: created.id };
  }

  // ── The vendor's inbox ──
  async listVendorThreads(vendorId: string) {
    const threads: any[] = await this.prisma.ssChatThread.findMany({
      where: { vendorId, messages: { some: {} } },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: THREADS_N,
      include: {
        product: { select: { name: true } },
        order: { select: { orderNumber: true, product: { select: { name: true } } } },
      },
    });

    const customerIds = Array.from(new Set(threads.map(t => t.customerId)));
    const customers: any[] = customerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];

    const items = await Promise.all(threads.map(async t => {
      const [last, unread] = await Promise.all([
        this.prisma.ssChatMessage.findFirst({ where: { threadId: t.id }, orderBy: { createdAt: 'desc' }, select: { content: true, isDeleted: true } }),
        this.prisma.ssChatMessage.count({
          where: { threadId: t.id, senderId: { not: vendorId }, isDeleted: false, NOT: { readBy: { has: vendorId } } },
        }),
      ]);
      return {
        threadId: t.id,
        customerName: this.shortName(customers.find(c => c.id === t.customerId)),
        productName: t.product?.name ?? t.order?.product?.name ?? 'Product',
        lastMessage: last ? (last.isDeleted ? 'Message deleted' : last.content) : null,
        lastMessageAt: t.lastMessageAt,
        unread,
        hasPlan: !!t.orderId,
      };
    }));
    return { items };
  }

  // ── Everything I am part of, as a customer or as a vendor ──
  async listMyThreads(userId: string) {
    const threads: any[] = await this.prisma.ssChatThread.findMany({
      where: { OR: [{ customerId: userId }, { vendorId: userId }], messages: { some: {} } },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: THREADS_N,
      include: {
        product: { select: { id: true, name: true, images: true, price: true } },
        order: { select: { orderNumber: true, productId: true, product: { select: { id: true, name: true, images: true, price: true } } } },
      },
    });

    const ids = Array.from(new Set(threads.flatMap(t => [t.customerId, t.vendorId])));
    const users: any[] = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, vendorProfile: { select: { businessName: true } } },
        })
      : [];
    const find = (id: string) => users.find(u => u.id === id);

    const items = await Promise.all(threads.map(async t => {
      const asCustomer = t.customerId === userId;
      const other = find(asCustomer ? t.vendorId : t.customerId);
      const otherName = asCustomer
        ? (other?.vendorProfile?.businessName || other?.firstName || 'Vendor')
        : this.shortName(other);
      const [last, unread] = await Promise.all([
        this.prisma.ssChatMessage.findFirst({ where: { threadId: t.id }, orderBy: { createdAt: 'desc' }, select: { content: true, isDeleted: true } }),
        this.prisma.ssChatMessage.count({
          where: { threadId: t.id, senderId: { not: userId }, isDeleted: false, NOT: { readBy: { has: userId } } },
        }),
      ]);
      const prod = t.product ?? t.order?.product;
      return {
        threadId: t.id,
        role: asCustomer ? 'CUSTOMER' : 'VENDOR',
        otherName,
        productName: prod?.name ?? 'Product',
        productId: t.productId ?? t.order?.productId ?? null,
        ...this.productInfo(prod),
        orderId: t.orderId ?? null,
        hasPlan: !!t.orderId,
        lastMessage: last ? (last.isDeleted ? 'Message deleted' : last.content) : null,
        lastMessageAt: t.lastMessageAt,
        unread,
      };
    }));
    return { items };
  }

  // The number on the Messages button
  async unreadCount(userId: string) {
    const count = await this.prisma.ssChatMessage.count({
      where: {
        senderId: { not: userId }, isDeleted: false, NOT: { readBy: { has: userId } },
        thread: { OR: [{ customerId: userId }, { vendorId: userId }] },
      },
    });
    return { count };
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

    return {
      thread: {
        id: t.id, isOpen: t.isOpen, otherName: ctx.otherName, iAmCustomer: ctx.isCustomer,
        productName: ctx.productName, orderNumber: t.order?.orderNumber ?? null,
        productId: ctx.productId, orderId: t.orderId ?? null,
        ...this.productInfo(t.product ?? t.order?.product),
      },
      messages: rows.map((m: any) => ({
        id: m.id,
        mine: m.senderId === userId,
        senderName: m.senderId === t.customerId ? ctx.p.customerName : ctx.p.vendorName,
        content: m.isDeleted ? null : m.content,
        isDeleted: m.isDeleted,
        createdAt: m.createdAt,
      })),
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

    // Tell the other person (app + email) once per burst of messages
    const newBurst = !prev || prev.senderId !== userId || Date.now() - prev.createdAt.getTime() > NOTIFY_GAP_MS;
    if (newBurst) {
      // the link opens this exact conversation on the Messages page
      const path = `/messages?thread=${threadId}`;
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
      try {
        const payload: any = {
          userId: ctx.otherId, type: 'SS_NEW_MESSAGE', priority: 'IMPORTANT',
          title: `New message from ${ctx.myName}`,
          body: `${ctx.productName}: ${preview}`,
          data: { threadId, orderId: ctx.t.orderId ?? null, productId: ctx.productId },
        };
        await this.notifications.create(payload);
      } catch (err: any) {
        this.logger.warn(`Chat notification failed: ${err?.message}`);
      }
      try {
        if (ctx.otherUser?.email) {
          await this.mail.sendNewChatMessage(ctx.otherUser.email, ctx.otherUser.firstName || '', ctx.myName, ctx.productName, text, path);
        }
      } catch (err: any) {
        this.logger.warn(`Chat email failed: ${err?.message}`);
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