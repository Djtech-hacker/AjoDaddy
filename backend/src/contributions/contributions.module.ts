// ============================================================
// CONTRIBUTIONS MODULE — Real rotational savings engine
// ============================================================

import {
  Module, Controller, Get, Post, Patch, Body, Req,
  Param, Query, UseGuards, Injectable, BadRequestException,
  ForbiddenException, NotFoundException, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.module';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';


// ── DTOs ─────────────────────────────────────────────────────

export class MakeContributionDto {
  @IsString()
  groupId: string;

  @IsOptional()
  @IsString()
  transactionPin?: string;
}

// ── Contributions Service ─────────────────────────────────────

@Injectable()
export class ContributionsService {
  private readonly logger = new Logger(ContributionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Make a contribution ───────────────────────────────────
  async makeContribution(userId: string, dto: MakeContributionDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
      include: { members: { where: { userId, status: 'ACTIVE' } } },
    });
    if (!group)                    throw new NotFoundException('Group not found');
    if (group.status !== 'ACTIVE') throw new BadRequestException('Group is not active');
    if (!group.members.length)     throw new ForbiddenException('You are not a member of this group');

    // Find pending contribution
    const contribution = await this.prisma.contribution.findFirst({
      where: {
        groupId: dto.groupId,
        userId,
        cycleNumber: group.currentCycle,
        status: { in: ['PENDING', 'OVERDUE'] },
      },
    });
    if (!contribution) throw new BadRequestException('No pending contribution found for this cycle');

    const amountKobo = contribution.amount;

    // FIX: only atomic DB writes inside the transaction.
    // Notifications and streak update were the slow calls pushing the
    // transaction past Prisma's 10 s default timeout → "Transaction already
    // closed" error. Moving them outside keeps the transaction fast and tight.
    // timeout raised to 30 s as a safety net for the payout sub-queries.
    const updated = await this.prisma.executeTransaction(async (tx) => {
      // Debit from wallet
      const { transaction } = await this.walletService.debitWallet(
        userId,
        amountKobo,
        'CONTRIBUTION',
        `Contribution to ${group.name} — Cycle ${group.currentCycle}`,
        { groupId: dto.groupId, cycleNumber: group.currentCycle },
        tx,
      );

      // Mark contribution paid
      const updated = await tx.contribution.update({
        where: { id: contribution.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          transactionId: transaction.id,
        },
      });

      // Update member total paid
      await tx.groupMember.updateMany({
        where: { groupId: dto.groupId, userId },
        data:  { totalPaid: { increment: amountKobo } },
      });

      // Update user stats
      await tx.user.update({
        where: { id: userId },
        data:  { totalContributed: { increment: amountKobo } },
      });

      // Update group cycle collected amount
      await tx.groupCycle.updateMany({
        where: { groupId: dto.groupId, cycleNumber: group.currentCycle },
        data:  { totalCollected: { increment: amountKobo } },
      });

      // Check if all members paid — trigger payout if so
      const allPaid = await this.checkAllPaid(tx, dto.groupId, group.currentCycle);
      if (allPaid) {
        await this.triggerPayout(tx, dto.groupId, group.currentCycle);
      }

      return updated;

    }, { timeout: 30000, maxWait: 10000 }); // raised from 10 s default

    // ── Side effects OUTSIDE the transaction ─────────────────
    // Payment already succeeded at this point. Using Promise.allSettled
    // so a notification failure never surfaces as a contribution error.
    await Promise.allSettled([
      this.notificationsService.create({
        userId:  group.ownerId,
        type:    'CONTRIBUTION_RECEIVED',
        title:   'Contribution received',
        body:    `A member contributed ₦${Number(amountKobo) / 100} to ${group.name}`,
        data:    { groupId: dto.groupId, amount: Number(amountKobo) / 100 },
      }),
      this.updateStreak(userId),
    ]);

    return {
      success: true,
      contribution: { ...updated, amount: Number(updated.amount) / 100 },
      message: 'Contribution made successfully',
    };
  }

  private async checkAllPaid(tx: any, groupId: string, cycleNumber: number): Promise<boolean> {
    const [total, paid] = await Promise.all([
      tx.groupMember.count({ where: { groupId, status: 'ACTIVE' } }),
      tx.contribution.count({ where: { groupId, cycleNumber, status: 'PAID' } }),
    ]);
    return total > 0 && total === paid;
  }

  private async triggerPayout(tx: any, groupId: string, cycleNumber: number) {
    const group = await tx.group.findUnique({ where: { id: groupId } });
    const member = await tx.groupMember.findFirst({
      where:   { groupId, status: 'ACTIVE', payoutPosition: cycleNumber },
      include: { user: { select: { id: true, firstName: true } } },
    });

    if (!member) {
      this.logger.warn(`No member found at position ${cycleNumber} for group ${groupId}`);
      return;
    }

    const totalMembers = await tx.groupMember.count({ where: { groupId, status: 'ACTIVE' } });
    const payoutAmount = BigInt(Number(group.contributionAmount) * totalMembers);

    await tx.payout.upsert({
      where: { groupId_recipientId_cycleNumber: { groupId, recipientId: member.userId, cycleNumber } },
      create: {
        groupId,
        recipientId:   member.userId,
        cycleNumber,
        amount:        payoutAmount,
        status:        'SCHEDULED',
        scheduledDate: new Date(),
      },
      update: { status: 'SCHEDULED' },
    });

    // Payout notification is lightweight — safe to keep inside tx
    await this.notificationsService.create({
      userId: member.userId,
      type:   'PAYOUT_SCHEDULED',
      title:  '🎉 Your payout is scheduled!',
      body:   `You're receiving ₦${Number(payoutAmount) / 100} from ${group.name}`,
      data:   { groupId, amount: Number(payoutAmount) / 100 },
    });
  }

  // ── Advance to next cycle ─────────────────────────────────
  async advanceCycle(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { members: { where: { status: 'ACTIVE' }, orderBy: { payoutPosition: 'asc' } } },
    });

    if (group.currentCycle >= group.totalCycles) {
      await this.prisma.group.update({
        where: { id: groupId },
        data:  { status: 'COMPLETED', completedAt: new Date() },
      });
      return;
    }

    const nextCycle    = group.currentCycle + 1;
    const cycleDuration = group.cycleDurationDays * 24 * 60 * 60 * 1000;

    await this.prisma.executeTransaction(async (tx) => {
      await tx.groupCycle.updateMany({
        where: { groupId, cycleNumber: group.currentCycle },
        data:  { isComplete: true },
      });

      await tx.group.update({
        where: { id: groupId },
        data: {
          currentCycle: nextCycle,
          nextContributionDate: new Date(Date.now() + cycleDuration),
        },
      });

      await tx.groupCycle.create({
        data: {
          groupId,
          cycleNumber: nextCycle,
          startDate:   new Date(),
          endDate:     new Date(Date.now() + cycleDuration),
        },
      });

      const dueDate = new Date(Date.now() + group.deadlineDays * 24 * 60 * 60 * 1000);
      for (const member of group.members) {
        await tx.contribution.create({
          data: {
            groupId,
            userId:      member.userId,
            cycleNumber: nextCycle,
            amount:      group.contributionAmount,
            dueDate,
            status:      'PENDING',
          },
        });
      }
    });

    this.logger.log(`Group ${groupId} advanced to cycle ${nextCycle}`);
  }

  // ── Scheduled: check overdue contributions ────────────────
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkOverdueContributions() {
    this.logger.log('Running overdue contribution check...');

    const overdue = await this.prisma.contribution.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lt: new Date() },
      },
      include: {
        group: { select: { name: true, penaltyAmount: true, ownerId: true } },
        user:  { select: { firstName: true } },
      },
    });

    for (const c of overdue) {
      await this.prisma.executeTransaction(async (tx) => {
        const penalty = c.group.penaltyAmount;

        await tx.contribution.update({
          where: { id: c.id },
          data:  { status: 'OVERDUE', penaltyApplied: penalty },
        });

        await tx.groupMember.updateMany({
          where: { groupId: c.groupId, userId: c.userId },
          data:  { missedCount: { increment: 1 } },
        });

        await tx.user.update({
          where: { id: c.userId },
          data:  { reputationScore: { decrement: 5 } },
        });
      });

      await this.notificationsService.create({
        userId: c.userId,
        type:   'OVERDUE_WARNING',
        title:  '⚠️ Contribution overdue',
        body:   `Your contribution to ${c.group.name} is overdue. Please pay immediately to avoid penalties.`,
        data:   { groupId: c.groupId },
      });
    }

    this.logger.log(`Marked ${overdue.length} contributions as overdue`);
  }

  // ── Scheduled: send reminders 48h before due ─────────────
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendContributionReminders() {
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const now   = new Date();

    const upcoming = await this.prisma.contribution.findMany({
      where: {
        status:  'PENDING',
        dueDate: { gte: now, lte: in48h },
      },
      include: { group: { select: { name: true } } },
    });

    for (const c of upcoming) {
      await this.notificationsService.create({
        userId: c.userId,
        type:   'CONTRIBUTION_DUE',
        title:  '⏰ Contribution due soon',
        body:   `Your ₦${Number(c.amount) / 100} contribution to ${c.group.name} is due in 48 hours`,
        data:   { groupId: c.groupId, amount: Number(c.amount) / 100 },
      });
    }
  }

  // ── Update streak ─────────────────────────────────────────
  private async updateStreak(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true },
    });

    const newStreak = user.currentStreak + 1;
    const longest   = Math.max(newStreak, user.longestStreak);

    await this.prisma.user.update({
      where: { id: userId },
      data:  {
        currentStreak: newStreak,
        longestStreak: longest,
        reputationScore: { increment: 2 },
      },
    });

    if (newStreak === 7)  await this.awardBadge(userId, 'STREAK_7');
    if (newStreak === 30) await this.awardBadge(userId, 'STREAK_30');
    if (newStreak === 90) await this.awardBadge(userId, 'STREAK_90');
  }

  private async awardBadge(userId: string, type: string) {
    try {
      await this.prisma.userBadge.create({ data: { userId, type: type as any } });
      await this.notificationsService.create({
        userId, type: 'SYSTEM',
        title: '🏆 Badge earned!',
        body:  `You earned the ${type.replace('_', ' ')} badge!`,
        data:  { badge: type },
      });
    } catch {} // Ignore duplicate badge errors
  }

  // ── Get contribution history ──────────────────────────────
  async getContributions(userId: string, groupId?: string, page = 1, limit = 20) {
    const skip  = (page - 1) * limit;
    const where: any = { userId };
    if (groupId) where.groupId = groupId;

    const [contributions, total] = await Promise.all([
      this.prisma.contribution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
        include: { group: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.contribution.count({ where }),
    ]);

    return {
      contributions: contributions.map(c => ({
        ...c,
        amount:         Number(c.amount) / 100,
        penaltyApplied: Number(c.penaltyApplied) / 100,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}

// ── Contributions Controller ──────────────────────────────────

@ApiTags('Contributions')
@Controller('contributions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ContributionsController {
  constructor(private readonly contributionsService: ContributionsService) {}

  @Post('pay')
  @ApiOperation({ summary: 'Make a contribution from wallet balance' })
  makeContribution(@Req() req: any, @Body() dto: MakeContributionDto) {
    return this.contributionsService.makeContribution(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get my contribution history' })
  getContributions(
    @Req() req: any,
    @Query('groupId') groupId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.contributionsService.getContributions(req.user.id, groupId, +page, +limit);
  }

  @Post(':groupId/advance-cycle')
  @ApiOperation({ summary: 'Manually advance group to next cycle (admin/testing)' })
  advanceCycle(@Param('groupId') groupId: string) {
    return this.contributionsService.advanceCycle(groupId);
  }
}

@Module({
  imports:     [WalletModule, NotificationsModule],
  controllers: [ContributionsController],
  providers:   [ContributionsService],
  exports:     [ContributionsService],
})
export class ContributionsModule {}