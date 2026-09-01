// ============================================================
// ADMIN MODULE
// ============================================================
// ADDED: getRevenueOverview() + GET /admin/revenue (Super Admin only).
// Reads the SYSTEM wallet (created to fix the audit_logs FK bug) and
// breaks its balance down by source: late penalty fees (walletTransaction,
// type PENALTY, userId SYSTEM) and the 1% platform withdrawal fee
// (transaction, type WALLET_FUNDING, userId SYSTEM). Both are credited to
// this wallet in groups.module.ts / payments.module.ts respectively.
// ============================================================

import {
  Module, Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Req, Res, Injectable,
  ForbiddenException, NotFoundException, BadRequestException,
  CanActivate, ExecutionContext,
} from '@nestjs/common';
import { Response } from 'express';
import * as crypto from 'crypto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsEnum } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';

const SUPER_ADMIN_ONLY_ACTIONS = [
  'BAN_USER', 'UNBAN_USER', 'ROLE_CHANGED', 'BROADCAST_NOTIFICATION',
  'PLATFORM_SETTINGS_UPDATED', 'FORCE_LOGOUT', 'USER_DELETED', 'BALANCE_ADJUSTED',
];

export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new ForbiddenException('Admin access required');
    return true;
  }
}

export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Super admin access required');
    return true;
  }
}

export class SuspendUserDto { @IsString() reason: string; }
export class FlagFraudDto { @IsString() type: string; @IsString() description: string; @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity: string; }
export class UpdateUserRoleDto { @IsEnum(['USER', 'CUSTOMER_SERVICE', 'ADMIN', 'SUPER_ADMIN']) role: string; }
export class FreezeGroupDto { @IsString() reason: string; }
export class CloseGroupDto { @IsString() reason: string; }
export class RefundTransactionDto { @IsString() reason: string; }
export class GroupBroadcastDto { @IsString() title: string; @IsString() body: string; }
export class KycRejectDto { @IsString() reason: string; }

@Injectable()
export class AdminService {
  private readonly encryptKey = (process.env.KYC_ENCRYPT_KEY || 'paypaddy-kyc-key-32-chars-exact!!').slice(0, 32);

  constructor(
    private readonly prisma:               PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private decryptIdentity(text: string): string | null {
    try {
      const [ivHex, encHex] = text.split(':');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptKey), Buffer.from(ivHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString();
    } catch { return null; }
  }

  async getAdminDashboard() {
    const today = new Date();
    const [totalUsers, newUsersToday, suspendedUsers, totalGroups, activeGroups, totalVolume, volumeToday, pendingPayouts, flaggedFraud, recentSignups, recentTransactions] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: new Date(today.setHours(0,0,0,0)) } } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.group.count(),
      this.prisma.group.count({ where: { status: 'ACTIVE' } }),
      this.prisma.transaction.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
      this.prisma.transaction.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: new Date(today.setHours(0,0,0,0)) } }, _sum: { amount: true } }),
      this.prisma.payout.count({ where: { status: 'SCHEDULED' } }),
      this.prisma.fraudFlag.count({ where: { resolved: false } }),
      this.prisma.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, email: true, username: true, firstName: true, status: true, createdAt: true } }),
      this.prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, type: true, amount: true, status: true, createdAt: true, user: { select: { username: true } } } }),
    ]);
    return {
      overview: { users: { total: totalUsers, newToday: newUsersToday, suspended: suspendedUsers }, groups: { total: totalGroups, active: activeGroups }, finance: { totalVolume: Number(totalVolume._sum.amount || 0) / 100, volumeToday: Number(volumeToday._sum.amount || 0) / 100, pendingPayouts }, alerts: { fraudFlags: flaggedFraud } },
      recentSignups,
      recentTransactions: recentTransactions.map(t => ({ ...t, amount: Number(t.amount) / 100 })),
    };
  }

  async getUsers(page = 1, limit = 20, search?: string, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (search) where.OR = [{ email: { contains: search, mode: 'insensitive' } }, { username: { contains: search, mode: 'insensitive' } }, { firstName: { contains: search, mode: 'insensitive' } }];
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, username: true, firstName: true, lastName: true, status: true, role: true, reputationScore: true, isEmailVerified: true, createdAt: true, totalContributed: true, _count: { select: { memberships: true, ownedGroups: true } }, wallet: { select: { balance: true } } } }),
      this.prisma.user.count({ where }),
    ]);
    return { users: users.map(u => ({ ...u, totalContributed: Number(u.totalContributed) / 100, walletBalance: Number(u.wallet?.balance || 0) / 100 })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async suspendUser(adminId: string, userId: string, dto: SuspendUserDto) {
    if (userId === adminId) throw new ForbiddenException('Cannot suspend yourself');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'SUSPEND_USER', entityType: 'User', entityId: userId, metadata: { reason: dto.reason } } });
      await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
    });
    await this.notificationsService.create({ userId, type: 'SYSTEM', title: 'Account suspended', body: `Your account has been suspended. Reason: ${dto.reason}. Contact support@paypaddy.io`, data: { reason: dto.reason } });
    return { message: 'User suspended' };
  }

  async unsuspendUser(adminId: string, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status === 'BANNED') throw new ForbiddenException('This user is permanently banned. Only a super admin can reverse a ban.');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'UNSUSPEND_USER', entityType: 'User', entityId: userId } });
    });
    return { message: 'User reactivated' };
  }

  async banUser(adminId: string, userId: string, reason: string) {
    if (userId === adminId) throw new ForbiddenException('Cannot ban yourself');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'BANNED' } });
      await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'BAN_USER', entityType: 'User', entityId: userId, metadata: { reason } } });
    });
    await this.notificationsService.create({ userId, type: 'SYSTEM', title: 'Account banned', body: `Your account has been permanently banned. Reason: ${reason}`, data: { reason } }).catch(() => {});
    return { message: 'User banned' };
  }

  async unbanUser(adminId: string, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.status !== 'BANNED') throw new BadRequestException('User is not currently banned');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'UNBAN_USER', entityType: 'User', entityId: userId } });
    });
    await this.notificationsService.create({ userId, type: 'SYSTEM', title: 'Account reinstated', body: 'Your account ban has been lifted. You can use PayPaddy again.' }).catch(() => {});
    return { message: 'User unbanned' };
  }

  async softDeleteUser(adminId: string, userId: string, reason: string) {
    if (userId === adminId) throw new ForbiddenException('Cannot delete your own account this way');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.deletedAt) throw new BadRequestException('User already deleted');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { deletedAt: new Date(), status: 'BANNED' } });
      await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
      await tx.session.updateMany({ where: { userId }, data: { isActive: false } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'USER_DELETED', entityType: 'User', entityId: userId, metadata: { reason } } });
    });
    return { message: 'User account deleted' };
  }

  async updateUserRole(adminId: string, userId: string, newRole: string) {
    if (userId === adminId) throw new ForbiddenException('Cannot change your own role');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role: newRole as any } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'ROLE_CHANGED', entityType: 'User', entityId: userId, metadata: { previousRole: target.role, newRole } } });
      await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
    });
    await this.notificationsService.create({ userId, type: 'SYSTEM', title: 'Account role updated', body: `Your account role has been changed to ${newRole}.`, data: { newRole } }).catch(() => {});
    return { message: `Role updated to ${newRole}` };
  }

  async getTransactions(page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (type)   where.type   = type;
    if (search) where.OR = [{ reference: { contains: search, mode: 'insensitive' } }, { user: { email: { contains: search, mode: 'insensitive' } } }, { user: { username: { contains: search, mode: 'insensitive' } } }];
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, email: true } } } }),
      this.prisma.transaction.count({ where }),
    ]);
    return { transactions: transactions.map(t => ({ ...t, amount: Number(t.amount) / 100, fee: Number(t.fee) / 100 })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async exportTransactionsCsv(status?: string, type?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (type)   where.type   = type;
    const transactions = await this.prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000, include: { user: { select: { username: true, email: true } } } });
    const header = 'Date,User,Email,Type,Status,Amount (NGN),Fee (NGN),Reference\n';
    const rows = transactions.map(t => {
      const amount = (Number(t.amount) / 100).toFixed(2);
      const fee    = (Number(t.fee) / 100).toFixed(2);
      return [t.createdAt.toISOString(), t.user?.username || '', t.user?.email || '', t.type, t.status, amount, fee, t.reference].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    }).join('\n');
    return header + rows;
  }

  async refundTransaction(adminId: string, transactionId: string, reason: string) {
    const original = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!original) throw new NotFoundException('Transaction not found');
    if (original.status !== 'COMPLETED') throw new BadRequestException('Only completed transactions can be refunded');
    if (original.type !== 'WALLET_FUNDING') throw new BadRequestException('Only WALLET_FUNDING transactions can be refunded here.');
    const reference = `ADMINREFUND-${original.reference}-${Date.now()}`;
    await this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: original.walletId } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      await tx.wallet.update({ where: { id: original.walletId }, data: { balance: { increment: original.amount } } });
      await tx.transaction.create({ data: { userId: original.userId, walletId: original.walletId, type: 'REFUND', status: 'COMPLETED', amount: original.amount, balanceBefore: wallet.balance, balanceAfter: wallet.balance + original.amount, reference, description: `Admin refund of ${original.reference}: ${reason}`, metadata: { originalTransactionId: original.id, reason, refundedBy: adminId } } });
      await tx.transaction.update({ where: { id: original.id }, data: { status: 'REVERSED' } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'ADMIN_REFUND', entityType: 'Transaction', entityId: original.id, metadata: { reason, amount: Number(original.amount) / 100 } } });
    });
    await this.notificationsService.create({ userId: original.userId, type: 'SYSTEM', title: 'Refund issued', body: `₦${(Number(original.amount) / 100).toLocaleString()} has been refunded to your wallet.`, data: { reference } }).catch(() => {});
    return { message: 'Refund issued', reference };
  }

  async getGroupsOverview(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    const [groups, total] = await Promise.all([
      this.prisma.group.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, slug: true, status: true, contributionAmount: true, currentCycle: true, totalCycles: true, poolBalance: true, maxMembers: true, createdAt: true, frozenByAdminId: true, _count: { select: { members: true } } } }),
      this.prisma.group.count({ where }),
    ]);
    return { groups: groups.map(g => ({ ...g, contributionAmount: Number(g.contributionAmount) / 100, poolBalance: Number(g.poolBalance) / 100 })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async freezeGroup(adminId: string, groupId: string, reason: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'PAUSED', frozenByAdminId: adminId, frozenReason: reason } });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'GROUP_FROZEN', entityType: 'Group', entityId: groupId, metadata: { reason } } });
    return { message: 'Group frozen' };
  }

  async unfreezeGroup(adminId: string, groupId: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'ACTIVE', frozenByAdminId: null, frozenReason: null } });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'GROUP_UNFROZEN', entityType: 'Group', entityId: groupId } });
    return { message: 'Group unfrozen' };
  }

  async closeGroup(adminId: string, groupId: string, reason: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'CANCELLED' } });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'GROUP_CLOSED', entityType: 'Group', entityId: groupId, metadata: { reason } } });
    return { message: 'Group closed' };
  }

  async broadcastToGroup(adminId: string, groupId: string, title: string, body: string) {
    const members = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' }, select: { userId: true } });
    await this.prisma.notification.createMany({ data: members.map(m => ({ userId: m.userId, type: 'SYSTEM', title, body })) });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'GROUP_BROADCAST', entityType: 'Group', entityId: groupId, metadata: { title, memberCount: members.length } } });
    return { message: `Notification sent to ${members.length} group members` };
  }

  async getCyclesOverview(page = 1, limit = 30) {
    const skip = (page - 1) * limit;
    const [cycles, total] = await Promise.all([
      this.prisma.groupCycle.findMany({ skip, take: limit, orderBy: { startDate: 'desc' }, include: { group: { select: { name: true, slug: true, status: true } } } }),
      this.prisma.groupCycle.count(),
    ]);
    return { cycles: cycles.map(c => ({ ...c, totalCollected: Number(c.totalCollected) / 100 })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getUserSessions(userId: string) {
    return this.prisma.session.findMany({ where: { userId }, orderBy: { lastActiveAt: 'desc' }, select: { id: true, deviceInfo: true, ipAddress: true, isActive: true, lastActiveAt: true, expiresAt: true, createdAt: true } });
  }

  async forceLogoutUser(adminId: string, userId: string) {
    await this.prisma.executeTransaction(async (tx) => {
      await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } });
      await tx.session.updateMany({ where: { userId }, data: { isActive: false } });
      await tx.auditLog.create({ data: { actorId: adminId, action: 'FORCE_LOGOUT', entityType: 'User', entityId: userId } });
    });
    return { message: 'User logged out of all sessions' };
  }

  async getFraudFlags(resolved = false, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [flags, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({ where: { resolved }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.fraudFlag.count({ where: { resolved } }),
    ]);
    return { flags, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async flagFraud(adminId: string, dto: FlagFraudDto & { userId?: string }) {
    return this.prisma.fraudFlag.create({ data: { userId: dto.userId, type: dto.type, description: dto.description, severity: dto.severity, metadata: { flaggedBy: adminId } } });
  }

  async resolveFraudFlag(adminId: string, flagId: string) {
    await this.prisma.fraudFlag.update({ where: { id: flagId }, data: { resolved: true, resolvedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'RESOLVE_FRAUD_FLAG', entityType: 'FraudFlag', entityId: flagId } });
    return { message: 'Flag resolved' };
  }

  async getAuditLogs(viewerRole: string, page = 1, limit = 50, actorId?: string, action?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (actorId) where.actorId = actorId;
    const andConditions: any[] = [];
    if (action) andConditions.push({ action: { contains: action } });
    if (viewerRole !== 'SUPER_ADMIN') andConditions.push({ action: { notIn: SUPER_ADMIN_ONLY_ACTIONS } });
    if (andConditions.length) where.AND = andConditions;
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, email: true, firstName: true, lastName: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const enriched = await Promise.all(logs.map(async (log) => {
      let targetUser = null;
      if (['KYC_MANUALLY_APPROVED', 'KYC_MANUALLY_REJECTED', 'KYC_COMPLETED', 'KYC_NIN_VERIFIED', 'KYC_MANUAL_REVIEW', 'KYC_IDENTITY_REVEALED', 'KYC_FACE_SUBMITTED'].includes(log.action) && log.entityId) {
        targetUser = await this.prisma.user.findUnique({ where: { id: log.entityId }, select: { username: true, email: true, firstName: true, lastName: true } }).catch(() => null);
      }
      return { ...log, targetUser };
    }));
    return { logs: enriched, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getPendingPayouts(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({ where: { status: { in: ['SCHEDULED', 'PROCESSING'] } }, skip, take: limit, orderBy: { scheduledDate: 'asc' }, include: { recipient: { select: { id: true, username: true, firstName: true, email: true } }, group: { select: { name: true } } } }),
      this.prisma.payout.count({ where: { status: { in: ['SCHEDULED', 'PROCESSING'] } } }),
    ]);
    return { payouts: payouts.map(p => ({ ...p, amount: Number(p.amount) / 100 })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async broadcastNotification(adminId: string, title: string, body: string) {
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    const chunkSize = 100;
    for (let i = 0; i < users.length; i += chunkSize) {
      const chunk = users.slice(i, i + chunkSize);
      await this.prisma.notification.createMany({ data: chunk.map(u => ({ userId: u.id, type: 'SYSTEM', title, body })) });
    }
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'BROADCAST_NOTIFICATION', entityType: 'System', metadata: { title, userCount: users.length } } });
    return { message: `Notification sent to ${users.length} users` };
  }

  // ── Company revenue (penalty fees + platform withdrawal fees) ────
  // Both are credited to the SYSTEM wallet (created to fix the
  // audit_logs FK-violation bug). This just reads and breaks it down.
  async getRevenueOverview() {
    const systemWallet = await this.prisma.wallet.findUnique({ where: { userId: 'SYSTEM' } });
    const walletBalance = Number(systemWallet?.balance || 0) / 100;

    const [penaltyAgg, platformFeeAgg, recentPenalties, recentPlatformFees] = await Promise.all([
      this.prisma.walletTransaction.aggregate({ where: { userId: 'SYSTEM', type: 'PENALTY' }, _sum: { amount: true }, _count: true }),
      this.prisma.transaction.aggregate({ where: { userId: 'SYSTEM', type: 'WALLET_FUNDING' }, _sum: { amount: true }, _count: true }),
      this.prisma.walletTransaction.findMany({ where: { userId: 'SYSTEM', type: 'PENALTY' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.transaction.findMany({ where: { userId: 'SYSTEM', type: 'WALLET_FUNDING' }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    // ── Resolve fromUserId → actual user (username/name) ──
    // Both tables store the paying user's id inside metadata.fromUserId
    // (the transaction row itself belongs to the SYSTEM wallet, not
    // them), so this batch-fetches those users once and attaches them
    // below rather than showing a raw id in the admin UI, which isn't
    // searchable against anything.
    const fromUserIds = Array.from(new Set([
      ...recentPenalties.map((t: any) => t.metadata?.fromUserId).filter(Boolean),
      ...recentPlatformFees.map((t: any) => t.metadata?.fromUserId).filter(Boolean),
    ])) as string[];

    const fromUsers = fromUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: fromUserIds } },
          select: { id: true, username: true, firstName: true, lastName: true },
        })
      : [];
    const fromUserMap = new Map(fromUsers.map(u => [u.id, u]));

    const attachFromUser = (t: any) => ({
      ...t,
      amount: Number(t.amount) / 100,
      fromUser: t.metadata?.fromUserId ? fromUserMap.get(t.metadata.fromUserId) || null : null,
    });

    return {
      walletBalance,
      totalFromPenalties:    Number(penaltyAgg._sum.amount || 0) / 100,
      penaltyCount:          penaltyAgg._count,
      totalFromPlatformFees: Number(platformFeeAgg._sum.amount || 0) / 100,
      platformFeeCount:      platformFeeAgg._count,
      recentPenalties:       recentPenalties.map(attachFromUser),
      recentPlatformFees:    recentPlatformFees.map(attachFromUser),
    };
  }

  // ── KYC Management ────────────────────────────────────────
  async getKycRecords(status?: string) {
    const where: any = status ? { status } : undefined;
    const records = await this.prisma.identityRecord.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, username: true, createdAt: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return records.map(r => ({
      ...r,
      ninFull: r.ninEncrypted ? this.decryptIdentity(r.ninEncrypted) : null,
      bvnFull: r.bvnEncrypted ? this.decryptIdentity(r.bvnEncrypted) : null,
    }));
  }

  async approveKyc(adminId: string, userId: string, facePhotoUrl?: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { username: true, firstName: true, lastName: true, email: true } });
    await this.prisma.identityRecord.update({ where: { userId }, data: { status: 'VERIFIED', identityMatched: true } });
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId, action: 'KYC_MANUALLY_APPROVED', entityType: 'USER', entityId: userId,
        metadata: {
          approvedBy:      admin?.username || adminId,
          approvedByName:  `${admin?.firstName || ''} ${admin?.lastName || ''}`.trim(),
          approvedByEmail: admin?.email || null,
          facePhotoUrl:    facePhotoUrl || null,
        },
      },
    });
    await this.notificationsService.create({ userId, type: 'SYSTEM', title: 'Identity verified! 🎉', body: 'Your identity has been manually reviewed and approved. Your PayPaddy account is now active!', data: { step: 'KYC_APPROVED' } }).catch(() => {});
    return { message: 'KYC approved' };
  }

  async rejectKyc(adminId: string, userId: string, reason: string, facePhotoUrl?: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { username: true, firstName: true, lastName: true, email: true } });
    await this.prisma.identityRecord.update({
      where: { userId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        identityMatched: false,
        ninVerified: false,
        bvnVerified: false,
        facePhotoUrl: null,
        faceScannedAt: null,
      } as any,
    });
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'PENDING_VERIFICATION' } });
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId, action: 'KYC_MANUALLY_REJECTED', entityType: 'USER', entityId: userId,
        metadata: {
          reason,
          rejectedBy:      admin?.username || adminId,
          rejectedByName:  `${admin?.firstName || ''} ${admin?.lastName || ''}`.trim(),
          rejectedByEmail: admin?.email || null,
          facePhotoUrl:    facePhotoUrl || null,
        },
      },
    });
    await this.notificationsService.create({ userId, type: 'SYSTEM', title: 'Identity verification rejected ❌', body: `Your identity verification was rejected. Reason: ${reason}. Please go to Verify Identity to resubmit.`, data: { step: 'KYC_REJECTED', reason } }).catch(() => {});
    return { message: 'KYC rejected' };
  }
}

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() { return this.adminService.getAdminDashboard(); }

  @Get('users')
  getUsers(@Query('page') page = 1, @Query('limit') limit = 20, @Query('search') search?: string, @Query('status') status?: string) { return this.adminService.getUsers(+page, +limit, search, status); }

  @Patch('users/:id/suspend')
  suspendUser(@Req() req: any, @Param('id') id: string, @Body() dto: SuspendUserDto) { return this.adminService.suspendUser(req.user.id, id, dto); }

  @Patch('users/:id/unsuspend')
  unsuspendUser(@Req() req: any, @Param('id') id: string) { return this.adminService.unsuspendUser(req.user.id, id); }

  @Patch('users/:id/ban')
  @UseGuards(SuperAdminGuard)
  banUser(@Req() req: any, @Param('id') id: string, @Body('reason') reason: string) { return this.adminService.banUser(req.user.id, id, reason); }

  @Patch('users/:id/unban')
  @UseGuards(SuperAdminGuard)
  unbanUser(@Req() req: any, @Param('id') id: string) { return this.adminService.unbanUser(req.user.id, id); }

  @Delete('users/:id')
  @UseGuards(SuperAdminGuard)
  deleteUser(@Req() req: any, @Param('id') id: string, @Query('reason') reason: string) { return this.adminService.softDeleteUser(req.user.id, id, reason); }

  @Patch('users/:id/role')
  @UseGuards(SuperAdminGuard)
  updateUserRole(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserRoleDto) { return this.adminService.updateUserRole(req.user.id, id, dto.role); }

  @Get('users/:id/sessions')
  @UseGuards(SuperAdminGuard)
  getUserSessions(@Param('id') id: string) { return this.adminService.getUserSessions(id); }

  @Post('users/:id/force-logout')
  @UseGuards(SuperAdminGuard)
  forceLogout(@Req() req: any, @Param('id') id: string) { return this.adminService.forceLogoutUser(req.user.id, id); }

  @Get('transactions')
  getTransactions(@Query('page') page = 1, @Query('limit') limit = 20, @Query('status') status?: string, @Query('type') type?: string, @Query('search') search?: string) { return this.adminService.getTransactions(+page, +limit, status, type, search); }

  @Get('export/transactions')
  async exportTransactions(@Res() res: Response, @Query('status') status?: string, @Query('type') type?: string) {
    const csv = await this.adminService.exportTransactionsCsv(status, type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Post('transactions/:id/refund')
  refundTransaction(@Req() req: any, @Param('id') id: string, @Body() dto: RefundTransactionDto) { return this.adminService.refundTransaction(req.user.id, id, dto.reason); }

  @Get('groups')
  getGroups(@Query('page') page = 1, @Query('limit') limit = 20, @Query('status') status?: string) { return this.adminService.getGroupsOverview(+page, +limit, status); }

  @Patch('groups/:id/freeze')
  freezeGroup(@Req() req: any, @Param('id') id: string, @Body() dto: FreezeGroupDto) { return this.adminService.freezeGroup(req.user.id, id, dto.reason); }

  @Patch('groups/:id/unfreeze')
  unfreezeGroup(@Req() req: any, @Param('id') id: string) { return this.adminService.unfreezeGroup(req.user.id, id); }

  @Patch('groups/:id/close')
  closeGroup(@Req() req: any, @Param('id') id: string, @Body() dto: CloseGroupDto) { return this.adminService.closeGroup(req.user.id, id, dto.reason); }

  @Post('groups/:id/broadcast')
  broadcastToGroup(@Req() req: any, @Param('id') id: string, @Body() dto: GroupBroadcastDto) { return this.adminService.broadcastToGroup(req.user.id, id, dto.title, dto.body); }

  @Get('cycles')
  getCycles(@Query('page') page = 1, @Query('limit') limit = 30) { return this.adminService.getCyclesOverview(+page, +limit); }

  @Get('fraud')
  getFraud(@Query('resolved') resolved = false, @Query('page') page = 1, @Query('limit') limit = 20) { return this.adminService.getFraudFlags(Boolean(resolved), +page, +limit); }

  @Post('fraud')
  flagFraud(@Req() req: any, @Body() dto: FlagFraudDto & { userId?: string }) { return this.adminService.flagFraud(req.user.id, dto); }

  @Patch('fraud/:id/resolve')
  resolveFraud(@Req() req: any, @Param('id') id: string) { return this.adminService.resolveFraudFlag(req.user.id, id); }

  @Get('audit-logs')
  getAuditLogs(@Req() req: any, @Query('page') page = 1, @Query('limit') limit = 50, @Query('userId') userId?: string, @Query('action') action?: string) {
    return this.adminService.getAuditLogs(req.user.role, +page, +limit, userId, action);
  }

  @Get('payouts/pending')
  getPendingPayouts(@Query('page') page = 1, @Query('limit') limit = 20) { return this.adminService.getPendingPayouts(+page, +limit); }

  @Post('broadcast')
  @UseGuards(SuperAdminGuard)
  broadcast(@Req() req: any, @Body('title') title: string, @Body('body') body: string) { return this.adminService.broadcastNotification(req.user.id, title, body); }

  // ── Company revenue (Super Admin only) ───────────────────
  @Get('revenue')
  @UseGuards(SuperAdminGuard)
  getRevenue() { return this.adminService.getRevenueOverview(); }

  // ── KYC endpoints ─────────────────────────────────────────
  @Get('kyc/pending')
  getKycRecords(@Query('status') status?: string) { return this.adminService.getKycRecords(status); }

  @Patch('kyc/:userId/approve')
  approveKyc(@Req() req: any, @Param('userId') userId: string, @Body() body: { facePhotoUrl?: string }) { return this.adminService.approveKyc(req.user.id, userId, body?.facePhotoUrl); }

  @Patch('kyc/:userId/reject')
  rejectKyc(@Req() req: any, @Param('userId') userId: string, @Body() dto: KycRejectDto & { facePhotoUrl?: string }) { return this.adminService.rejectKyc(req.user.id, userId, dto.reason, dto.facePhotoUrl); }
}

@Module({
  imports:     [NotificationsModule],
  controllers: [AdminController],
  providers:   [AdminService],
  exports:     [AdminService],
})
export class AdminModule {}