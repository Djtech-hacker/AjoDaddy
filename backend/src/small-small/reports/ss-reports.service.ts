// ============================================================
// PAY SMALL SMALL: REPORT A VENDOR
// ============================================================
// A customer reports a vendor from a product, a plan or a chat. The report is saved as a
// Dispute (type SS_VENDOR_REPORT), the same table customer care already works from.
// If it comes from a chat, the last messages are attached so staff see what was said.
// The vendor is NOT told who reported them.

import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ReportVendorDto } from './dto/reports.dto';

const REASON_LABEL: Record<string, string> = {
  SCAM: 'Scam or fraud',
  NOT_AS_DESCRIBED: 'Product is fake or not as described',
  NO_DELIVERY: 'Not delivering the goods',
  OFF_PLATFORM: 'Asked me to pay or chat outside TAREVA',
  ABUSE: 'Rude, threatening or abusive',
  OTHER: 'Something else',
};

const STAFF_ROLES = ['CUSTOMER_SERVICE', 'ADMIN', 'SUPER_ADMIN'];
const OPEN_STATES = ['OPEN', 'UNDER_REVIEW', 'ESCALATED'];
const TRANSCRIPT_N = 15;

@Injectable()
export class SsReportsService {
  private readonly logger = new Logger('SsReportsService');

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async reportVendor(reporterId: string, dto: ReportVendorDto, ip?: string) {
    let vendorId = '';
    let productId: string | null = null;
    let orderId: string | null = null;
    let orderNumber: string | null = null;
    let productName = '';
    let productRef = '';
    let transcript = '';

    if (dto.threadId) {
      // the chat is the best source: it gives us the vendor, the product, the plan and the messages
      const t: any = await this.prisma.ssChatThread.findFirst({
        where: { id: dto.threadId, customerId: reporterId },
        include: {
          product: { select: { id: true, name: true, referenceNumber: true } },
          order: { select: { id: true, orderNumber: true, product: { select: { id: true, name: true, referenceNumber: true } } } },
        },
      });
      if (!t) throw new NotFoundException('Chat not found');
      vendorId = t.vendorId;
      const prod = t.product ?? t.order?.product;
      productId = prod?.id ?? null; productName = prod?.name ?? ''; productRef = prod?.referenceNumber ?? '';
      orderId = t.orderId ?? null; orderNumber = t.order?.orderNumber ?? null;

      const msgs: any[] = (await this.prisma.ssChatMessage.findMany({
        where: { threadId: t.id }, orderBy: { createdAt: 'desc' }, take: TRANSCRIPT_N,
      })).reverse();
      transcript = msgs.map(m => {
        const who = m.senderId === reporterId ? 'Customer' : 'Vendor';
        const when = m.createdAt.toISOString().replace('T', ' ').slice(0, 16);
        const text = m.isDeleted ? '(deleted)' : String(m.content ?? '').slice(0, 300);
        return `[${when}] ${who}: ${text}`;
      }).join('\n');
    } else if (dto.orderId) {
      const o: any = await this.prisma.ssOrder.findFirst({
        where: { id: dto.orderId, customerId: reporterId },
        select: { id: true, orderNumber: true, vendorId: true, productId: true, product: { select: { name: true, referenceNumber: true } } },
      });
      if (!o) throw new NotFoundException('Plan not found');
      vendorId = o.vendorId; productId = o.productId; orderId = o.id; orderNumber = o.orderNumber;
      productName = o.product?.name ?? ''; productRef = o.product?.referenceNumber ?? '';
    } else if (dto.productId) {
      const p: any = await this.prisma.ssProduct.findUnique({
        where: { id: dto.productId }, select: { id: true, vendorId: true, name: true, referenceNumber: true },
      });
      if (!p) throw new NotFoundException('Product not found');
      vendorId = p.vendorId; productId = p.id; productName = p.name; productRef = p.referenceNumber;
    } else {
      throw new BadRequestException('Tell us which vendor you are reporting.');
    }

    if (vendorId === reporterId) throw new BadRequestException('You cannot report yourself.');

    // one open report per vendor at a time, so staff are not flooded
    const already = await this.prisma.dispute.findFirst({
      where: { reporterId, reportedUserId: vendorId, type: 'SS_VENDOR_REPORT', status: { in: OPEN_STATES as any } },
      select: { id: true },
    });
    if (already) throw new ConflictException('You already have an open report about this vendor. Our team is looking into it.');

    const vendor: any = await this.prisma.user.findUnique({
      where: { id: vendorId },
      select: { username: true, vendorProfile: { select: { businessName: true } } },
    });
    const vendorName = vendor?.vendorProfile?.businessName || vendor?.username || 'Vendor';

    const description = [
      `Reason: ${REASON_LABEL[dto.reason] || dto.reason}`,
      `Vendor: ${vendorName}`,
      productName ? `Product: ${productName}${productRef ? ` (${productRef})` : ''}` : null,
      orderNumber ? `Plan: ${orderNumber}` : null,
      '',
      `What the customer said:`,
      dto.details.trim(),
      transcript ? `\nLast messages in the chat:\n${transcript}` : null,
    ].filter(x => x !== null).join('\n');

    const dispute = await this.prisma.dispute.create({
      data: {
        reporterId, reportedUserId: vendorId, ssOrderId: orderId,
        type: 'SS_VENDOR_REPORT', description, evidenceUrls: [],
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: reporterId, action: 'SS_VENDOR_REPORTED', entityType: 'DISPUTE', entityId: dispute.id,
        metadata: { vendorId, reason: dto.reason, productId, orderId }, ipAddress: ip,
      },
    });

    // tell customer care and admins (not the vendor)
    try {
      const staff = await this.prisma.user.findMany({
        where: { role: { in: STAFF_ROLES as any }, status: 'ACTIVE' as any }, select: { id: true }, take: 30,
      });
      for (const s of staff) {
        const payload: any = {
          userId: s.id, type: 'SS_DISPUTE_OPENED', priority: 'IMPORTANT',
          title: 'Vendor reported',
          body: `${REASON_LABEL[dto.reason] || dto.reason}: ${vendorName}${productName ? ` (${productName})` : ''}`,
          data: { disputeId: dispute.id, vendorId, orderId },
        };
        await this.notifications.create(payload);
      }
    } catch (err: any) {
      this.logger.warn(`Staff notification failed: ${err?.message}`);
    }

    return { message: 'Thank you. Our team will look into this and follow up.', reportId: dispute.id };
  }
}