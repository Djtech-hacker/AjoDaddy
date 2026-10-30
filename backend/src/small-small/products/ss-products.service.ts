// ============================================================
// PAY SMALL SMALL: PRODUCTS AND STOCK
// ============================================================
//
// Stock rule:   available = totalStock - reservedCount - soldCount
//   reservedCount = units held by customers who are still paying
//   soldCount     = units fully paid for
// Stock moves ONLY through setStock() (logged) or the orders service (next phase).
//
// Orders copy the product's terms when a plan starts, so editing a product here
// never changes a plan a customer already started.
//
// Customers pay any amount from start to finish (no percentage minimum), and the
// vendor is always paid when the customer finishes paying.
//
// Money in the API is NAIRA. The database stores KOBO.

import {
  Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { generateReferenceNumber, looksLikeReferenceNumber } from '../utils/reference-number.util';
import {
  CreateProductDto, UpdateProductDto, UpdateStockDto, SetProductStatusDto, FlagProductDto,
} from './dto/products.dto';

const STAFF_ROLES = ['CUSTOMER_SERVICE', 'ADMIN', 'SUPER_ADMIN'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;

const FREQUENCY_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };

// The vendor's rules for one product, in the units the vendor typed them
type Terms = {
  price: number; // naira
  allowedFrequencies: string[];
  customIntervalDays: number[];
  paymentDeadlineDays: number;
  refundThresholdPercent: number;
};

const toNaira = (kobo: bigint | number) => Number(kobo) / 100;
const toKobo  = (naira: number) => BigInt(Math.round(naira * 100));

@Injectable()
export class SsProductsService {
  private readonly logger = new Logger('SsProductsService');

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationsService,
    private readonly cloudinary:    CloudinaryService,
  ) {}

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  private async maxImages(): Promise<number> {
    const s: any = await this.prisma.platformSetting.findFirst();
    return s?.ssMaxProductImages ?? 5;
  }

  private async audit(actorId: string, action: string, entityId: string, metadata: any, ipAddress?: string) {
    await this.prisma.auditLog.create({
      data: { actorId, action, entityType: 'SS_PRODUCT', entityId, metadata, ipAddress },
    });
  }

  private async notify(userId: string, type: string, title: string, body: string, data: any = {}, important = false) {
    try {
      const payload: any = { userId, type, title, body, data };
      if (important) payload.priority = 'IMPORTANT';
      await this.notifications.create(payload);
    } catch (err: any) {
      this.logger.warn(`Notification failed (${type}): ${err?.message}`);
    }
  }

  private async assertStaff(actorId: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: true } });
    if (!actor || !STAFF_ROLES.includes(actor.role)) throw new ForbiddenException('Staff access required');
    return actor;
  }

  private available(p: { totalStock: number; reservedCount: number; soldCount: number }) {
    return Math.max(0, p.totalStock - p.reservedCount - p.soldCount);
  }

  // The checks the schema cannot do for us
  private validateTerms(t: Terms) {
    const freq = t.allowedFrequencies;
    if (freq.length === 0) throw new BadRequestException('Choose at least one payment frequency.');

    if (freq.includes('CUSTOM')) {
      if (t.customIntervalDays.length === 0) {
        throw new BadRequestException('Enter the custom interval in days (for example 2 or 14).');
      }
    } else if (t.customIntervalDays.length > 0) {
      throw new BadRequestException('Custom days were given but "custom" is not one of the allowed frequencies.');
    }

    // Every option must fit at least once inside the deadline
    const intervals = freq.flatMap(f => (f === 'CUSTOM' ? t.customIntervalDays : [FREQUENCY_DAYS[f]]));
    const longest = Math.max(...intervals);
    if (t.paymentDeadlineDays < longest) {
      throw new BadRequestException(`The payment deadline (${t.paymentDeadlineDays} days) must be at least as long as your longest payment interval (${longest} days).`);
    }
  }

  private termsFrom(p: any): Terms {
    return {
      price:                  toNaira(p.price),
      allowedFrequencies:     p.allowedFrequencies,
      customIntervalDays:     p.customIntervalDays,
      paymentDeadlineDays:    p.paymentDeadlineDays,
      refundThresholdPercent: p.refundThresholdPercent,
    };
  }

  private images(p: any): string[] {
    return (p.images || []).map((id: string) => this.cloudinary.publicImageUrl(id));
  }

  // What the vendor and staff see
  private presentFull(p: any) {
    return {
      id: p.id, referenceNumber: p.referenceNumber, name: p.name, description: p.description,
      category: p.category, price: toNaira(p.price), images: this.images(p), imagePublicIds: p.images,
      totalStock: p.totalStock, reservedCount: p.reservedCount, soldCount: p.soldCount,
      availableStock: this.available(p),
      allowedFrequencies: p.allowedFrequencies,
      customIntervalDays: p.customIntervalDays, paymentDeadlineDays: p.paymentDeadlineDays,
      refundThresholdPercent: p.refundThresholdPercent, payoutMode: p.payoutMode,
      status: p.status, isFlagged: p.isFlagged, createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }

  // What customers see: no stock internals, no payout details
  private presentPublic(p: any) {
    const available = this.available(p);
    const images = this.images(p);
    return {
      vendor: { businessName: p.vendor?.vendorProfile?.businessName || null, isVerified: p.vendor?.vendorProfile?.isVerified ?? false },
      id: p.id, referenceNumber: p.referenceNumber, name: p.name, description: p.description,
      category: p.category, price: toNaira(p.price), images, thumbnail: images[0] || null,
      inStock: available > 0, availableStock: available,
      allowedFrequencies: p.allowedFrequencies,
      customIntervalDays: p.customIntervalDays, paymentDeadlineDays: p.paymentDeadlineDays,
      refundThresholdPercent: p.refundThresholdPercent,
      createdAt: p.createdAt,
    };
  }

  // ══════════════════════════════════════════════════════════
  // VENDOR
  // ══════════════════════════════════════════════════════════

  getImageUploadSignature(vendorId: string) {
    return this.cloudinary.getUploadSignature('PRODUCT_IMAGE', vendorId);
  }

  async createProduct(vendorId: string, dto: CreateProductDto, ip?: string) {
    const terms: Terms = {
      price:                  dto.price,
      allowedFrequencies:     dto.allowedFrequencies,
      customIntervalDays:     dto.customIntervalDays ?? [],
      paymentDeadlineDays:    dto.paymentDeadlineDays,
      refundThresholdPercent: dto.refundThresholdPercent,
    };
    this.validateTerms(terms);

    const max = await this.maxImages();
    if (dto.imagePublicIds.length > max) throw new BadRequestException(`You can add at most ${max} images.`);
    // Confirms each file exists, is a valid image, and sits in THIS vendor's folder
    await Promise.all(dto.imagePublicIds.map(id => this.cloudinary.verifyUploadedAsset('PRODUCT_IMAGE', vendorId, id)));

    const data = {
      vendorId,
      name:                   dto.name.trim(),
      description:            dto.description.trim(),
      category:               dto.category?.trim() || null,
      price:                  toKobo(dto.price),
      images:                 dto.imagePublicIds,
      totalStock:             dto.totalStock,
      minDepositPercent:      0, // no percentage minimum any more (column kept for old rows)
      allowedFrequencies:     terms.allowedFrequencies as any,
      customIntervalDays:     terms.customIntervalDays,
      paymentDeadlineDays:    terms.paymentDeadlineDays,
      refundThresholdPercent: terms.refundThresholdPercent,
      payoutMode:             'ON_FULL_PAYMENT' as any,
      payoutPercent:          null,
      status:                 'ACTIVE' as any,
    };

    // The reference number is random; on the rare collision we just try a new one
    let product: any = null;
    for (let attempt = 0; attempt < 5 && !product; attempt++) {
      try {
        product = await this.prisma.ssProduct.create({ data: { ...data, referenceNumber: generateReferenceNumber() } });
      } catch (err: any) {
        const collision = err?.code === 'P2002' && String(err?.meta?.target || '').includes('referenceNumber');
        if (!collision) throw err;
      }
    }
    if (!product) throw new ConflictException('Could not create a reference number. Please try again.');

    await this.prisma.ssStockLog.create({
      data: { productId: product.id, changedById: vendorId, oldTotal: 0, newTotal: dto.totalStock, reason: 'Initial stock' },
    });
    await this.audit(vendorId, 'SS_PRODUCT_CREATED', product.id, { referenceNumber: product.referenceNumber, price: dto.price, stock: dto.totalStock }, ip);

    return this.presentFull(product);
  }

  async updateProduct(vendorId: string, productId: string, dto: UpdateProductDto, ip?: string) {
    const p = await this.prisma.ssProduct.findFirst({ where: { id: productId, vendorId } });
    if (!p) throw new NotFoundException('Product not found');
    if (p.status === 'ARCHIVED') throw new BadRequestException('This product is archived and cannot be edited.');

    const current = this.termsFrom(p);
    const freq = dto.allowedFrequencies ?? current.allowedFrequencies;
    const merged: Terms = {
      price:                  dto.price ?? current.price,
      allowedFrequencies:     freq,
      // if "custom" was removed and no new days were sent, clear the old custom days
      customIntervalDays:     dto.customIntervalDays ?? (freq.includes('CUSTOM') ? current.customIntervalDays : []),
      paymentDeadlineDays:    dto.paymentDeadlineDays ?? current.paymentDeadlineDays,
      refundThresholdPercent: dto.refundThresholdPercent ?? current.refundThresholdPercent,
    };
    this.validateTerms(merged);

    const data: any = {
      price:                  toKobo(merged.price),
      allowedFrequencies:     merged.allowedFrequencies,
      customIntervalDays:     merged.customIntervalDays,
      paymentDeadlineDays:    merged.paymentDeadlineDays,
      refundThresholdPercent: merged.refundThresholdPercent,
    };
    if (dto.name !== undefined)        data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.category !== undefined)    data.category = dto.category?.trim() || null;

    // Images: the vendor sends the full list they want. Only NEW ones are checked.
    let removedImages: string[] = [];
    if (dto.imagePublicIds) {
      const max = await this.maxImages();
      if (dto.imagePublicIds.length > max) throw new BadRequestException(`You can add at most ${max} images.`);
      const existing: string[] = p.images || [];
      const added = dto.imagePublicIds.filter(id => !existing.includes(id));
      await Promise.all(added.map(id => this.cloudinary.verifyUploadedAsset('PRODUCT_IMAGE', vendorId, id)));
      removedImages = existing.filter(id => !dto.imagePublicIds!.includes(id));
      data.images = dto.imagePublicIds;
    }

    const updated = await this.prisma.ssProduct.update({ where: { id: productId }, data });
    for (const id of removedImages) await this.cloudinary.destroy('PRODUCT_IMAGE', id);

    await this.audit(vendorId, 'SS_PRODUCT_UPDATED', productId, {
      changed: Object.keys(dto),
      price: dto.price !== undefined ? { from: current.price, to: merged.price } : undefined,
    }, ip);
    return this.presentFull(updated);
  }

  async setStock(vendorId: string, productId: string, dto: UpdateStockDto, ip?: string) {
    let result: any = null;

    await this.prisma.executeTransaction(async (tx: any) => {
      const p = await tx.ssProduct.findFirst({ where: { id: productId, vendorId } });
      if (!p) throw new NotFoundException('Product not found');
      if (p.status === 'ARCHIVED') throw new BadRequestException('This product is archived.');

      const floor = p.reservedCount + p.soldCount;
      if (dto.totalStock < floor) {
        throw new BadRequestException(
          `You cannot go below ${floor}: ${p.reservedCount} are held by customers who are still paying and ${p.soldCount} are sold.`,
        );
      }
      if (dto.totalStock === p.totalStock) { result = p; return; }

      // Only succeeds if nobody reserved or sold a unit while we were deciding
      const upd = await tx.ssProduct.updateMany({
        where: { id: productId, vendorId, totalStock: p.totalStock, reservedCount: p.reservedCount, soldCount: p.soldCount },
        data:  { totalStock: dto.totalStock },
      });
      if (upd.count === 0) throw new ConflictException('Stock changed while you were editing. Please try again.');

      const available = dto.totalStock - floor;
      let status = p.status;
      if (available === 0 && p.status === 'ACTIVE') status = 'OUT_OF_STOCK';
      else if (available > 0 && p.status === 'OUT_OF_STOCK' && !p.isFlagged) status = 'ACTIVE';
      if (status !== p.status) await tx.ssProduct.update({ where: { id: productId }, data: { status } });

      await tx.ssStockLog.create({
        data: { productId, changedById: vendorId, oldTotal: p.totalStock, newTotal: dto.totalStock, reason: dto.reason?.trim() || null },
      });
      result = { ...p, totalStock: dto.totalStock, status };
    });

    await this.audit(vendorId, 'SS_STOCK_CHANGED', productId, { newTotal: dto.totalStock, reason: dto.reason || null }, ip);
    return this.presentFull(result);
  }

  async setStatus(vendorId: string, productId: string, dto: SetProductStatusDto, ip?: string) {
    const p = await this.prisma.ssProduct.findFirst({ where: { id: productId, vendorId } });
    if (!p) throw new NotFoundException('Product not found');
    if (p.status === 'ARCHIVED') throw new BadRequestException('An archived product cannot be changed.');

    if (dto.status === 'ACTIVE') {
      if (p.isFlagged) throw new ForbiddenException('Customer support has put this product on hold. Contact support.');
      if (this.available(p) <= 0) throw new BadRequestException('Add stock first, then turn the product on.');
    }

    let updated: any;
    if (dto.status === 'ARCHIVED') {
      // Cannot archive while customers are still paying for it
      const res = await this.prisma.ssProduct.updateMany({
        where: { id: productId, vendorId, reservedCount: 0 }, data: { status: 'ARCHIVED' },
      });
      if (res.count === 0) throw new BadRequestException('Customers are still paying for this product. Pause it instead, and archive it when all plans are finished.');
      updated = await this.prisma.ssProduct.findUnique({ where: { id: productId } });
    } else {
      updated = await this.prisma.ssProduct.update({ where: { id: productId }, data: { status: dto.status } });
    }

    await this.audit(vendorId, 'SS_PRODUCT_STATUS', productId, { from: p.status, to: dto.status }, ip);
    return this.presentFull(updated);
  }

  async listMine(vendorId: string, status?: string, page = 1) {
    const where: any = { vendorId };
    if (status && ['ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'ARCHIVED'].includes(status)) where.status = status;
    else where.status = { not: 'ARCHIVED' };

    const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.ssProduct.count({ where }),
      this.prisma.ssProduct.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE }),
    ]);
    return { total, page: Math.max(1, page), pageSize: PAGE_SIZE, items: rows.map((p: any) => this.presentFull(p)) };
  }

  async getMine(vendorId: string, productId: string) {
    const p = await this.prisma.ssProduct.findFirst({
      where: { id: productId, vendorId },
      include: { stockLogs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!p) throw new NotFoundException('Product not found');
    const { stockLogs, ...rest } = p;
    return { ...this.presentFull(rest), stockHistory: stockLogs.map((l: any) => ({
      oldTotal: l.oldTotal, newTotal: l.newTotal, reason: l.reason, createdAt: l.createdAt,
    })) };
  }

  // ══════════════════════════════════════════════════════════
  // CUSTOMERS: browse
  // ══════════════════════════════════════════════════════════

  async listPublic(q?: string, category?: string, page = 1) {
    const where: any = {
      status: 'ACTIVE',
      vendor: { vendorProfile: { is: { status: 'ACTIVE' } } },
    };
    const term = (q || '').trim();
    if (term) {
      where.OR = [
        { name:        { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        ...(looksLikeReferenceNumber(term) ? [{ referenceNumber: term.toUpperCase() }] : []),
      ];
    }
    if (category?.trim()) where.category = { equals: category.trim(), mode: 'insensitive' };

    const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.ssProduct.count({ where }),
      this.prisma.ssProduct.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE,
        include: { vendor: { select: { vendorProfile: { select: { businessName: true, isVerified: true } } } } },
      }),
    ]);
    return { total, page: Math.max(1, page), pageSize: PAGE_SIZE, items: rows.map((p: any) => this.presentPublic(p)) };
  }

  // idOrReference can be the product id or its SS-2026-123456 number
  async getPublic(idOrReference: string) {
    const key = (idOrReference || '').trim();
    const where: any = {
      status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      vendor: { vendorProfile: { is: { status: 'ACTIVE' } } },
    };
    if (UUID_RE.test(key)) where.id = key;
    else if (looksLikeReferenceNumber(key)) where.referenceNumber = key.toUpperCase();
    else throw new NotFoundException('Product not found');

    const p = await this.prisma.ssProduct.findFirst({
      where,
      include: { vendor: { select: { vendorProfile: { select: { businessName: true, isVerified: true } } } } },
    });
    if (!p) throw new NotFoundException('Product not found');
    return this.presentPublic(p);
  }

  // ══════════════════════════════════════════════════════════
  // CUSTOMER CARE
  // ══════════════════════════════════════════════════════════

  async careSearch(actorId: string, q?: string, page = 1) {
    await this.assertStaff(actorId);
    const where: any = {};
    const term = (q || '').trim();
    if (term) {
      where.OR = [
        ...(looksLikeReferenceNumber(term) ? [{ referenceNumber: term.toUpperCase() }] : []),
        { name: { contains: term, mode: 'insensitive' } },
        { vendor: { vendorProfile: { is: { businessName: { contains: term, mode: 'insensitive' } } } } },
      ];
    }
    const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
    const [total, rows] = await Promise.all([
      this.prisma.ssProduct.count({ where }),
      this.prisma.ssProduct.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: PAGE_SIZE,
        include: { vendor: { select: { id: true, username: true, vendorProfile: { select: { businessName: true, isVerified: true, status: true } } } } },
      }),
    ]);
    return {
      total, page: Math.max(1, page), pageSize: PAGE_SIZE,
      items: rows.map((p: any) => ({
        ...this.presentFull(p),
        vendor: { userId: p.vendor.id, username: p.vendor.username, businessName: p.vendor.vendorProfile?.businessName, status: p.vendor.vendorProfile?.status },
      })),
    };
  }

  async careGetProduct(actorId: string, productId: string) {
    await this.assertStaff(actorId);
    const p = await this.prisma.ssProduct.findUnique({
      where: { id: productId },
      include: {
        vendor: { select: { id: true, username: true, vendorProfile: { select: { businessName: true, isVerified: true, status: true } } } },
        notes: { orderBy: { createdAt: 'asc' } },
        stockLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!p) throw new NotFoundException('Product not found');

    const authorIds = Array.from(new Set(p.notes.map((n: any) => n.authorId))) as string[];
    const authors = authorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, username: true } })
      : [];
    const nameOf = (id: string) => authors.find((a: any) => a.id === id)?.username || 'staff';

    const { notes, stockLogs, vendor, ...rest } = p;
    return {
      ...this.presentFull(rest),
      vendor: { userId: vendor.id, username: vendor.username, businessName: vendor.vendorProfile?.businessName, status: vendor.vendorProfile?.status },
      notes: notes.map((n: any) => ({ id: n.id, text: n.text, author: nameOf(n.authorId), createdAt: n.createdAt })),
      stockHistory: stockLogs.map((l: any) => ({ oldTotal: l.oldTotal, newTotal: l.newTotal, reason: l.reason, createdAt: l.createdAt })),
    };
  }

  async careAddNote(actorId: string, productId: string, text: string, ip?: string) {
    await this.assertStaff(actorId);
    const p = await this.prisma.ssProduct.findUnique({ where: { id: productId }, select: { id: true } });
    if (!p) throw new NotFoundException('Product not found');
    const note = await this.prisma.ssNote.create({ data: { productId, authorId: actorId, text: text.trim() } });
    await this.audit(actorId, 'SS_PRODUCT_NOTE', productId, { noteId: note.id }, ip);
    return { id: note.id, text: note.text, createdAt: note.createdAt };
  }

  // Hold: the product is paused and the vendor cannot turn it back on.
  // Release: the vendor can turn it on again (it stays paused until they do).
  async careFlag(actorId: string, productId: string, dto: FlagProductDto, ip?: string) {
    await this.assertStaff(actorId);
    const p = await this.prisma.ssProduct.findUnique({ where: { id: productId } });
    if (!p) throw new NotFoundException('Product not found');

    await this.prisma.executeTransaction(async (tx: any) => {
      const data: any = { isFlagged: dto.flagged };
      if (dto.flagged && ['ACTIVE', 'OUT_OF_STOCK'].includes(p.status)) data.status = 'PAUSED';
      await tx.ssProduct.update({ where: { id: productId }, data });
      await tx.ssNote.create({
        data: { productId, authorId: actorId, text: `[${dto.flagged ? 'HELD' : 'RELEASED'}] ${dto.reason.trim()}` },
      });
    });

    await this.audit(actorId, dto.flagged ? 'SS_PRODUCT_HELD' : 'SS_PRODUCT_RELEASED', productId, { reason: dto.reason }, ip);
    await this.notify(
      p.vendorId, 'SYSTEM',
      dto.flagged ? 'Product put on hold' : 'Product released',
      dto.flagged
        ? `"${p.name}" (${p.referenceNumber}) was put on hold by customer support: ${dto.reason.trim()}`
        : `"${p.name}" (${p.referenceNumber}) was released. You can turn it back on.`,
      { productId }, true,
    );
    return { message: dto.flagged ? 'Product put on hold.' : 'Product released.' };
  }
}