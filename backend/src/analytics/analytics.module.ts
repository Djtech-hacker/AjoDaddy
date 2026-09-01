// ============================================================
// ANALYTICS MODULE — Real queries, AI-lite insights
// ============================================================

import {
  Module, Controller, Get, Param, Query,
  UseGuards, Req, Injectable,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserSummary(userId: string) {
    const [
      wallet, groups, recentContribs, upcomingPayouts,
      streakData, totalStats,
    ] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.groupMember.findMany({
        where: { userId, status: 'ACTIVE' },
        include: {
          group: {
            select: {
              id: true, name: true, slug: true, contributionAmount: true,
              frequency: true, currentCycle: true, totalCycles: true,
              nextContributionDate: true, status: true,
              _count: { select: { members: { where: { status: 'ACTIVE' } } } },
            },
          },
        },
      }),
      this.prisma.contribution.findMany({
        where:   { userId, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        take:    5,
        include: { group: { select: { name: true, slug: true } } },
      }),
      this.prisma.payout.findMany({
        where:   { recipientId: userId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
        orderBy: { scheduledDate: 'asc' },
        take:    3,
      }),
      this.prisma.user.findUnique({
        where:  { id: userId },
        select: { currentStreak: true, longestStreak: true, reputationScore: true, badges: true },
      }),

      // FIX: was aggregating ALL transaction types — this made "Total Contributed"
      // on the dashboard equal to wallet balance because wallet fundings were included.
      // Now only counts actual CONTRIBUTION transactions (money paid into ajo groups).
      this.prisma.transaction.aggregate({
        where:  { userId, type: 'CONTRIBUTION', status: 'COMPLETED' },
        _sum:   { amount: true },
        _count: true,
      }),
    ]);

    const pendingContribs = await this.prisma.contribution.findMany({
      where:   { userId, status: { in: ['PENDING', 'OVERDUE'] } },
      include: { group: { select: { name: true, slug: true } } },
      orderBy: { dueDate: 'asc' },
    });

    return {
      wallet: {
        balance:          Number(wallet?.balance ?? 0) / 100,
        lockedBalance:    Number(wallet?.lockedBalance ?? 0) / 100,
        availableBalance: (Number(wallet?.balance ?? 0) - Number(wallet?.lockedBalance ?? 0)) / 100,
      },
      groups: groups.map(g => ({
        ...g,
        group: {
          ...g.group,
          contributionAmount: Number(g.group.contributionAmount) / 100,
          memberCount: g.group._count.members,
        },
        totalPaid: Number(g.totalPaid) / 100,
      })),
      recentContributions: recentContribs.map(c => ({
        ...c,
        amount: Number(c.amount) / 100,
      })),
      upcomingPayouts: upcomingPayouts.map(p => ({
        ...p,
        amount: Number(p.amount) / 100,
      })),
      pendingContributions: pendingContribs.map(c => ({
        ...c,
        amount: Number(c.amount) / 100,
      })),
      gamification: {
        currentStreak:   streakData?.currentStreak ?? 0,
        longestStreak:   streakData?.longestStreak ?? 0,
        reputationScore: streakData?.reputationScore ?? 100,
        badgeCount:      streakData?.badges?.length ?? 0,
      },
      totals: {
        // FIX: transactionCount and totalTransacted now reflect only ajo
        // contributions, not wallet fundings or other transaction types.
        transactionCount: totalStats._count,
        totalTransacted:  Number(totalStats._sum.amount ?? 0) / 100,
      },
    };
  }

  // ── Contribution trend chart ──────────────────────────────
  async getContributionTrend(userId: string, groupId?: string, weeks = 12) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7);

    const where: any = {
      userId,
      status:  'PAID',
      paidAt:  { gte: startDate },
    };
    if (groupId) where.groupId = groupId;

    const contributions = await this.prisma.contribution.findMany({
      where,
      select: { paidAt: true, amount: true },
      orderBy: { paidAt: 'asc' },
    });

    // Group by week in JS
    const weekMap = new Map<string, { total: number; count: number }>();
    for (const c of contributions) {
      if (!c.paidAt) continue;
      const d = new Date(c.paidAt);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString();
      const existing = weekMap.get(key) || { total: 0, count: 0 };
      existing.total += Number(c.amount);
      existing.count += 1;
      weekMap.set(key, existing);
    }

    return Array.from(weekMap.entries()).map(([week, data]) => ({
      week,
      total: data.total / 100,
      count: data.count,
    }));
  }

  // ── Platform-wide analytics (admin) ──────────────────────
  async getPlatformStats() {
    const [
      userCount, groupCount, totalContributed, totalPayouts,
      activeGroups, newUsersThisMonth,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.group.count({ where: { status: 'ACTIVE' } }),
      this.prisma.contribution.aggregate({
        where: { status: 'PAID' }, _sum: { amount: true },
      }),
      this.prisma.payout.aggregate({
        where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: true,
      }),
      this.prisma.group.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({
        where: { createdAt: { gte: new Date(new Date().setDate(1)) } },
      }),
    ]);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const transactions = await this.prisma.transaction.findMany({
      where: { status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, amount: true },
      orderBy: { createdAt: 'asc' },
    });

    const dayMap = new Map<string, { volume: number; count: number }>();
    for (const t of transactions) {
      const d = new Date(t.createdAt);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString();
      const existing = dayMap.get(key) || { volume: 0, count: 0 };
      existing.volume += Number(t.amount);
      existing.count += 1;
      dayMap.set(key, existing);
    }

    return {
      users:  { total: userCount, newThisMonth: newUsersThisMonth },
      groups: { total: groupCount, active: activeGroups },
      finance: {
        totalContributed: Number(totalContributed._sum.amount ?? 0) / 100,
        totalPaidOut:     Number(totalPayouts._sum.amount ?? 0) / 100,
        payoutCount:      totalPayouts._count,
      },
      dailyVolume: Array.from(dayMap.entries()).map(([day, data]) => ({
        day,
        volume: data.volume / 100,
        count:  data.count,
      })),
    };
  }

  // ── Smart insights ────────────────────────────────────────
  async getSmartInsights(userId: string) {
    const [contributions, user, groups] = await Promise.all([
      this.prisma.contribution.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: 20,
      }),
      this.prisma.user.findUnique({
        where:  { id: userId },
        select: { currentStreak: true, reputationScore: true, longestStreak: true },
      }),
      this.prisma.groupMember.findMany({
        where:   { userId, status: 'ACTIVE' },
        include: { group: { select: { contributionAmount: true, frequency: true, name: true } } },
      }),
    ]);

    const insights: any[] = [];

    if (user && user.currentStreak >= 3) {
      insights.push({
        type: 'positive', icon: '🔥',
        title:   `${user.currentStreak}-week streak`,
        message: `You're on a ${user.currentStreak}-week contribution streak. Keep it up to earn the next badge!`,
      });
    }

    const overdueCount = contributions.filter(c => c.status === 'OVERDUE').length;
    if (overdueCount > 0) {
      insights.push({
        type: 'warning', icon: '⚠️',
        title:   'Overdue contributions',
        message: `You have ${overdueCount} overdue contribution${overdueCount > 1 ? 's' : ''}. Pay now to protect your reputation score.`,
      });
    }

    const monthlyTotal = groups.reduce((sum, g) => {
      const freq = g.group.frequency;
      const multiplier = { DAILY: 30, WEEKLY: 4, BIWEEKLY: 2, MONTHLY: 1 }[freq] || 1;
      return sum + Number(g.group.contributionAmount) * multiplier;
    }, 0);

    if (monthlyTotal > 0) {
      insights.push({
        type: 'info', icon: '📊',
        title:   'Monthly contribution estimate',
        message: `You're contributing approx. ₦${(monthlyTotal / 100).toLocaleString()} per month across ${groups.length} group${groups.length > 1 ? 's' : ''}.`,
      });
    }

    if (user && user.reputationScore < 70) {
      insights.push({
        type: 'warning', icon: '📉',
        title:   'Reputation at risk',
        message: 'Your reputation score is low due to missed payments. Consistent on-time contributions will restore it.',
      });
    } else if (user && user.reputationScore >= 95) {
      insights.push({
        type: 'positive', icon: '⭐',
        title:   'Excellent reputation',
        message: "You're in the top tier of reliable payers. Groups love members like you!",
      });
    }

    return insights;
  }
}

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get full user dashboard summary' })
  getSummary(@Req() req: any) {
    return this.analyticsService.getUserSummary(req.user.id);
  }

  @Get('contributions/trend')
  @ApiOperation({ summary: 'Get contribution trend data for chart' })
  getTrend(
    @Req() req: any,
    @Query('groupId') groupId?: string,
    @Query('weeks') weeks = 12,
  ) {
    return this.analyticsService.getContributionTrend(req.user.id, groupId, +weeks);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Get AI-lite smart insights for this user' })
  getInsights(@Req() req: any) {
    return this.analyticsService.getSmartInsights(req.user.id);
  }

  @Get('platform')
  @ApiOperation({ summary: 'Platform-wide stats (admin only)' })
  getPlatformStats(@Req() req: any) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return { error: 'Forbidden' };
    }
    return this.analyticsService.getPlatformStats();
  }
}

@Module({
  controllers: [AnalyticsController],
  providers:   [AnalyticsService],
  exports:     [AnalyticsService],
})
export class AnalyticsModule {}