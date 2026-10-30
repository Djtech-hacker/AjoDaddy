// ============================================================
// VENDORS SERVICE — apply, upload documents, review, approve, suspend
// ============================================================
//
// Who can do what:
//   Any logged-in user ........ apply, upload documents, submit
//   CUSTOMER_SERVICE .......... review documents, add notes, recommend, ask for more info
//   ADMIN / SUPER_ADMIN ....... everything above + final approve/reject + suspend/reinstate
//   (if PlatformSetting.ssRequireAdminApproval is turned OFF, customer service
//    can give the final decision too)
//
// A user is a vendor when they have an ACTIVE VendorProfile. UserRole is not changed.

import {
  Injectable, BadRequestException, ConflictException, ForbiddenException,
  NotFoundException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { VendorKycService } from './vendor-kyc.service';
import {
  SaveApplicationDto, AddDocumentDto, SubmitApplicationDto, ReviewDocumentDto,
  RecommendDto, DecisionDto,
} from './dto/vendor.dto';

const STAFF_ROLES = ['CUSTOMER_SERVICE', 'ADMIN', 'SUPER_ADMIN'];
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

// An applicant can only edit while the application is in one of these states
const EDITABLE = ['DRAFT', 'NEEDS_MORE_INFO'];

// Limits per document type
const MAX_DOCS: Record<string, number> = { CAC: 2, SOCIAL_PROOF: 3, SALES_PROOF: 6 };
const MIN_DOCS: Record<string, number> = { CAC: 1, SOCIAL_PROOF: 1, SALES_PROOF: 2 };

// Only real business pages are accepted as social proof
const SOCIAL_HOSTS = [
  'instagram.com', 'facebook.com', 'fb.com', 'tiktok.com', 'x.com',
  'twitter.com', 'linkedin.com', 'youtube.com', 'wa.me', 'whatsapp.com',
];

@Injectable()
export class VendorsService {
  private readonly logger = new Logger('VendorsService');

  constructor(
    private readonly prisma:         PrismaService,
    private readonly notifications:  NotificationsService,
    private readonly cloudinary:     CloudinaryService,
    private readonly vendorKyc:      VendorKycService,
  ) {}

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  private async settings() {
    const s: any = await this.prisma.platformSetting.findFirst();
    return {
      requireAdminApproval: s?.ssRequireAdminApproval ?? true,
      reapplyAfterDays:     s?.ssReapplyAfterDays ?? 14,
    };
  }

  private async assertStaff(actorId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId }, select: { id: true, role: true, username: true },
    });
    if (!actor || !STAFF_ROLES.includes(actor.role)) throw new ForbiddenException('Staff access required');
    return actor;
  }

  private async assertAdmin(actorId: string) {
    const actor = await this.assertStaff(actorId);
    if (!ADMIN_ROLES.includes(actor.role)) throw new ForbiddenException('Admin access required');
    return actor;
  }

  // Notifications are best-effort: a notification problem must never break the action.
  // `priority` is a column on Notification. If your NotificationsService.create()
  // does not pass it through yet, it falls back to the default (NORMAL).
  private async notify(userId: string, type: string, title: string, body: string, data: any = {}, important = false) {
    try {
      const payload: any = { userId, type, title, body, data };
      if (important) payload.priority = 'IMPORTANT';
      await this.notifications.create(payload);
    } catch (err: any) {
      this.logger.warn(`Notification failed (${type}): ${err?.message}`);
    }
  }

  private async notifyStaff(type: string, title: string, body: string, data: any, important: boolean) {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: STAFF_ROLES as any }, status: 'ACTIVE' },
      select: { id: true },
      take: 100,
    });
    await Promise.allSettled(staff.map(s => this.notify(s.id, type, title, body, data, important)));
  }

  private async audit(actorId: string | null, action: string, entityId: string, metadata: any, ipAddress?: string) {
    await this.prisma.auditLog.create({
      data: { actorId, action, entityType: 'VENDOR_APPLICATION', entityId, metadata, ipAddress },
    });
  }

  private normalizeCac(raw: string): string {
    const v = raw.toUpperCase().replace(/[\s-]/g, '');
    return /^\d+$/.test(v) ? `RC${v}` : v;
  }

  private checkSocialLinks(links: string[]): string[] {
    const clean: string[] = [];
    for (const l of links) {
      let host = '';
      try { host = new URL(l).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* handled below */ }
      if (!host || !SOCIAL_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
        throw new BadRequestException(`"${l}" is not a supported social media link. Use Instagram, Facebook, TikTok, X, LinkedIn, YouTube or WhatsApp.`);
      }
      if (!clean.includes(l)) clean.push(l);
    }
    return clean;
  }

  private async getOwnEditableApplication(userId: string, applicationId: string) {
    const app = await this.prisma.vendorApplication.findFirst({ where: { id: applicationId, userId } });
    if (!app) throw new NotFoundException('Application not found');
    if (!EDITABLE.includes(app.status)) {
      throw new BadRequestException('This application can no longer be edited.');
    }
    return app;
  }

  // ══════════════════════════════════════════════════════════
  // APPLICANT SIDE
  // ══════════════════════════════════════════════════════════

  async getMine(userId: string) {
    const profile = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    const application = await this.prisma.vendorApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: {
          select: { id: true, type: true, status: true, reviewerNote: true, fileName: true, mimeType: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    const kyc = await this.vendorKyc.check(userId, application?.bankAccountId);
    return {
      isVendor: !!profile && profile.status === 'ACTIVE',
      profile,
      application,
      // tells the screen whether to send the user to the identity steps first
      kyc: { identityComplete: kyc.identityComplete, flag: kyc.flag, verifiedName: kyc.verifiedName },
    };
  }

  async saveApplication(userId: string, dto: SaveApplicationDto, ip?: string) {
    const profile = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (profile) throw new ConflictException('You are already a vendor.');

    const latest = await this.prisma.vendorApplication.findFirst({
      where: { userId }, orderBy: { createdAt: 'desc' },
    });
    if (latest && ['SUBMITTED', 'UNDER_REVIEW'].includes(latest.status)) {
      throw new ConflictException('Your application is already being reviewed.');
    }
    if (latest?.status === 'REJECTED' && latest.reapplyAfter && latest.reapplyAfter > new Date()) {
      throw new ForbiddenException(`You can apply again after ${latest.reapplyAfter.toISOString().slice(0, 10)}.`);
    }

    const bank = await this.prisma.bankAccount.findFirst({ where: { id: dto.bankAccountId, userId } });
    if (!bank) throw new BadRequestException('Choose one of your saved bank accounts as the payout account.');

    const cacNumber   = this.normalizeCac(dto.cacNumber);
    const socialLinks = this.checkSocialLinks(dto.socialLinks);

    // One CAC number, one vendor
    const cacTaken = await this.prisma.vendorProfile.findFirst({ where: { cacNumber, NOT: { userId } } });
    const cacPending = await this.prisma.vendorApplication.findFirst({
      where: { cacNumber, NOT: { userId }, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] } },
    });
    if (cacTaken || cacPending) throw new ConflictException('This CAC number is already used by another vendor.');

    const data = {
      businessName: dto.businessName.trim(),
      category:     dto.category.trim(),
      description:  dto.description?.trim() || null,
      phone:        dto.phone || null,
      address:      dto.address?.trim() || null,
      cacNumber,
      socialLinks,
      bankAccountId: dto.bankAccountId,
    };

    let application;
    if (latest && EDITABLE.includes(latest.status)) {
      application = await this.prisma.vendorApplication.update({ where: { id: latest.id }, data });
    } else {
      application = await this.prisma.vendorApplication.create({ data: { userId, status: 'DRAFT', ...data } });
      await this.audit(userId, 'VENDOR_APPLICATION_STARTED', application.id, { userId }, ip);
    }
    return application;
  }

  async getDocUploadSignature(userId: string) {
    // Only people with an open application can upload, so the endpoint can't be abused
    const app = await this.prisma.vendorApplication.findFirst({
      where: { userId, status: { in: EDITABLE as any } },
    });
    if (!app) throw new BadRequestException('Save your business details first, then upload your documents.');
    return this.cloudinary.getUploadSignature('VENDOR_DOC', userId);
  }

  async addDocument(userId: string, applicationId: string, dto: AddDocumentDto, ip?: string) {
    await this.getOwnEditableApplication(userId, applicationId);

    const count = await this.prisma.vendorDocument.count({ where: { applicationId, type: dto.type } });
    if (count >= MAX_DOCS[dto.type]) {
      throw new BadRequestException(`You can upload at most ${MAX_DOCS[dto.type]} files for this document type.`);
    }

    const existing = await this.prisma.vendorDocument.findFirst({ where: { cloudinaryPublicId: dto.cloudinaryPublicId } });
    if (existing) throw new ConflictException('This file was already added.');

    // Confirms the file exists, is in THIS user's private folder, and is a valid size/format
    const asset = await this.cloudinary.verifyUploadedAsset('VENDOR_DOC', userId, dto.cloudinaryPublicId);

    const doc = await this.prisma.vendorDocument.create({
      data: {
        applicationId,
        type:               dto.type,
        cloudinaryPublicId: dto.cloudinaryPublicId,
        fileName:           dto.fileName || null,
        mimeType:           asset.mimeType,
        sizeBytes:          asset.bytes,
        status:             'PENDING',
      },
      select: { id: true, type: true, status: true, fileName: true, mimeType: true, createdAt: true },
    });

    await this.audit(userId, 'VENDOR_DOCUMENT_UPLOADED', applicationId, { documentId: doc.id, type: dto.type, bytes: asset.bytes }, ip);
    return doc;
  }

  async removeDocument(userId: string, applicationId: string, documentId: string, ip?: string) {
    await this.getOwnEditableApplication(userId, applicationId);
    const doc = await this.prisma.vendorDocument.findFirst({ where: { id: documentId, applicationId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.status === 'VERIFIED') throw new BadRequestException('A verified document cannot be removed.');

    await this.prisma.vendorDocument.delete({ where: { id: documentId } });
    if (doc.cloudinaryPublicId) await this.cloudinary.destroy('VENDOR_DOC', doc.cloudinaryPublicId);

    await this.audit(userId, 'VENDOR_DOCUMENT_REMOVED', applicationId, { documentId, type: doc.type }, ip);
    return { message: 'Document removed' };
  }

  async submit(userId: string, applicationId: string, dto: SubmitApplicationDto, ip?: string) {
    const app = await this.getOwnEditableApplication(userId, applicationId);
    const docs = await this.prisma.vendorDocument.findMany({ where: { applicationId } });

    // 1) Everything required is present
    if (!app.cacNumber || !app.bankAccountId || app.socialLinks.length < 1) {
      throw new BadRequestException('Please complete your business details first.');
    }
    for (const type of Object.keys(MIN_DOCS)) {
      const n = docs.filter(d => d.type === type).length;
      if (n < MIN_DOCS[type]) {
        const label = type === 'CAC' ? 'your CAC certificate'
          : type === 'SOCIAL_PROOF' ? 'a screenshot of your business social media page'
          : `${MIN_DOCS[type]} screenshots of successful sales`;
        throw new BadRequestException(`Please upload ${label}.`);
      }
    }
    if (docs.some(d => d.status === 'REJECTED')) {
      throw new BadRequestException('Replace the rejected documents before submitting again.');
    }

    // 2) Identity (existing NIN + BVN + face scan) must already be complete
    const kyc = await this.vendorKyc.check(userId, app.bankAccountId);
    if (!kyc.identityComplete) {
      throw new BadRequestException('Complete your identity verification (NIN, BVN and face scan) before applying to be a vendor.');
    }
    if (!kyc.bankFound) {
      throw new BadRequestException('Your payout bank account was not found. Choose a saved bank account.');
    }

    // 3) Save the result and send it to the review queue.
    //    A name mismatch does NOT block: it is flagged so a person looks at it.
    const updated = await this.prisma.vendorApplication.update({
      where: { id: applicationId },
      data: {
        status:            'SUBMITTED',
        submittedAt:       new Date(),
        acceptedTermsAt:   new Date(),
        kycVerifiedName:   kyc.verifiedName,
        kycFaceScannedAt:  kyc.faceScannedAt,
        kycNameMatched:    kyc.nameMatched,
        payoutNameMatched: kyc.payoutNameMatched,
        kycFlag:           kyc.mismatch ? 'KYC_MISMATCH' : null,
        kycCheckedAt:      new Date(),
        recommendation:    null,
        recommendedById:   null,
        recommendedAt:     null,
        infoRequestedNote: null,
        rejectionReason:   null,
      },
    });

    await this.audit(userId, 'VENDOR_KYC_CHECK', applicationId, this.vendorKyc.auditSnapshot(kyc), ip);
    await this.audit(userId, 'VENDOR_APPLICATION_SUBMITTED', applicationId, { businessName: app.businessName, cacNumber: app.cacNumber }, ip);

    await this.notify(userId, 'VENDOR_APPLICATION_UPDATE', 'Application received',
      'We got your vendor application. We will review it and notify you.', { applicationId }, false);
    await this.notifyStaff('VENDOR_APPLICATION_SUBMITTED', 'New vendor application',
      `${app.businessName} applied to become a vendor.`, { applicationId }, true);
    if (kyc.mismatch) {
      await this.notifyStaff('VENDOR_KYC_MISMATCH', 'Vendor name check flagged',
        `${app.businessName}: the account, identity or bank account names do not match.`, { applicationId }, true);
    }

    return { message: 'Application submitted for review.', status: updated.status, flagged: kyc.mismatch };
  }

  // ══════════════════════════════════════════════════════════
  // STAFF SIDE: QUEUE AND DETAIL
  // ══════════════════════════════════════════════════════════

  async listApplications(actorId: string, status?: string, page = 1) {
    await this.assertStaff(actorId);
    const allowed = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED'];
    const statuses = status && allowed.includes(status) ? [status] : ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO'];
    const take = 20;
    const skip = (Math.max(1, page) - 1) * take;

    const where: any = { status: { in: statuses } };
    const [total, rows] = await Promise.all([
      this.prisma.vendorApplication.count({ where }),
      this.prisma.vendorApplication.findMany({
        where, orderBy: { submittedAt: 'asc' }, skip, take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, username: true, email: true } },
          _count: { select: { documents: true } },
        },
      }),
    ]);

    return {
      total, page: Math.max(1, page), pageSize: take,
      items: rows.map(a => ({
        id: a.id, status: a.status, businessName: a.businessName, category: a.category,
        kycFlag: a.kycFlag, recommendation: a.recommendation, submittedAt: a.submittedAt,
        documentCount: a._count.documents, applicant: a.user,
      })),
    };
  }

  async getApplicationDetail(actorId: string, applicationId: string) {
    await this.assertStaff(actorId);
    const app = await this.prisma.vendorApplication.findUnique({
      where: { id: applicationId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, phone: true } },
        documents: {
          select: { id: true, type: true, status: true, reviewerNote: true, fileName: true, mimeType: true, sizeBytes: true, reviewedById: true, reviewedAt: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        notes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!app) throw new NotFoundException('Application not found');

    // Identity summary: masked numbers only. The face photo is never returned here.
    const identity = await this.prisma.identityRecord.findUnique({
      where: { userId: app.userId },
      select: { status: true, ninMasked: true, bvnMasked: true, firstName: true, lastName: true, faceScannedAt: true, identityMatched: true },
    });
    const bank = app.bankAccountId
      ? await this.prisma.bankAccount.findFirst({
          where: { id: app.bankAccountId, userId: app.userId },
          select: { bankName: true, accountName: true, accountLast4: true },
        })
      : null;

    const authorIds = Array.from(new Set(app.notes.map(n => n.authorId)));
    const authors = authorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, username: true } })
      : [];
    const nameOf = (id: string) => authors.find(a => a.id === id)?.username || 'staff';

    const { notes, ...rest } = app;
    return {
      ...rest,
      identity,
      payoutAccount: bank,
      notes: notes.map(n => ({ id: n.id, text: n.text, author: nameOf(n.authorId), createdAt: n.createdAt })),
    };
  }

  async startReview(actorId: string, applicationId: string, ip?: string) {
    await this.assertStaff(actorId);
    const res = await this.prisma.vendorApplication.updateMany({
      where: { id: applicationId, status: 'SUBMITTED' },
      data:  { status: 'UNDER_REVIEW' },
    });
    if (res.count > 0) await this.audit(actorId, 'VENDOR_REVIEW_STARTED', applicationId, {}, ip);
    return { message: 'Review started' };
  }

  // Staff open a private document: the backend downloads it and sends it on.
  async getDocumentFile(actorId: string, documentId: string, ip?: string) {
    await this.assertStaff(actorId);
    const doc = await this.prisma.vendorDocument.findUnique({ where: { id: documentId } });
    if (!doc || !doc.cloudinaryPublicId) throw new NotFoundException('Document not found');

    const url = this.cloudinary.signedPrivateUrl(doc.cloudinaryPublicId, doc.mimeType);
    const res = await fetch(url);
    if (!res.ok) throw new NotFoundException('The file could not be loaded.');
    const buffer = Buffer.from(await res.arrayBuffer());

    await this.audit(actorId, 'VENDOR_DOCUMENT_VIEWED', doc.applicationId, { documentId, type: doc.type }, ip);
    return { buffer, contentType: doc.mimeType || res.headers.get('content-type') || 'application/octet-stream' };
  }

  async reviewDocument(actorId: string, documentId: string, dto: ReviewDocumentDto, ip?: string) {
    await this.assertStaff(actorId);
    if (dto.status === 'REJECTED' && !dto.note?.trim()) {
      throw new BadRequestException('Tell the applicant why this document was rejected.');
    }
    const doc = await this.prisma.vendorDocument.findUnique({
      where: { id: documentId }, include: { application: { select: { id: true, status: true, userId: true } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(doc.application.status)) {
      throw new BadRequestException('This application is not open for review.');
    }

    await this.prisma.vendorDocument.update({
      where: { id: documentId },
      data: { status: dto.status, reviewerNote: dto.note?.trim() || null, reviewedById: actorId, reviewedAt: new Date() },
    });
    await this.audit(actorId, dto.status === 'VERIFIED' ? 'VENDOR_DOCUMENT_VERIFIED' : 'VENDOR_DOCUMENT_REJECTED',
      doc.applicationId, { documentId, type: doc.type, note: dto.note || null }, ip);
    return { message: `Document ${dto.status.toLowerCase()}` };
  }

  async addNote(actorId: string, applicationId: string, text: string, ip?: string) {
    await this.assertStaff(actorId);
    const app = await this.prisma.vendorApplication.findUnique({ where: { id: applicationId }, select: { id: true } });
    if (!app) throw new NotFoundException('Application not found');
    const note = await this.prisma.applicationNote.create({ data: { applicationId, authorId: actorId, text: text.trim() } });
    await this.audit(actorId, 'VENDOR_APPLICATION_NOTE', applicationId, { noteId: note.id }, ip);
    return { id: note.id, text: note.text, createdAt: note.createdAt };
  }

  async recommend(actorId: string, applicationId: string, dto: RecommendDto, ip?: string) {
    await this.assertStaff(actorId);
    const res = await this.prisma.vendorApplication.updateMany({
      where: { id: applicationId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      data: { recommendation: dto.recommendation, recommendedById: actorId, recommendedAt: new Date(), status: 'UNDER_REVIEW' },
    });
    if (res.count === 0) throw new BadRequestException('This application is not open for review.');
    if (dto.note?.trim()) {
      await this.prisma.applicationNote.create({ data: { applicationId, authorId: actorId, text: `[${dto.recommendation}] ${dto.note.trim()}` } });
    }
    await this.audit(actorId, 'VENDOR_APPLICATION_RECOMMENDED', applicationId, { recommendation: dto.recommendation }, ip);
    await this.notifyStaff('VENDOR_APPLICATION_UPDATE', 'Vendor application recommendation',
      `A reviewer marked an application: ${dto.recommendation}.`, { applicationId }, false);
    return { message: 'Recommendation saved' };
  }

  // ══════════════════════════════════════════════════════════
  // STAFF SIDE: THE DECISION
  // ══════════════════════════════════════════════════════════

  async decide(actorId: string, applicationId: string, dto: DecisionDto, ip?: string) {
    const actor = await this.assertStaff(actorId);
    const cfg = await this.settings();

    const app = await this.prisma.vendorApplication.findUnique({
      where: { id: applicationId }, include: { documents: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.userId === actorId) throw new ForbiddenException('You cannot review your own application.');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(app.status)) {
      throw new BadRequestException('This application is not waiting for a decision.');
    }

    const isAdmin = ADMIN_ROLES.includes(actor.role);
    if ((dto.decision === 'APPROVE' || dto.decision === 'REJECT') && cfg.requireAdminApproval && !isAdmin) {
      throw new ForbiddenException('Only an admin can give the final decision. Please add a recommendation instead.');
    }

    if (dto.decision === 'NEEDS_MORE_INFO') return this.requestMoreInfo(actor.id, app, dto, ip);
    if (dto.decision === 'REJECT')          return this.reject(actor.id, app, dto, cfg.reapplyAfterDays, ip);
    return this.approve(actor, app, dto, ip);
  }

  private async requestMoreInfo(actorId: string, app: any, dto: DecisionDto, ip?: string) {
    if (!dto.reason?.trim()) throw new BadRequestException('Tell the applicant what is missing.');
    const res = await this.prisma.vendorApplication.updateMany({
      where: { id: app.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      data: { status: 'NEEDS_MORE_INFO', infoRequestedNote: dto.reason.trim(), reviewedById: actorId, reviewedAt: new Date() },
    });
    if (res.count === 0) throw new ConflictException('This application was just decided by someone else.');

    await this.audit(actorId, 'VENDOR_INFO_REQUESTED', app.id, { reason: dto.reason }, ip);
    await this.notify(app.userId, 'VENDOR_APPLICATION_UPDATE', 'More information needed',
      dto.reason.trim(), { applicationId: app.id }, true);
    return { message: 'Applicant asked for more information.' };
  }

  private async reject(actorId: string, app: any, dto: DecisionDto, reapplyDays: number, ip?: string) {
    if (!dto.reason?.trim()) throw new BadRequestException('A reason is required to reject an application.');
    const reapplyAfter = new Date(Date.now() + reapplyDays * 24 * 60 * 60 * 1000);
    const res = await this.prisma.vendorApplication.updateMany({
      where: { id: app.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      data: { status: 'REJECTED', rejectionReason: dto.reason.trim(), reviewedById: actorId, reviewedAt: new Date(), reapplyAfter },
    });
    if (res.count === 0) throw new ConflictException('This application was just decided by someone else.');

    await this.audit(actorId, 'VENDOR_REJECTED', app.id, { reason: dto.reason, reapplyAfter }, ip);
    await this.notify(app.userId, 'VENDOR_REJECTED', 'Vendor application rejected',
      `${dto.reason.trim()}. You can apply again after ${reapplyAfter.toISOString().slice(0, 10)}.`, { applicationId: app.id }, true);
    return { message: 'Application rejected.' };
  }

  private async approve(actor: { id: string; role: string }, app: any, dto: DecisionDto, ip?: string) {
    // 1) Every document verified (and none rejected)
    const docs: any[] = app.documents;
    for (const type of Object.keys(MIN_DOCS)) {
      const verified = docs.filter(d => d.type === type && d.status === 'VERIFIED').length;
      if (verified < MIN_DOCS[type]) {
        throw new BadRequestException(`Verify at least ${MIN_DOCS[type]} ${type.replace('_', ' ').toLowerCase()} document(s) before approving.`);
      }
    }
    if (docs.some(d => d.status !== 'VERIFIED')) {
      throw new BadRequestException('Every uploaded document must be verified (or removed) before approving.');
    }

    // 2) Re-check identity and names NOW (the user could have been rejected or changed things since they applied)
    const kyc = await this.vendorKyc.check(app.userId, app.bankAccountId);
    if (!kyc.identityComplete) {
      throw new BadRequestException('The applicant\'s identity verification is no longer complete.');
    }
    if (!kyc.bankFound) {
      throw new BadRequestException('The applicant\'s payout bank account no longer exists.');
    }
    const flagged = kyc.mismatch || !!app.kycFlag;
    if (flagged) {
      const isAdmin = ADMIN_ROLES.includes(actor.role);
      if (!(isAdmin && dto.overrideKycFlag === true && dto.reason?.trim())) {
        throw new BadRequestException('The name check was flagged. Only an admin can approve this, with the override turned on and a written reason.');
      }
    }

    const existingProfile = await this.prisma.vendorProfile.findUnique({ where: { userId: app.userId } });
    if (existingProfile) throw new ConflictException('This user is already a vendor.');

    // 3) Approve in ONE transaction. The status update claims the application,
    //    so two staff members approving at the same moment cannot both win.
    let claimed = false;
    await this.prisma.executeTransaction(async (tx: any) => {
      const res = await tx.vendorApplication.updateMany({
        where: { id: app.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: null, infoRequestedNote: null },
      });
      if (res.count === 0) return; // someone else decided first
      claimed = true;

      await tx.vendorProfile.create({
        data: {
          userId:        app.userId,
          applicationId: app.id,
          businessName:  app.businessName,
          category:      app.category,
          description:   app.description,
          phone:         app.phone,
          address:       app.address,
          cacNumber:     app.cacNumber,
          socialLinks:   app.socialLinks,
          verifiedName:  kyc.verifiedName as string,
          status:        'ACTIVE',
          approvedById:  actor.id,
          approvedAt:    new Date(),
        },
      });

      // The audit entry registers the verified name and a reference to the face scan
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: 'VENDOR_APPROVED', entityType: 'VENDOR_APPLICATION', entityId: app.id, ipAddress: ip,
          metadata: {
            applicantUserId: app.userId,
            businessName:    app.businessName,
            cacNumber:       app.cacNumber,
            ...this.vendorKyc.auditSnapshot(kyc),
            kycOverride:     flagged ? { by: actor.id, reason: dto.reason } : null,
            documentIds:     docs.map(d => d.id),
          },
        },
      });
    });
    if (!claimed) throw new ConflictException('This application was just decided by someone else.');

    await this.notify(app.userId, 'VENDOR_APPROVED', 'You are now a vendor 🎉',
      'Your vendor application was approved. You can now post products on Pay Small Small.', { applicationId: app.id }, true);
    return { message: 'Vendor approved.' };
  }

  // ══════════════════════════════════════════════════════════
  // ADMIN: VENDOR ACCOUNTS
  // ══════════════════════════════════════════════════════════

  async listVendors(actorId: string, status?: string) {
    await this.assertStaff(actorId);
    const where: any = status === 'ACTIVE' || status === 'SUSPENDED' ? { status } : {};
    const rows = await this.prisma.vendorProfile.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true, email: true } } },
    });
    return rows.map(v => ({
      userId: v.userId, businessName: v.businessName, verifiedName: v.verifiedName, status: v.status,
            cacNumber: v.cacNumber, isVerified: v.isVerified, approvedAt: v.approvedAt, suspendedAt: v.suspendedAt, suspendedReason: v.suspendedReason,
      user: v.user,
    }));
  }

  async suspendVendor(actorId: string, vendorUserId: string, reason: string, ip?: string) {
    await this.assertAdmin(actorId);
    const profile = await this.prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
    if (!profile) throw new NotFoundException('Vendor not found');
    if (profile.status === 'SUSPENDED') throw new BadRequestException('This vendor is already suspended.');

    let pausedProducts = 0;
    await this.prisma.executeTransaction(async (tx: any) => {
      await tx.vendorProfile.update({
        where: { userId: vendorUserId },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedById: actorId, suspendedReason: reason },
      });
      // No new orders: pause every active product. Existing orders and escrow keep running.
      const paused = await tx.ssProduct.updateMany({
        where: { vendorId: vendorUserId, status: 'ACTIVE' }, data: { status: 'PAUSED' },
      });
      pausedProducts = paused.count;
      await tx.auditLog.create({
        data: {
          actorId, action: 'VENDOR_SUSPENDED', entityType: 'USER', entityId: vendorUserId, ipAddress: ip,
          metadata: { reason, pausedProducts },
        },
      });
    });

    await this.notify(vendorUserId, 'VENDOR_SUSPENDED', 'Vendor account suspended',
      `Your vendor account was suspended: ${reason}. Existing customer plans continue, but you cannot take new orders.`, {}, true);
    return { message: 'Vendor suspended.', pausedProducts };
  }

  async reinstateVendor(actorId: string, vendorUserId: string, ip?: string) {
    await this.assertAdmin(actorId);
    const profile = await this.prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
    if (!profile) throw new NotFoundException('Vendor not found');
    if (profile.status !== 'SUSPENDED') throw new BadRequestException('This vendor is not suspended.');

    await this.prisma.vendorProfile.update({
      where: { userId: vendorUserId },
      data: { status: 'ACTIVE', suspendedAt: null, suspendedById: null, suspendedReason: null },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'VENDOR_REINSTATED', entityType: 'USER', entityId: vendorUserId, ipAddress: ip, metadata: {} },
    });
    await this.notify(vendorUserId, 'VENDOR_REINSTATED', 'Vendor account reinstated',
      'Your vendor account is active again. Your products stay paused until you turn them back on.', {}, true);
    return { message: 'Vendor reinstated. Their products stay paused until they re-enable them.' };
    
  }

  
  // Admin: give or remove the Verified badge. Separate from approving the vendor.
  async setVendorVerified(actorId: string, vendorUserId: string, verified: boolean, ip?: string) {
    await this.assertAdmin(actorId);
    const profile = await this.prisma.vendorProfile.findUnique({ where: { userId: vendorUserId } });
    if (!profile) throw new NotFoundException('Vendor not found');
    if (profile.isVerified === verified) {
      throw new BadRequestException(verified ? 'This vendor already has the badge.' : 'This vendor has no badge to remove.');
    }

    await this.prisma.vendorProfile.update({
      where: { userId: vendorUserId },
      data: { isVerified: verified, verifiedAt: verified ? new Date() : null, verifiedById: verified ? actorId : null },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId, action: verified ? 'VENDOR_BADGE_GIVEN' : 'VENDOR_BADGE_REMOVED',
        entityType: 'USER', entityId: vendorUserId, ipAddress: ip, metadata: {},
      },
    });
    await this.notify(vendorUserId, 'VENDOR_UPDATE',
      verified ? 'You are now a Verified vendor' : 'Verified badge removed',
      verified ? 'Your name now shows a Verified badge on your products.' : 'The Verified badge was removed from your account.',
      {}, true);
    return { message: verified ? 'Verified badge given.' : 'Verified badge removed.' };
  }
}