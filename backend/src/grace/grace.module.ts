// ============================================================
// GRACE PERIOD MODULE — 48h missed contribution handling
// ============================================================

import {
  Module, Injectable, Logger,
} from '@nestjs/common';
import { Cron, CronExpression, ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { KycService } from '../kyc/kyc.module';
import { KycModule } from '../kyc/kyc.module';

@Injectable()
export class GraceService {
  private readonly logger = new Logger('GraceService');

  constructor(
    private readonly prisma:         PrismaService,
    private readonly notifications:  NotificationsService,
    private readonly kycService:     KycService,
  ) {}

  // ── Start grace period when contribution is missed ────────
  async startGracePeriod(groupId: string, userId: string, contributionId: string) {
    const existing = await this.prisma.gracePeriod.findFirst({
      where: { groupId, userId, contributionId, status: 'ACTIVE' },
    });
    if (existing) return existing;

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    const grace = await this.prisma.gracePeriod.create({
      data: { groupId, userId, contributionId, expiresAt, status: 'ACTIVE' },
    });

    // Pause the group
    await this.prisma.group.update({
      where: { id: groupId },
      data:  { status: 'PAUSED' },
    });

    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    const user  = await this.prisma.user.findUnique({ where: { id: userId } });

    // Notify defaulter
    await this.notifications.create({
      userId, type: 'OVERDUE_WARNING',
      title: '⚠️ Missed contribution — 48-hour grace period started',
      body:  `You missed your contribution to ${group?.name}. You have 48 hours to pay or you'll be removed from the group.`,
      data:  { groupId, contributionId, expiresAt: expiresAt.toISOString() },
    }).catch(() => {});

    // Notify all members that group is paused
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, status: 'ACTIVE', NOT: { userId } },
    });
    await Promise.allSettled(members.map(m =>
      this.notifications.create({
        userId: m.userId, type: 'OVERDUE_WARNING',
        title: `${group?.name} temporarily paused`,
        body:  `A member missed their contribution. The group is paused for up to 48 hours while they settle.`,
        data:  { groupId },
      })
    ));

    await this.prisma.auditLog.create({
      data: {
        actorId: 'SYSTEM', action: 'GRACE_PERIOD_STARTED',
        entityType: 'GROUP', entityId: groupId,
        metadata: { userId, contributionId, expiresAt: expiresAt.toISOString() },
      },
    });

    this.logger.log(`Grace period started for user ${userId} in group ${groupId}`);
    return grace;
  }

  // ── Resolve grace period (payment received) ───────────────
  async resolveGracePeriod(groupId: string, userId: string, contributionId: string) {
    const grace = await this.prisma.gracePeriod.findFirst({
      where: { groupId, userId, contributionId, status: 'ACTIVE' },
    });
    if (!grace) return;

    await this.prisma.gracePeriod.update({
      where: { id: grace.id },
      data:  { status: 'RESOLVED', resolvedAt: new Date() },
    });

    // Check if all active grace periods for group are resolved
    const activeGrace = await this.prisma.gracePeriod.count({
      where: { groupId, status: 'ACTIVE' },
    });

    if (activeGrace === 0) {
      await this.prisma.group.update({
        where: { id: groupId },
        data:  { status: 'ACTIVE' },
      });

      const group = await this.prisma.group.findUnique({ where: { id: groupId } });
      const members = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' } });
      await Promise.allSettled(members.map(m =>
        this.notifications.create({
          userId: m.userId, type: 'SYSTEM',
          title: `${group?.name} resumed`,
          body:  'All missed contributions have been settled. The group is now active again.',
          data:  { groupId },
        })
      ));
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: userId, action: 'GRACE_PERIOD_RESOLVED',
        entityType: 'GROUP', entityId: groupId,
        metadata: { contributionId },
      },
    });
  }

  // ── CRON: Check every 30 minutes for expired grace periods ─
  @Cron('*/30 * * * *')
  async processExpiredGracePeriods() {
    this.logger.log('Checking expired grace periods...');

    const expired = await this.prisma.gracePeriod.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      include: {
        // we use raw ids so no relation needed
      },
    });

    for (const grace of expired) {
      try {
        await this.handleExpiredGrace(grace);
      } catch (err) {
        this.logger.error(`Failed to handle expired grace ${grace.id}`, err);
      }
    }
  }

  // ── CRON: Send reminders ───────────────────────────────────
  @Cron('0 * * * *') // every hour
  async sendGraceReminders() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in2h  = new Date(now.getTime() + 2  * 60 * 60 * 1000);

    // 24-hour reminder
    const need24h = await this.prisma.gracePeriod.findMany({
      where: {
        status:           'ACTIVE',
        reminderSent24h:  false,
        expiresAt:        { lte: in24h, gt: now },
      },
    });
    for (const g of need24h) {
      const contrib = await this.prisma.contribution.findUnique({ where: { id: g.contributionId } });
      const group   = await this.prisma.group.findUnique({ where: { id: g.groupId } });
      await this.notifications.create({
        userId: g.userId, type: 'OVERDUE_WARNING',
        title: '⏰ 24 hours remaining — pay your contribution',
        body:  `You have 24 hours left to pay your contribution to ${group?.name} (₦${(Number(contrib?.amount||0)/100).toLocaleString()}) or you will be removed.`,
        data:  { groupId: g.groupId, contributionId: g.contributionId },
      }).catch(() => {});
      await this.prisma.gracePeriod.update({ where: { id: g.id }, data: { reminderSent24h: true } });
    }

    // Final 2-hour warning
    const needFinal = await this.prisma.gracePeriod.findMany({
      where: {
        status:              'ACTIVE',
        reminderSentFinal:   false,
        expiresAt:           { lte: in2h, gt: now },
      },
    });
    for (const g of needFinal) {
      const group = await this.prisma.group.findUnique({ where: { id: g.groupId } });
      await this.notifications.create({
        userId: g.userId, type: 'OVERDUE_WARNING',
        title: '🚨 Final warning — 2 hours to pay',
        body:  `FINAL WARNING: You have less than 2 hours to pay your contribution to ${group?.name} or you will be permanently removed from the group.`,
        data:  { groupId: g.groupId, urgency: 'CRITICAL' },
      }).catch(() => {});
      await this.prisma.gracePeriod.update({ where: { id: g.id }, data: { reminderSentFinal: true } });
    }
  }

  private async handleExpiredGrace(grace: any) {
    this.logger.log(`Grace expired for user ${grace.userId} in group ${grace.groupId}`);

    await this.prisma.gracePeriod.update({
      where: { id: grace.id },
      data:  { status: 'EXPIRED' },
    });

    const group   = await this.prisma.group.findUnique({ where: { id: grace.groupId } });
    const contrib = await this.prisma.contribution.findUnique({ where: { id: grace.contributionId } });

    if (!group || !contrib) return;

    // Remove member
    await this.prisma.groupMember.updateMany({
      where: { groupId: grace.groupId, userId: grace.userId },
      data:  { status: 'REMOVED', removedAt: new Date(), removedReason: 'Missed contribution — 48h grace period expired' },
    });

    // Cancel their pending contributions
    await this.prisma.contribution.updateMany({
      where: { groupId: grace.groupId, userId: grace.userId, status: { in: ['PENDING','OVERDUE'] } },
      data:  { status: 'CANCELLED' },
    });

    // Create debt record
    await this.kycService.createDebt(
      grace.userId,
      grace.groupId,
      BigInt(Number(contrib.amount)),
      10, // 10% late fee
      `Missed contribution in group "${group.name}" — grace period expired`,
    );

    // Decrement trust score (removal penalty)
    await this.prisma.user.update({
      where: { id: grace.userId },
      data:  { reputationScore: { decrement: 50 } },
    });

    // Notify removed member
    await this.notifications.create({
      userId: grace.userId, type: 'SYSTEM',
      title: 'Removed from group',
      body:  `You have been removed from ${group.name} due to a missed contribution. You have an outstanding debt that must be settled before joining other groups.`,
      data:  { groupId: grace.groupId },
    }).catch(() => {});

    // Notify other members
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: grace.groupId, status: 'ACTIVE' },
    });

    await Promise.allSettled(members.map(m =>
      this.notifications.create({
        userId: m.userId, type: 'SYSTEM',
        title: 'Group update',
        body:  `A member was removed from ${group.name} for non-payment. The group will resume shortly.`,
        data:  { groupId: grace.groupId },
      })
    ));

    // Check if there are waitlisted members to promote
    const waitlisted = await this.prisma.groupMember.findFirst({
      where: { groupId: grace.groupId, status: 'WAITLISTED' },
      orderBy: { joinedAt: 'asc' },
    });

    if (waitlisted) {
      await this.prisma.groupMember.update({
        where: { id: waitlisted.id },
        data:  { status: 'ACTIVE', payoutPosition: grace.payoutPosition || 99 },
      });
      await this.notifications.create({
        userId: waitlisted.userId, type: 'GROUP_JOIN_APPROVED',
        title: "You're in! 🎉",
        body:  `A spot opened up in ${group.name} and you've been added from the waitlist.`,
        data:  { groupId: grace.groupId },
      }).catch(() => {});
    }

    // Resume group if no more active grace periods
    const activeGrace = await this.prisma.gracePeriod.count({
      where: { groupId: grace.groupId, status: 'ACTIVE' },
    });

    if (activeGrace === 0) {
      await this.prisma.group.update({
        where: { id: grace.groupId },
        data:  { status: 'ACTIVE' },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: 'SYSTEM', action: 'GRACE_PERIOD_EXPIRED_MEMBER_REMOVED',
        entityType: 'GROUP', entityId: grace.groupId,
        metadata: { userId: grace.userId, contributionId: grace.contributionId, debtCreated: true },
      },
    });
  }
}

@Module({
  imports: [PrismaModule, NotificationsModule, KycModule, ScheduleModule.forRoot()],
  providers: [GraceService],
  exports: [GraceService],
})
export class GraceModule {}