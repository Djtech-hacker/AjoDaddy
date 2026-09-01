// ============================================================
// GROUPS MODULE
// ============================================================
// Stage 2 — contribution frequency separated from payout frequency.
//   * A group's CYCLE length is driven by payoutFrequency (how often a
//     member collects the pot).
//   * The contribution amount for a cycle = per-period amount ×
//     number of contribution-periods that fit inside one payout window.
//     e.g. ₦1,000 DAILY contribute + MONTHLY payout ⇒ ₦1,000 × 30 = ₦30,000
//     per member per round.  With 5 members the pot = ₦150,000.
//   * When contribution freq == payout freq (the classic case) the
//     multiplier is 1, so existing groups behave exactly as before.
//   * Deadline field removed — a contribution is simply due at the end of
//     its cycle; the 48-hour grace period then applies (GraceService).
//
// Stage 3 — multi-rotation groups.
//   * New optional `rotations` field on group creation (default 1).
//     totalCycles = maxMembers * rotations — e.g. 2 members × 3 rotations
//     = 6 total payout cycles, each member paid 3 times.
//   * No new DB column needed: rotations is always recoverable as
//     totalCycles / maxMembers whenever it needs to be displayed.
//   * Payout recipient lookup now matches payoutPosition against the
//     CYCLE NUMBER MODULO MEMBER COUNT, so cycle (maxMembers + 1) wraps
//     back around to position 1 instead of finding no recipient and
//     pausing the group.
//
// Stage 4 — grace-period deadlock fix.
//   * When a member misses a contribution, GraceService pauses the WHOLE
//     group for up to 48h so they can catch up (see grace.module.ts).
//     makeContribution() previously rejected ANY contribution attempt
//     while status !== 'ACTIVE' — including the defaulting member's own
//     catch-up payment. That's a deadlock: paused because they owe,
//     blocked from paying because it's paused, no way out except waiting
//     for the 48h grace period to expire and getting removed instead.
//     Fix: if the group is PAUSED, allow the contribution through only
//     when the paying user has an ACTIVE grace period in this group —
//     everyone else still correctly can't contribute while paused.
//
// Stage 5 — missed-payout race condition fix.
//   * A late catch-up payment used to fire checkAndTriggerPayout() and
//     graceService.resolveGracePeriod() concurrently, with no ordering
//     between them. _executePayoutUnderLock() bails out silently
//     (`return null`, no error, no audit log) whenever group.status
//     isn't 'ACTIVE' — and since resolveGracePeriod() is what flips the
//     group back to ACTIVE after a late payment, the payout check could
//     run and read the group as still PAUSED a moment before the grace
//     period resolved. Nothing ever re-checks that cycle afterwards, so
//     the payout was silently dropped even though every contribution
//     was PAID and the pool was full.
//     Fix: sequence grace resolution BEFORE the payout check (still
//     fire-and-forget as a whole, so the HTTP response isn't delayed),
//     and add a safety-net re-check on manual group resume in case a
//     cycle's payout was already missed while paused.
//
// Stage 6 — contribution transaction timeout headroom.
//   * makeContribution()'s transaction does ~11 sequential queries (group
//     lookup, member check, 2x contribution lookups, raw balance UPDATE,
//     pool increment, contribution update, wallet lookup, wallet
//     transaction create, member totalPaid update, reputation update,
//     audit log). PrismaService.executeTransaction()'s default timeout is
//     10s — plenty on a normal connection, but on a slow/high-latency DB
//     link (e.g. traffic routed through a distant VPN relay) each
//     round-trip can take seconds instead of milliseconds, and the whole
//     transaction blows past 10s and gets killed mid-way — after money's
//     already been deducted from the wallet in an earlier statement in
//     the same transaction, which then rolls back, but the whole request
//     still fails with a confusing "Transaction already closed" error.
//     Bumped this specific call's timeout to 20s as a safety margin. This
//     doesn't fix a slow connection — it just gives more legitimate
//     headroom before Prisma gives up.
// ============================================================
import {
  Module, Controller, Get, Post, Patch, Delete,
  Body, Req, Param, Query, UseGuards, Injectable,
  NotFoundException, ForbiddenException, BadRequestException, ConflictException,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Cron, CronExpression, ScheduleModule } from '@nestjs/schedule';
import {
  IsString, IsNumber, Min, Max, IsEnum, IsOptional,
  IsBoolean, IsDateString, MinLength, MaxLength,
} from 'class-validator';
import slugify from 'slugify';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { GraceService } from '../grace/grace.module';
import { GraceModule } from '../grace/grace.module';
import { KycModule } from '../kyc/kyc.module';
import { UsersService } from '../users/users.module';
import { UsersModule } from '../users/users.module';
// Days each frequency represents.
const FREQUENCY_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 30 };
export class CreateGroupDto {
  @IsString() @MinLength(3) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsNumber() @Min(100) contributionAmount: number;               // per-period amount (e.g. per day)
  @IsEnum(['DAILY','WEEKLY','BIWEEKLY','MONTHLY','CUSTOM']) frequency: string;          // how often members pay
  @IsOptional() @IsEnum(['DAILY','WEEKLY','BIWEEKLY','MONTHLY','CUSTOM']) payoutFrequency?: string; // how often a payout happens
  @IsNumber() @Min(2) @Max(100) maxMembers: number;
  @IsDateString() startDate: string;
  @IsEnum(['PUBLIC','PRIVATE','INVITE_ONLY']) visibility: string;
  @IsNumber() @Min(1) penaltyAmount: number;                        // mandatory — every group must have a real late fee
  @IsOptional() @IsBoolean() autoApproveMembers?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(365) customCycleDays?: number;
  // How many times the group rotates through every member's payout position.
  // totalCycles = maxMembers * rotations. Defaults to 1 (classic single-lap Ajo).
  @IsOptional() @IsNumber() @Min(1) @Max(52) rotations?: number;
}
export class UpdateGroupSettingsDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() chatEnabled?: boolean;
  @IsOptional() @IsBoolean() autoApproveMembers?: boolean;
  @IsOptional() @IsNumber() @Min(0) penaltyAmount?: number;
  @IsOptional() @IsEnum(['PUBLIC','PRIVATE','INVITE_ONLY']) visibility?: string;
}
export class JoinGroupDto { @IsOptional() @IsString() inviteCode?: string; }
export class AcceptAgreementDto { @IsOptional() @IsString() deviceInfo?: string; }
export class ReorderPayoutDto { @IsString({ each: true }) memberIds: string[]; }
export class MakeContributionDto { @IsString() pin: string; }
export class TransferOwnershipDto { @IsString() newOwnerId: string; }
export class BanMemberDto { @IsOptional() @IsString() reason?: string; }
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly graceService: GraceService,
    private readonly usersService: UsersService,
  ) {}
  async getContributionsByCycle(userId: string, groupId: string, cycle: number) {
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId, status: 'ACTIVE' } });
    if (!member) throw new ForbiddenException('Not a group member');
    const contributions = await this.prisma.contribution.findMany({ where: { groupId, cycleNumber: cycle }, include: { user: { select: { firstName: true, username: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } });
    return contributions.map(c => ({ ...c, amount: Number(c.amount) / 100 }));
  }
  async markContributionPaid(adminId: string, groupId: string, contributionId: string) {
    await this.requireAdmin(adminId, groupId);
    const contrib = await this.prisma.contribution.findFirst({ where: { id: contributionId, groupId } });
    if (!contrib) throw new NotFoundException('Contribution not found');
    if (contrib.status === 'PAID') throw new ConflictException('Already paid');
    await this.prisma.contribution.update({ where: { id: contributionId }, data: { status: 'PAID', paidAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId: adminId, action: 'CONTRIBUTION_MANUALLY_MARKED_PAID', entityType: 'CONTRIBUTION', entityId: contributionId, metadata: { groupId, contributionId, markedBy: adminId } } });
    await this.checkAndTriggerPayout(groupId, contrib.cycleNumber);
    return { message: 'Contribution marked as paid' };
  }
  async createGroup(userId: string, dto: CreateGroupDto) {
    const creator = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!creator || creator.status !== 'ACTIVE') throw new ForbiddenException('You must complete identity verification before creating a group. Go to Profile → Verify Identity.');
    // Same check joinGroup() already enforces — a member removed for a
    // missed contribution carries a debt, and until it's settled they
    // shouldn't be able to sidestep it by starting a brand new group
    // instead of joining an existing one.
    const outstandingDebts = await this.prisma.debt.count({ where: { userId, status: 'OUTSTANDING' } });
    if (outstandingDebts > 0) throw new ForbiddenException('You have outstanding debts that must be settled before creating a new group.');
    // Per-period amount the owner entered (e.g. ₦1,000 per day).
    const perPeriodKobo = BigInt(Math.round(dto.contributionAmount * 100));
    const penaltyKobo   = BigInt(Math.round((dto.penaltyAmount || 0) * 100));
    // Payout frequency drives the cycle length (how long until someone collects).
    const payoutFreq  = dto.payoutFrequency || dto.frequency;
    const cycleDuration = this.getCycleDuration(payoutFreq, dto.customCycleDays);
    // How many contribution-periods fit inside one payout window.
    // e.g. DAILY contribute inside MONTHLY payout = 30 periods.
    const periodsPerCycle = this.getPeriodsPerCycle(dto.frequency, payoutFreq, dto.customCycleDays);
    // The amount a member owes per cycle = per-period amount × periods in the window.
    const cycleContributionKobo = perPeriodKobo * BigInt(periodsPerCycle);
    // How many times the group loops through every payout position.
    const rotations = dto.rotations && dto.rotations > 0 ? Math.floor(dto.rotations) : 1;
    const totalCycles = dto.maxMembers * rotations;
    let slug = slugify(dto.name, { lower: true, strict: true });
    const existing = await this.prisma.group.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${nanoid(6)}`;
    const group = await this.prisma.executeTransaction(async (tx) => {
      const g = await tx.group.create({ data: {
        slug, name: dto.name, description: dto.description, ownerId: userId,
        contributionAmount: cycleContributionKobo,          // amount owed each cycle
        frequency: dto.frequency as any,
        payoutFrequency: payoutFreq as any,
        maxMembers: dto.maxMembers, totalCycles,
        cycleDurationDays: cycleDuration,                   // driven by payout frequency
        startDate: new Date(dto.startDate),
        visibility: dto.visibility as any,
        deadlineDays: cycleDuration,                        // due at end of cycle (no separate deadline)
        penaltyAmount: penaltyKobo,
        autoApproveMembers: dto.autoApproveMembers || false,
        nextContributionDate: new Date(dto.startDate),
        status: 'DRAFT', currentCycle: 0,
        customCycleDays: dto.customCycleDays || null,
        poolBalance: BigInt(0),
      } });
      await tx.groupMember.create({ data: { groupId: g.id, userId, role: 'ADMIN', status: 'ACTIVE', payoutPosition: 1, memberNumber: 1 } });
      await tx.auditLog.create({ data: { actorId: userId, action: 'GROUP_CREATED', entityType: 'GROUP', entityId: g.id, metadata: { name: g.name, visibility: g.visibility, perPeriodKobo: Number(perPeriodKobo), periodsPerCycle, cycleContributionKobo: Number(cycleContributionKobo), contributionFreq: dto.frequency, payoutFreq, rotations, totalCycles } } });
      return g;
    });
    // Attach the per-period amount for display purposes.
    return { ...this.formatGroup(group), perContributionAmount: Number(perPeriodKobo) / 100, periodsPerCycle, rotations };
  }
  async getGroups(userId: string, page = 1, limit = 12, search?: string, visibility?: string) {
    const safePage  = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;
    const where: any = {};
    if (visibility === 'mine') { where.members = { some: { userId, status: 'ACTIVE' } }; }
    else if (visibility === 'public') { where.visibility = 'PUBLIC'; where.status = { not: 'ARCHIVED' }; }
    else { where.OR = [{ members: { some: { userId, status: 'ACTIVE' } } }, { visibility: 'PUBLIC', status: { not: 'ARCHIVED' } }]; }
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [groups, total] = await Promise.all([
      this.prisma.group.findMany({ where, skip, take: safeLimit, orderBy: { createdAt: 'desc' }, include: { owner: { select: { id: true, username: true, firstName: true, avatarUrl: true } }, _count: { select: { members: { where: { status: 'ACTIVE' } } } }, members: { where: { userId }, select: { role: true, payoutPosition: true, totalPaid: true, memberNumber: true, status: true } } } }),
      this.prisma.group.count({ where }),
    ]);
    return { groups: groups.map(g => this.formatGroup(g)), pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) } };
  }
  async getGroupBySlug(slug: string, userId: string) {
    const group = await this.prisma.group.findUnique({ where: { slug }, include: { owner: { select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true } }, members: { where: { status: { in: ['ACTIVE','PENDING'] } }, orderBy: { payoutPosition: 'asc' }, include: { user: { select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true, reputationScore: true } } } }, _count: { select: { members: { where: { status: 'ACTIVE' } } } } } });
    if (!group) throw new NotFoundException('Group not found');
    const isMember = group.members.some(m => m.userId === userId);
    if (group.visibility !== 'PUBLIC' && !isMember) throw new ForbiddenException('Access denied to private group');
    const isAdmin = group.members.some(m => m.userId === userId && (m.role === 'ADMIN' || m.role === 'MODERATOR'));
    const visibleMembers = isAdmin ? group.members : group.members.filter(m => m.status === 'ACTIVE');
    const [contributions, nextPayout, myCycleStatus] = await Promise.all([
      this.prisma.contribution.findMany({ where: { groupId: group.id, cycleNumber: group.currentCycle }, include: { user: { select: { firstName: true, username: true, avatarUrl: true } } } }),
      this.prisma.payout.findFirst({ where: { groupId: group.id, status: 'SCHEDULED', cycleNumber: { gte: group.currentCycle } }, orderBy: { scheduledDate: 'asc' }, include: { recipient: { select: { firstName: true, lastName: true, avatarUrl: true } } } }),
      this.prisma.groupMember.findFirst({ where: { groupId: group.id, userId }, select: { memberNumber: true, payoutPosition: true, totalPaid: true, status: true, role: true } }),
    ]);
    const memberInfo = myCycleStatus ? this.calculateMemberPayoutInfo(group, myCycleStatus) : null;
    // Derive the per-period contribution for display: cycle amount / periods in a cycle.
    const periodsPerCycle = this.getPeriodsPerCycle(group.frequency, group.payoutFrequency || group.frequency, group.customCycleDays || undefined);
    const perContributionAmount = periodsPerCycle > 0 ? (Number(group.contributionAmount) / periodsPerCycle) / 100 : Number(group.contributionAmount) / 100;
    // rotations is always recoverable from totalCycles / maxMembers — no dedicated column needed.
    const rotations = group.maxMembers > 0 ? Math.round(group.totalCycles / group.maxMembers) : 1;
    return { ...this.formatGroup({ ...group, members: visibleMembers }), contributions: contributions.map(c => ({ ...c, amount: Number(c.amount) / 100 })), nextPayout: nextPayout ? { ...nextPayout, amount: Number(nextPayout.amount) / 100 } : null, myMemberInfo: memberInfo, chatEnabled: group.chatEnabled, perContributionAmount, periodsPerCycle, rotations };
  }
  private calculateMemberPayoutInfo(group: any, member: any) {
    const maxMembers = group.maxMembers || 1;
    const currentCycle = group.currentCycle || 0;
    // Effective payout position for a given cycle number, wrapping around
    // for multi-rotation groups (cycle maxMembers+1 maps back to position 1).
    const effectivePosition = (cycle: number) => ((cycle - 1) % maxMembers) + 1;
    const isNextRecipient = currentCycle > 0 && currentCycle <= group.totalCycles && effectivePosition(currentCycle) === member.payoutPosition;
    // Next cycle (at or after currentCycle) where this member is due to be paid again.
    let nextCycleForMember = currentCycle;
    if (currentCycle > 0) {
      const diff = (member.payoutPosition - effectivePosition(currentCycle) + maxMembers) % maxMembers;
      nextCycleForMember = currentCycle + diff;
    }
    const stillHasFuturePayout = currentCycle > 0 && nextCycleForMember <= group.totalCycles;
    const cyclesRemaining = stillHasFuturePayout ? nextCycleForMember - currentCycle : 0;
    const msPerCycle = group.cycleDurationDays * 24 * 60 * 60 * 1000;
    const expectedPayoutDate = stillHasFuturePayout && cyclesRemaining > 0 ? new Date(Date.now() + cyclesRemaining * msPerCycle) : null;
    // Each cycle's pot = amount owed per member that cycle × members.
    return { memberNumber: member.memberNumber, payoutPosition: member.payoutPosition, expectedPayoutCycle: stillHasFuturePayout ? nextCycleForMember : null, expectedPayoutDate, estimatedPayoutAmount: Number(group.contributionAmount) * group.maxMembers, totalPaid: Number(member.totalPaid) / 100, remainingCycles: Math.max(0, group.totalCycles - currentCycle), hasReceivedPayout: currentCycle > member.payoutPosition, isNextRecipient };
  }
  async getGroupByInviteCode(code: string) {
    const invite = await this.prisma.inviteLink.findFirst({ where: { code, isActive: true }, include: { group: { include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } } } } });
    if (!invite) throw new NotFoundException('Invalid or expired invite code');
    if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestException('Invite link has expired');
    if (invite.maxUses && invite.useCount >= invite.maxUses) throw new BadRequestException('Invite link has reached max uses');
    return this.formatGroup(invite.group);
  }
  async acceptGroupAgreement(userId: string, groupId: string, deviceInfo?: string, ipAddress?: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) throw new NotFoundException('Group not found');
    await this.prisma.groupAgreement.upsert({
      where:  { userId_groupId: { userId, groupId } },
      create: { userId, groupId, deviceInfo: deviceInfo || null, ipAddress: ipAddress || null },
      update: { acceptedAt: new Date(), deviceInfo: deviceInfo || null, ipAddress: ipAddress || null },
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'GROUP_AGREEMENT_ACCEPTED', entityType: 'GROUP', entityId: groupId, metadata: { userId, groupId, ipAddress }, ipAddress: ipAddress || null } });
    return { message: 'Agreement accepted', accepted: true };
  }
  async joinGroup(userId: string, groupId: string, dto: JoinGroupDto) {
    const agreement = await this.prisma.groupAgreement.findUnique({ where: { userId_groupId: { userId, groupId } } });
    if (!agreement) throw new ForbiddenException('You must read and accept the group agreement before joining.');
    const result = await this.prisma.executeTransaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: groupId } });
      if (!group) throw new NotFoundException('Group not found');
      if (group.status === 'ARCHIVED' || group.status === 'COMPLETED') throw new BadRequestException('Group is no longer accepting members');
      if (group.status === 'PAUSED') throw new BadRequestException('Group is paused');
      const joiner = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!joiner || joiner.status !== 'ACTIVE') throw new ForbiddenException('You must complete identity verification before joining a group. Go to Profile → Verify Identity.');
      const outstandingDebts = await tx.debt.count({ where: { userId, status: 'OUTSTANDING' } });
      if (outstandingDebts > 0) throw new ForbiddenException('You have outstanding debts that must be settled before joining a new group.');
      const identityRecord = await tx.identityRecord.findUnique({ where: { userId } });
      if (process.env.KYC_REQUIRE_NIN === 'true' && !identityRecord?.ninVerified) throw new ForbiddenException('Please complete NIN verification before joining a group.');
      if (process.env.KYC_REQUIRE_BVN === 'true' && !identityRecord?.bvnVerified) throw new ForbiddenException('Please complete BVN verification before joining a group.');
      if (group.visibility === 'INVITE_ONLY' || group.visibility === 'PRIVATE') {
        if (!dto.inviteCode) throw new ForbiddenException('Invite code required');
        const invite = await tx.inviteLink.findFirst({ where: { groupId, code: dto.inviteCode, isActive: true } });
        if (!invite) throw new ForbiddenException('Invalid or expired invite code');
        if (invite.expiresAt && invite.expiresAt < new Date()) throw new ForbiddenException('Invite link expired');
        if (invite.maxUses && invite.useCount >= invite.maxUses) throw new ForbiddenException('Invite link has reached max uses');
      }
      const existing = await tx.groupMember.findFirst({ where: { groupId, userId } });
      if (existing) {
        if (existing.status === 'ACTIVE')  throw new ConflictException('Already a member');
        if (existing.status === 'PENDING') throw new ConflictException('Join request already pending');
        if (existing.status === 'BANNED')  throw new ForbiddenException('You have been banned from this group');
      }
      const activeCount = await tx.groupMember.count({ where: { groupId, status: 'ACTIVE' } });
      if (activeCount >= group.maxMembers) {
        const waitlistCount = await tx.groupMember.count({ where: { groupId, status: 'WAITLISTED' } });
        await tx.groupMember.create({ data: { groupId, userId, status: 'WAITLISTED', payoutPosition: 0, memberNumber: 0 } });
        return { status: 'WAITLISTED', waitlistPosition: waitlistCount + 1, message: 'Group is full. You have been added to the waitlist.', _ownerId: group.ownerId, _groupName: group.name };
      }
      const position   = activeCount + 1;
      const totalCount = await tx.groupMember.count({ where: { groupId } });
      const memberNum  = totalCount + 1;
      const status = (group.visibility === 'PUBLIC' || group.autoApproveMembers || (dto.inviteCode && group.visibility === 'PRIVATE')) ? 'ACTIVE' : 'PENDING';
      if (existing) { await tx.groupMember.update({ where: { id: existing.id }, data: { status, payoutPosition: position, memberNumber: memberNum } }); }
      else { await tx.groupMember.create({ data: { groupId, userId, payoutPosition: position, memberNumber: memberNum, status } }); }
      // due at end of cycle (cycleDurationDays), no separate deadline
      if (status === 'ACTIVE' && group.currentCycle > 0) { await tx.contribution.create({ data: { groupId, userId, cycleNumber: group.currentCycle, amount: group.contributionAmount, dueDate: new Date(Date.now() + group.cycleDurationDays * 24 * 60 * 60 * 1000), status: 'PENDING' } }); }
      if (dto.inviteCode) { await tx.inviteLink.updateMany({ where: { groupId, code: dto.inviteCode }, data: { useCount: { increment: 1 } } }); }
      await tx.auditLog.create({ data: { actorId: userId, action: status === 'ACTIVE' ? 'MEMBER_JOINED' : 'MEMBER_REQUESTED', entityType: 'GROUP_MEMBER', entityId: groupId, metadata: { userId, memberNumber: memberNum, status } } });
      return { status, slug: group.slug, memberNumber: memberNum, _ownerId: group.ownerId, _groupName: group.name, _groupCreatedAt: group.createdAt };
    });
    if (result._ownerId) { await this.notificationsService.create({ userId: result._ownerId, type: result.status === 'ACTIVE' ? 'MEMBER_JOINED' : 'GROUP_INVITE', title: result.status === 'ACTIVE' ? 'New member joined' : 'Join request received', body: `A new member ${result.status === 'ACTIVE' ? 'joined' : 'requested to join'} ${result._groupName}`, data: { groupId, status: result.status } }).catch(() => {}); }
    // Badges — fire-and-forget, after the transaction already committed,
    // so the join transaction itself stays short. EARLY_SUPPORTER: the
    // group they just joined is still within its first 30 days.
    if (result.status === 'ACTIVE') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (result._groupCreatedAt && new Date(result._groupCreatedAt) >= thirtyDaysAgo) {
        this.usersService.awardBadgeIfMissing(userId, 'EARLY_SUPPORTER').catch((err) => console.error('[joinGroup] EARLY_SUPPORTER badge failed:', err));
      }
      this.usersService.checkAndAwardBadges(userId).catch((err) => console.error('[joinGroup] checkAndAwardBadges failed:', err));
    }
    const { _ownerId, _groupName, _groupCreatedAt, ...clean } = result;
    return { ...clean, message: result.status === 'ACTIVE' ? 'Joined successfully' : 'Join request submitted' };
  }
  async leaveGroup(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId, status: 'ACTIVE' } });
    if (!member) throw new NotFoundException('You are not a member of this group');
    if (member.role === 'ADMIN') throw new BadRequestException('Transfer ownership before leaving');
    const overdueContribs = await this.prisma.contribution.count({ where: { groupId, userId, status: 'OVERDUE' } });
    if (overdueContribs > 0) throw new BadRequestException(`You have ${overdueContribs} overdue contribution(s). Settle before leaving.`);
    const sideEffects: Array<() => Promise<any>> = [];
    await this.prisma.executeTransaction(async (tx) => {
      await tx.groupMember.updateMany({ where: { groupId, userId }, data: { status: 'LEFT', removedAt: new Date(), removedReason: 'Left voluntarily' } });
      await tx.contribution.updateMany({ where: { groupId, userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      if (member.payoutPosition > 0) await this.usersService.adjustReputationScore(userId, -5, tx);
      await tx.auditLog.create({ data: { actorId: userId, action: 'MEMBER_LEFT', entityType: 'GROUP_MEMBER', entityId: groupId, metadata: { userId, payoutPosition: member.payoutPosition } } });
      sideEffects.push(...await this.promoteFromWaitlist(tx, groupId));
    });
    await Promise.allSettled(sideEffects.map(fn => fn()));
    return { message: 'You have left the group' };
  }
  async approveMember(adminId: string, groupId: string, memberId: string) {
    await this.requireAdmin(adminId, groupId);
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId: memberId, status: 'PENDING' } });
    if (!member) throw new NotFoundException('Pending member not found');
    await this.prisma.executeTransaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: groupId } });
      await tx.groupMember.update({ where: { id: member.id }, data: { status: 'ACTIVE' } });
      if (group.currentCycle > 0) { await tx.contribution.create({ data: { groupId, userId: memberId, cycleNumber: group.currentCycle, amount: group.contributionAmount, dueDate: new Date(Date.now() + group.cycleDurationDays * 24 * 60 * 60 * 1000), status: 'PENDING' } }); }
      await tx.auditLog.create({ data: { actorId: adminId, action: 'MEMBER_APPROVED', entityType: 'GROUP_MEMBER', entityId: groupId, metadata: { approvedUserId: memberId } } });
    });
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    await this.notificationsService.create({ userId: memberId, type: 'GROUP_JOIN_APPROVED', title: 'Join request approved! 🎉', body: `You've been approved to join ${group.name}`, data: { groupId, groupSlug: group.slug } }).catch(() => {});
    return { message: 'Member approved' };
  }
  async rejectMember(adminId: string, groupId: string, memberId: string) {
    await this.requireAdmin(adminId, groupId);
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId: memberId, status: 'PENDING' } });
    if (!member) throw new NotFoundException('Pending member not found');
    await this.prisma.groupMember.update({ where: { id: member.id }, data: { status: 'REMOVED', removedAt: new Date(), removedReason: 'Join request rejected' } });
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    await this.notificationsService.create({ userId: memberId, type: 'MEMBER_REJECTED', title: 'Join request declined', body: `Your request to join ${group.name} was not approved`, data: { groupId } }).catch(() => {});
    return { message: 'Member rejected' };
  }
  async removeMember(adminId: string, groupId: string, memberId: string, reason?: string) {
    await this.requireAdmin(adminId, groupId);
    if (adminId === memberId) throw new BadRequestException('Cannot remove yourself');
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (group.ownerId === memberId) throw new ForbiddenException('Cannot remove the group owner');
    const targetMember = await this.prisma.groupMember.findFirst({ where: { groupId, userId: memberId, status: 'ACTIVE' } });
    if (!targetMember) throw new NotFoundException('Active member not found');
    if (targetMember.totalPaid > 0n) throw new BadRequestException('This member has already contributed and cannot be removed directly — use Ban instead, or open a dispute.');
    const sideEffects: Array<() => Promise<any>> = [];
    await this.prisma.executeTransaction(async (tx) => {
      await tx.groupMember.updateMany({ where: { groupId, userId: memberId }, data: { status: 'REMOVED', removedAt: new Date(), removedReason: reason } });
      await tx.contribution.updateMany({ where: { groupId, userId: memberId, status: { in: ['PENDING'] } }, data: { status: 'CANCELLED' } });
      await this.usersService.adjustReputationScore(memberId, -5, tx);
      await tx.auditLog.create({ data: { actorId: adminId, action: 'MEMBER_REMOVED', entityType: 'GROUP_MEMBER', entityId: groupId, metadata: { removedUserId: memberId, reason } } });
      sideEffects.push(...await this.promoteFromWaitlist(tx, groupId));
    });
    await Promise.allSettled(sideEffects.map(fn => fn()));
    return { message: 'Member removed' };
  }
  async banMember(adminId: string, groupId: string, memberId: string, dto: BanMemberDto) {
    await this.requireAdmin(adminId, groupId);
    if (adminId === memberId) throw new BadRequestException('Cannot ban yourself');
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (group.ownerId === memberId) throw new ForbiddenException('Cannot ban the group owner');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.groupMember.updateMany({ where: { groupId, userId: memberId }, data: { status: 'BANNED', removedAt: new Date(), removedReason: dto.reason || 'Banned by admin' } });
      await tx.contribution.updateMany({ where: { groupId, userId: memberId, status: { in: ['PENDING'] } }, data: { status: 'CANCELLED' } });
      await this.usersService.adjustReputationScore(memberId, -10, tx);
      await tx.auditLog.create({ data: { actorId: adminId, action: 'MEMBER_BANNED', entityType: 'GROUP_MEMBER', entityId: groupId, metadata: { bannedUserId: memberId, reason: dto.reason } } });
    });
    await this.notificationsService.create({ userId: memberId, type: 'MEMBER_BANNED', title: 'Removed from group', body: `You have been removed from ${group.name}${dto.reason ? ': ' + dto.reason : ''}`, data: { groupId } }).catch(() => {});
    return { message: 'Member banned' };
  }
  async reinstateMember(adminId: string, groupId: string, memberId: string) {
    await this.requireAdmin(adminId, groupId);
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId: memberId, status: 'BANNED' } });
    if (!member) throw new NotFoundException('Banned member not found');
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    let newPayoutPosition = member.payoutPosition;
    if (group.currentCycle > 0 && member.payoutPosition <= group.currentCycle) {
      const maxMember = await this.prisma.groupMember.aggregate({ where: { groupId, status: 'ACTIVE' }, _max: { payoutPosition: true } });
      newPayoutPosition = (maxMember._max.payoutPosition ?? group.currentCycle) + 1;
    }
    await this.prisma.executeTransaction(async (tx) => {
      await tx.groupMember.update({ where: { id: member.id }, data: { status: 'ACTIVE', removedAt: null, removedReason: null, payoutPosition: newPayoutPosition } });
      if (group.status === 'ACTIVE' && group.currentCycle > 0) {
        const alreadyHas = await tx.contribution.findFirst({ where: { groupId, userId: memberId, cycleNumber: group.currentCycle, status: { in: ['PENDING','PAID'] } } });
        if (!alreadyHas) await tx.contribution.create({ data: { groupId, userId: memberId, cycleNumber: group.currentCycle, amount: group.contributionAmount, dueDate: new Date(Date.now() + group.cycleDurationDays * 24 * 60 * 60 * 1000), status: 'PENDING' } });
      }
      await tx.auditLog.create({ data: { actorId: adminId, action: 'MEMBER_REINSTATED', entityType: 'GROUP_MEMBER', entityId: groupId, metadata: { memberId, newPayoutPosition } } });
    });
    await this.notificationsService.create({ userId: memberId, type: 'MEMBER_APPROVED', title: 'Reinstated to group', body: `You have been reinstated in ${group.name}`, data: { groupId } }).catch(() => {});
    return { message: 'Member reinstated', newPayoutPosition };
  }
  async makeContribution(userId: string, groupId: string, dto: MakeContributionDto, idempotencyKey?: string) {
    if (idempotencyKey) {
      const cached = await this.prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
      if (cached) return JSON.parse(cached.response as string);
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { transactionPinHash: true } });
    if (!user?.transactionPinHash) throw new BadRequestException('No transaction PIN set. Please set a PIN first.');
    const pinValid = await this.verifyPin(dto.pin, user.transactionPinHash);
    if (!pinValid) throw new ForbiddenException('Invalid transaction PIN');
    const reference = idempotencyKey ? `CONTRIB-${idempotencyKey}` : `CONTRIB-${groupId}-${userId}-${nanoid(16)}`;
    const result = await this.prisma.executeTransaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: groupId } });
      if (!group) throw new NotFoundException('Group not found');
      if (group.status !== 'ACTIVE') {
        // A group paused for a grace period must still let the DEFAULTING
        // member pay — otherwise it deadlocks: paused because they owe,
        // but they can't pay because it's paused. Anyone else still can't
        // pay while paused; only the person whose missed contribution
        // triggered the pause is allowed through.
        const ownGrace = group.status === 'PAUSED'
          ? await tx.gracePeriod.findFirst({ where: { groupId, userId, status: 'ACTIVE' } })
          : null;
        if (!ownGrace) throw new BadRequestException('Group is not active');
      }
      const member = await tx.groupMember.findFirst({ where: { groupId, userId, status: 'ACTIVE' } });
      if (!member) throw new ForbiddenException('Not an active member');
      const alreadyPaid = await tx.contribution.findFirst({ where: { groupId, userId, cycleNumber: group.currentCycle, status: 'PAID' } });
      if (alreadyPaid) throw new ConflictException('Contribution already paid for this cycle');
      const pendingContrib = await tx.contribution.findFirst({ where: { groupId, userId, cycleNumber: group.currentCycle, status: { in: ['PENDING','OVERDUE'] } } });
      if (!pendingContrib) throw new BadRequestException('No pending contribution for this cycle');
      const amount = BigInt(Number(pendingContrib.amount));
      const deducted = await tx.$executeRaw`UPDATE wallets SET balance = balance - ${amount}, "updatedAt" = NOW() WHERE "userId" = ${userId} AND balance >= ${amount}`;
      if (deducted === 0) throw new BadRequestException('Insufficient wallet balance');
      await tx.group.update({ where: { id: groupId }, data: { poolBalance: { increment: amount } } });
      await tx.contribution.update({ where: { id: pendingContrib.id }, data: { status: 'PAID', paidAt: new Date() } });
      const wallet = await tx.wallet.findUnique({ where: { userId }, select: { id: true } });
      await tx.walletTransaction.create({ data: { walletId: wallet!.id, userId, type: 'CONTRIBUTION', amount, status: 'COMPLETED', reference, metadata: { groupId, cycleNumber: group.currentCycle } } });
      await tx.groupMember.updateMany({ where: { groupId, userId }, data: { totalPaid: { increment: amount } } });
      const isOnTime = new Date() <= pendingContrib.dueDate;
      // FIX: totalContributed was never incremented anywhere — Profile page
      // read this field directly as a fallback and it stayed 0 forever
      // regardless of how many contributions a user actually made.
      await tx.user.update({ where: { id: userId }, data: { totalContributed: { increment: amount } } });
      // FIX: reputationScore was incremented/decremented with no bounds —
      // nothing stopped it going negative or past 1000, even though the
      // frontend Trust Score is built entirely around a fixed 0-1000
      // scale with 5 tiers. adjustReputationScore clamps it every time.
      await this.usersService.adjustReputationScore(userId, isOnTime ? 2 : -2, tx);
      await tx.auditLog.create({ data: { actorId: userId, action: 'CONTRIBUTION_PAID', entityType: 'CONTRIBUTION', entityId: pendingContrib.id, metadata: { groupId, cycleNumber: group.currentCycle, amount: Number(amount), reference } } });
      return { message: 'Contribution paid', amount: Number(amount) / 100, cycle: group.currentCycle, reference, contributionId: pendingContrib.id, _ownerId: group.ownerId, _groupSlug: group.slug, _cycleNumber: group.currentCycle };
    // Bumped from the default 10s to 20s — see Stage 6 note at the top of
    // this file for why. Everything above is unchanged.
    }, { timeout: 20000 });
    const { _ownerId, _groupSlug, _cycleNumber, contributionId, ...publicResult } = result;
    // Money has already moved and the contribution is already marked PAID at this point —
    // everything below is a side effect (notifications, payout processing) and must NOT
    // block the HTTP response. Awaiting these here previously made this endpoint take
    // 10-14+ seconds (payout processing notifies every group member one-by-one), which
    // caused the frontend to time out and show a false "Invalid PIN" error even though
    // the contribution had already succeeded on the backend. Fire-and-forget instead.
    //
    // IMPORTANT ORDERING (Stage 5 fix): grace resolution MUST finish before the
    // payout check runs. _executePayoutUnderLock() silently no-ops whenever the
    // group isn't status 'ACTIVE', and it's resolveGracePeriod() that flips a
    // PAUSED group back to ACTIVE after a late catch-up payment. Firing these
    // independently (as before) meant the payout check could read the group as
    // still PAUSED a moment before the grace period resolved — and since nothing
    // ever re-checks that cycle afterwards, the payout was dropped silently even
    // though every contribution was PAID and the pool was full. Wrapping both in
    // one sequential async block (still not awaited here, so the response isn't
    // delayed) guarantees the group is back to ACTIVE, if it's going to be,
    // before we ask whether a payout should fire.
    if (idempotencyKey) {
      this.prisma.idempotencyKey.create({ data: { key: idempotencyKey, response: JSON.stringify(publicResult), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }).catch((err) => console.error('[makeContribution] idempotency key save failed:', err));
    }
    this.notificationsService.create({ userId: result._ownerId, type: 'CONTRIBUTION_PAID', title: 'Contribution received', body: `A member paid their cycle ${result._cycleNumber} contribution`, data: { groupId, groupSlug: result._groupSlug, cycleNumber: result._cycleNumber } }).catch(() => {});
    (async () => {
      try {
        await this.graceService.resolveGracePeriod(groupId, userId, result.contributionId);
      } catch (err) {
        console.error('[makeContribution] resolveGracePeriod failed:', err);
      }
      try {
        await this.checkAndTriggerPayout(groupId, result._cycleNumber);
      } catch (err) {
        console.error('[makeContribution] checkAndTriggerPayout failed:', err);
      }
      try {
        await this.usersService.checkAndAwardBadges(userId);
      } catch (err) {
        console.error('[makeContribution] checkAndAwardBadges failed:', err);
      }
    })();
    return publicResult;
  }
  async processPayout(groupId: string, cycleNumber: number) {
    const [{ locked }] = await this.prisma.$queryRaw<[{ locked: boolean }]>`SELECT pg_try_advisory_lock(hashtext(${groupId})) AS locked`;
    if (!locked) return;
    try { await this._executePayoutUnderLock(groupId, cycleNumber); }
    finally { await this.prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext(${groupId}))`; }
  }
  private async _executePayoutUnderLock(groupId: string, cycleNumber: number) {
    const payoutResult = await this.prisma.executeTransaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: groupId } });
      if (!group || group.status !== 'ACTIVE') return null;
      const existingPayout = await tx.payout.findFirst({ where: { groupId, cycleNumber, status: { in: ['COMPLETED','PROCESSING','SCHEDULED'] } } });
      const scheduledStub = existingPayout?.status === 'SCHEDULED' ? existingPayout : null;
      if (existingPayout && existingPayout.status !== 'SCHEDULED') return null;
      // Multi-rotation support: match the recipient by payoutPosition modulo
      // member count, so cycle (maxMembers + 1) wraps back to position 1
      // instead of finding nobody and pausing the group.
      const effectivePosition = ((cycleNumber - 1) % group.maxMembers) + 1;
      const recipientMember = await tx.groupMember.findFirst({ where: { groupId, payoutPosition: effectivePosition, status: 'ACTIVE' }, include: { user: { select: { id: true, firstName: true, lastName: true } } } });
      if (!recipientMember) {
        await tx.group.update({ where: { id: groupId }, data: { status: 'PAUSED' } });
        await tx.auditLog.create({ data: { actorId: 'SYSTEM', action: 'PAYOUT_BLOCKED_NO_RECIPIENT', entityType: 'GROUP', entityId: groupId, metadata: { cycleNumber, effectivePosition, reason: 'No active member at payout position' } } });
        return { blocked: true, groupId, cycleNumber, ownerId: group.ownerId };
      }
      const agg = await tx.contribution.aggregate({ where: { groupId, cycleNumber, status: 'PAID' }, _sum: { amount: true } });
      const poolAmount = agg._sum.amount ?? BigInt(0);
      if (poolAmount === 0n) return null;
      if (group.poolBalance < poolAmount) { await tx.auditLog.create({ data: { actorId: 'SYSTEM', action: 'PAYOUT_POOL_MISMATCH', entityType: 'GROUP', entityId: groupId, metadata: { cycleNumber, poolBalance: Number(group.poolBalance), poolAmount: Number(poolAmount) } } }); throw new Error('Pool balance mismatch'); }
      const recipientWallet = await tx.wallet.findUnique({ where: { userId: recipientMember.userId } });
      if (!recipientWallet) throw new Error('Recipient wallet not found');
      const reference = `PAYOUT-${groupId}-${cycleNumber}-${nanoid(10)}`;
      let payout: any;
      if (scheduledStub) { payout = await tx.payout.update({ where: { id: scheduledStub.id }, data: { status: 'PROCESSING', amount: poolAmount, reference } }); }
      else { payout = await tx.payout.create({ data: { groupId, recipientId: recipientMember.userId, cycleNumber, amount: poolAmount, status: 'PROCESSING', scheduledDate: new Date(), reference } }); }
      await tx.wallet.update({ where: { userId: recipientMember.userId }, data: { balance: { increment: poolAmount } } });
      await tx.group.update({ where: { id: groupId }, data: { poolBalance: { decrement: poolAmount } } });
      await tx.walletTransaction.create({ data: { walletId: recipientWallet.id, userId: recipientMember.userId, type: 'PAYOUT', amount: poolAmount, status: 'COMPLETED', reference, metadata: { groupId, cycleNumber, payoutId: payout.id } } });
      await tx.payout.update({ where: { id: payout.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      // FIX: same issue as totalContributed above — totalReceived was
      // never incremented on payout, so Total Payouts always showed ₦0.
      await tx.user.update({ where: { id: recipientMember.userId }, data: { totalReceived: { increment: poolAmount } } });
      // Clamped reputation adjustment — see the note in makeContribution.
      await this.usersService.adjustReputationScore(recipientMember.userId, 5, tx);
      await tx.auditLog.create({ data: { actorId: 'SYSTEM', action: 'PAYOUT_PROCESSED', entityType: 'PAYOUT', entityId: payout.id, metadata: { groupId, cycleNumber, recipientId: recipientMember.userId, amount: Number(poolAmount), reference } } });
      return { success: true, poolAmount, groupName: group.name, groupSlug: group.slug, recipientUserId: recipientMember.userId, recipientFirstName: recipientMember.user.firstName, groupId, cycleNumber };
    });
    if (!payoutResult) return;
    if ('blocked' in payoutResult && payoutResult.blocked) { await this.notificationsService.create({ userId: payoutResult.ownerId, type: 'PAYOUT_BLOCKED', title: 'Payout blocked', body: `Cycle ${payoutResult.cycleNumber} payout could not be processed. Group paused.`, data: { groupId: payoutResult.groupId, cycleNumber: payoutResult.cycleNumber } }).catch(() => {}); return; }
    if (!('success' in payoutResult)) return;
    await this.notificationsService.create({ userId: payoutResult.recipientUserId, type: 'PAYOUT_RECEIVED', title: 'Payout received!', body: `NGN ${(Number(payoutResult.poolAmount)/100).toLocaleString()} sent to your wallet from ${payoutResult.groupName}`, data: { groupId, groupSlug: payoutResult.groupSlug, cycleNumber: payoutResult.cycleNumber, amount: Number(payoutResult.poolAmount) / 100 } }).catch(() => {});
    const members = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' } });
    await Promise.allSettled(members.filter(m => m.userId !== payoutResult.recipientUserId).map(m => this.notificationsService.create({ userId: m.userId, type: 'PAYOUT_SCHEDULED', title: 'Payout sent', body: `${payoutResult.recipientFirstName} received the payout for cycle ${payoutResult.cycleNumber} of ${payoutResult.groupName}`, data: { groupId, cycleNumber: payoutResult.cycleNumber } })));

    // PERFECT_CYCLE badge — now that this cycle's payout has actually
    // completed, award it to every active member who paid THIS cycle's
    // contribution on or before its due date.
    try {
      const cycleContribs = await this.prisma.contribution.findMany({
        where: { groupId, cycleNumber: payoutResult.cycleNumber, status: 'PAID' },
        select: { userId: true, paidAt: true, dueDate: true },
      });
      const onTimeUserIds = cycleContribs.filter(c => c.paidAt && c.paidAt <= c.dueDate).map(c => c.userId);
      await Promise.allSettled(onTimeUserIds.map(uid => this.usersService.awardBadgeIfMissing(uid, 'PERFECT_CYCLE')));
    } catch (err) {
      console.error('[_executePayoutUnderLock] PERFECT_CYCLE badge check failed:', err);
    }

    await this.advanceCycle(groupId, payoutResult.cycleNumber);
  }
  private async advanceCycle(groupId: string, completedCycle: number) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return;
    const nextCycle = completedCycle + 1;
    if (nextCycle > group.totalCycles) {
      await this.prisma.executeTransaction(async (tx) => {
        await tx.group.update({ where: { id: groupId }, data: { status: 'COMPLETED', currentCycle: completedCycle } });
        await tx.auditLog.create({ data: { actorId: 'SYSTEM', action: 'GROUP_COMPLETED', entityType: 'GROUP', entityId: groupId, metadata: { totalCycles: group.totalCycles, completedAt: new Date() } } });
      });
      await this.notifyAllMembersById(groupId, 'GROUP_ARCHIVED', 'Group completed!', `${group.name} has completed all cycles.`);
      return;
    }
    const scheduledNext = group.nextContributionDate ?? new Date();
    const msPerCycle = group.cycleDurationDays * 24 * 60 * 60 * 1000;
    const nextDueDate = new Date(scheduledNext.getTime() + msPerCycle);
    const nextCycleEnd = new Date(nextDueDate.getTime() + msPerCycle);
    await this.prisma.executeTransaction(async (tx) => {
      await tx.group.update({ where: { id: groupId }, data: { currentCycle: nextCycle, nextContributionDate: nextDueDate } });
      await tx.groupCycle.upsert({ where: { groupId_cycleNumber: { groupId, cycleNumber: nextCycle } }, create: { groupId, cycleNumber: nextCycle, startDate: new Date(), endDate: nextCycleEnd }, update: { startDate: new Date(), endDate: nextCycleEnd } });
      await tx.$executeRaw`INSERT INTO contributions (id, "groupId", "userId", "cycleNumber", amount, "dueDate", status, "createdAt", "updatedAt") SELECT gen_random_uuid(), ${groupId}, gm."userId", ${nextCycle}, ${group.contributionAmount}, ${nextDueDate}, 'PENDING', NOW(), NOW() FROM group_members gm WHERE gm."groupId" = ${groupId} AND gm.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c."groupId" = ${groupId} AND c."userId" = gm."userId" AND c."cycleNumber" = ${nextCycle})`;
      await tx.auditLog.create({ data: { actorId: 'SYSTEM', action: 'CYCLE_ADVANCED', entityType: 'GROUP', entityId: groupId, metadata: { fromCycle: completedCycle, toCycle: nextCycle } } });
    });
    await this.notifyAllMembersById(groupId, 'CONTRIBUTION_DUE', `Cycle ${nextCycle} started`, `Contributions for cycle ${nextCycle} of ${group.name} are now due`);
  }
  private async checkAndTriggerPayout(groupId: string, cycleNumber: number) {
    const required = await this.prisma.contribution.count({ where: { groupId, cycleNumber, status: { not: 'CANCELLED' } } });
    const totalPaid = await this.prisma.contribution.count({ where: { groupId, cycleNumber, status: 'PAID' } });
    if (totalPaid >= required && required > 0) await this.processPayout(groupId, cycleNumber);
  }
  async startGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Only owner can start group');
    if (group.status !== 'DRAFT') throw new BadRequestException('Group is already started');
    const memberCount = await this.prisma.groupMember.count({ where: { groupId, status: 'ACTIVE' } });
    if (memberCount < 2) throw new BadRequestException('Need at least 2 members to start');
    // Contribution for cycle 1 is due at the end of the cycle (cycleDurationDays).
    const dueDate = new Date(Date.now() + group.cycleDurationDays * 24 * 60 * 60 * 1000);
    const members = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' } });
    await this.prisma.executeTransaction(async (tx) => {
      const updated = await tx.$executeRaw`UPDATE groups SET status = 'ACTIVE', "currentCycle" = 1, "nextContributionDate" = ${dueDate}, "updatedAt" = NOW() WHERE id = ${groupId} AND status = 'DRAFT'`;
      if (updated === 0) throw new BadRequestException('Group was already started');
      await tx.groupCycle.upsert({ where: { groupId_cycleNumber: { groupId, cycleNumber: 1 } }, create: { groupId, cycleNumber: 1, startDate: new Date(), endDate: dueDate }, update: { startDate: new Date() } });
      await tx.$executeRaw`INSERT INTO contributions (id, "groupId", "userId", "cycleNumber", amount, "dueDate", status, "createdAt", "updatedAt") SELECT gen_random_uuid(), ${groupId}, gm."userId", 1, ${group.contributionAmount}, ${dueDate}, 'PENDING', NOW(), NOW() FROM group_members gm WHERE gm."groupId" = ${groupId} AND gm.status = 'ACTIVE' ON CONFLICT ("groupId", "userId", "cycleNumber") DO UPDATE SET "dueDate" = EXCLUDED."dueDate", status = 'PENDING', "updatedAt" = NOW()`;
      const cycle1Recipient = members.find(m => m.payoutPosition === 1);
      if (cycle1Recipient) { await tx.$executeRaw`INSERT INTO payouts (id, "groupId", "recipientId", "cycleNumber", amount, status, "scheduledDate", reference, "createdAt", "updatedAt") VALUES (gen_random_uuid(), ${groupId}, ${cycle1Recipient.userId}, 1, ${group.contributionAmount * BigInt(memberCount)}, 'SCHEDULED', ${dueDate}, ${'PAYOUT-SCHED-' + groupId + '-1'}, NOW(), NOW()) ON CONFLICT DO NOTHING`; }
      await tx.auditLog.create({ data: { actorId: userId, action: 'GROUP_STARTED', entityType: 'GROUP', entityId: groupId, metadata: { memberCount, startedAt: new Date() } } });
    });
    await this.notifyAllMembersById(groupId, 'GROUP_UPDATED', `${group.name} has started!`, `Cycle 1 is now active. Contributions are due by ${dueDate.toLocaleDateString()}`);
    return { message: 'Group started', currentCycle: 1 };
  }
  async deleteGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Only the group owner can delete this group');
    if (group.status !== 'DRAFT') throw new BadRequestException('Only groups that have not been launched can be deleted. Archive it instead.');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.groupMember.deleteMany({ where: { groupId } });
      await tx.inviteLink.deleteMany({ where: { groupId } });
      await tx.auditLog.create({ data: { actorId: userId, action: 'GROUP_DELETED', entityType: 'GROUP', entityId: groupId, metadata: { name: group.name } } });
      await tx.group.delete({ where: { id: groupId } });
    });
    return { message: 'Group deleted' };
  }
  async freezeGroup(actorId: string, groupId: string, reason: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'PAUSED' as any, frozenByAdminId: actorId, frozenReason: reason } as any });
    await this.prisma.auditLog.create({ data: { actorId, action: 'GROUP_FROZEN', entityType: 'GROUP', entityId: groupId, metadata: { groupName: group.name, reason, frozenBy: actorId } } });
    await this.notifyAllMembersById(groupId, 'GROUP_UPDATED', 'Group frozen by admin', `${group.name} has been suspended by an administrator: ${reason}`);
    return { message: 'Group frozen' };
  }
  async unfreezeGroup(actorId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (!(group as any).frozenByAdminId) throw new BadRequestException('This group was not frozen by an admin');
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'ACTIVE' as any, frozenByAdminId: null, frozenReason: null } as any });
    await this.prisma.auditLog.create({ data: { actorId, action: 'GROUP_UNFROZEN', entityType: 'GROUP', entityId: groupId, metadata: { groupName: group.name, unFrozenBy: actorId } } });
    await this.notifyAllMembersById(groupId, 'GROUP_UPDATED', 'Group unfrozen', `${group.name} has been reactivated by an administrator`);
    // Safety net: an admin unfreeze can also unblock a cycle whose payout
    // was missed while paused. Harmless no-op if nothing is actually due.
    this.checkAndTriggerPayout(groupId, group.currentCycle).catch((err) => console.error('[unfreezeGroup] checkAndTriggerPayout failed:', err));
    return { message: 'Group unfrozen' };
  }
  async pauseGroup(userId: string, groupId: string) {
    await this.requireOwner(userId, groupId);
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'PAUSED' as any } });
    await this.notifyAllMembersById(groupId, 'GROUP_UPDATED', 'Group paused', 'The group has been temporarily paused');
    return { message: 'Group paused' };
  }
  async resumeGroup(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Only the group owner can perform this action');
    if ((group as any).frozenByAdminId) throw new ForbiddenException('This group was frozen by an admin. Only admins can unfreeze it.');
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'ACTIVE' as any } });
    await this.notifyAllMembersById(groupId, 'GROUP_UPDATED', 'Group resumed', 'The group is now active again');
    // Safety net (Stage 5 fix): if a payout was missed for the current cycle
    // while the group was paused — e.g. the race condition between grace
    // resolution and the payout check — this re-checks and fires it now
    // instead of leaving it stuck forever. No-ops harmlessly if nothing's due.
    this.checkAndTriggerPayout(groupId, group.currentCycle).catch((err) => console.error('[resumeGroup] checkAndTriggerPayout failed:', err));
    return { message: 'Group resumed' };
  }
  async archiveGroup(userId: string, groupId: string) {
    await this.requireOwner(userId, groupId);
    await this.prisma.group.update({ where: { id: groupId }, data: { status: 'ARCHIVED' as any } });
    await this.notifyAllMembersById(groupId, 'GROUP_ARCHIVED', 'Group archived', 'This group has been archived');
    return { message: 'Group archived' };
  }
  async updateGroupSettings(userId: string, groupId: string, dto: UpdateGroupSettingsDto) {
    await this.requireAdmin(userId, groupId);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.chatEnabled !== undefined) data.chatEnabled = dto.chatEnabled;
    if (dto.autoApproveMembers !== undefined) data.autoApproveMembers = dto.autoApproveMembers;
    if (dto.penaltyAmount !== undefined) data.penaltyAmount = BigInt(Math.round(dto.penaltyAmount * 100));
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    await this.prisma.executeTransaction(async (tx) => {
      await tx.group.update({ where: { id: groupId }, data });
      await tx.auditLog.create({ data: { actorId: userId, action: 'GROUP_UPDATED', entityType: 'GROUP', entityId: groupId, metadata: dto as any } });
    });
    await this.notifyAllMembersById(groupId, 'GROUP_UPDATED', 'Group settings updated', 'Group settings have been updated');
    return { message: 'Group updated' };
  }
  async transferOwnership(userId: string, groupId: string, dto: TransferOwnershipDto) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Only the owner can transfer ownership');
    const ownerPendingCount = await this.prisma.contribution.count({ where: { groupId, userId, status: { in: ['PENDING','OVERDUE'] } } });
    if (ownerPendingCount > 0) throw new BadRequestException('Settle your outstanding contributions before transferring ownership');
    const newOwnerMember = await this.prisma.groupMember.findFirst({ where: { groupId, userId: dto.newOwnerId, status: 'ACTIVE' }, include: { user: { select: { firstName: true, lastName: true } } } });
    if (!newOwnerMember) throw new BadRequestException('New owner must be an active member');
    await this.prisma.executeTransaction(async (tx) => {
      await tx.group.update({ where: { id: groupId }, data: { ownerId: dto.newOwnerId } });
      await tx.groupMember.updateMany({ where: { groupId, userId: dto.newOwnerId }, data: { role: 'ADMIN' } });
      await tx.groupMember.updateMany({ where: { groupId, userId }, data: { role: 'MEMBER' } });
      await tx.auditLog.create({ data: { actorId: userId, action: 'OWNERSHIP_TRANSFERRED', entityType: 'GROUP', entityId: groupId, metadata: { previousOwnerId: userId, newOwnerId: dto.newOwnerId } } });
    });
    await this.notifyAllMembersById(groupId, 'OWNERSHIP_TRANSFERRED', 'Group ownership transferred', `${group.name} has a new admin: ${newOwnerMember.user.firstName} ${newOwnerMember.user.lastName}`);
    return { message: 'Ownership transferred' };
  }
  async reorderPayouts(adminId: string, groupId: string, dto: ReorderPayoutDto) {
    await this.requireAdmin(adminId, groupId);
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (group.currentCycle > 0) throw new BadRequestException('Payout order cannot be changed after cycles have started');
    const activeMembers = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' }, select: { userId: true } });
    const activeMemberIds = new Set(activeMembers.map(m => m.userId));
    if (dto.memberIds.length !== activeMemberIds.size) throw new BadRequestException(`memberIds must contain all ${activeMemberIds.size} active members`);
    for (const id of dto.memberIds) { if (!activeMemberIds.has(id)) throw new BadRequestException(`User ${id} is not an active member`); }
    const uniqueIds = new Set(dto.memberIds);
    if (uniqueIds.size !== dto.memberIds.length) throw new BadRequestException('memberIds contains duplicates');
    await this.prisma.executeTransaction(async (tx) => {
      for (let i = 0; i < dto.memberIds.length; i++) { await tx.groupMember.updateMany({ where: { groupId, userId: dto.memberIds[i] }, data: { payoutPosition: i + 1 } }); }
      await tx.auditLog.create({ data: { actorId: adminId, action: 'PAYOUT_ORDER_CHANGED', entityType: 'GROUP', entityId: groupId, metadata: { newOrder: dto.memberIds } } });
    });
    return { message: 'Payout queue updated' };
  }
  async generateInviteLink(userId: string, groupId: string, maxUses?: number, expiresInDays?: number) {
    await this.requireAdmin(userId, groupId);
    const link = await this.prisma.inviteLink.create({ data: { groupId, createdById: userId, code: nanoid(12), maxUses: maxUses || null, expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null } });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return { code: link.code, url: `${frontendUrl}/join/${link.code}`, expiresAt: link.expiresAt };
  }
  async getPayoutHistory(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId, status: { in: ['ACTIVE', 'REMOVED', 'LEFT'] } } });
    if (!member) throw new ForbiddenException('Not a group member');
    const payouts = await this.prisma.payout.findMany({
      where: { groupId },
      orderBy: { cycleNumber: 'asc' },
      include: { recipient: { select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    return payouts.map(p => ({ ...p, amount: Number(p.amount) / 100 }));
  }

  async getMyPendingContributions(userId: string) {
    const contributions = await this.prisma.contribution.findMany({ where: { userId, status: { in: ['PENDING','OVERDUE'] } }, include: { group: { select: { id: true, name: true, slug: true, contributionAmount: true } } }, orderBy: { dueDate: 'asc' } });
    return contributions.map(c => ({ ...c, amount: Number(c.amount) / 100, group: { ...c.group, contributionAmount: Number(c.group.contributionAmount) / 100 } }));
  }
  async getGroupHealth(adminId: string, groupId: string) {
    await this.requireAdmin(adminId, groupId);
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    const [totalMembers, contributions, payouts, overdueContribs] = await Promise.all([
      this.prisma.groupMember.count({ where: { groupId, status: 'ACTIVE' } }),
      this.prisma.contribution.findMany({ where: { groupId, cycleNumber: group.currentCycle } }),
      this.prisma.payout.findMany({ where: { groupId } }),
      this.prisma.contribution.findMany({ where: { groupId, status: 'OVERDUE' }, include: { user: { select: { firstName: true, lastName: true, username: true } } } }),
    ]);
    const paidThisCycle = contributions.filter(c => c.status === 'PAID').length;
    const collectionRate = totalMembers > 0 ? Math.round((paidThisCycle / totalMembers) * 100) : 0;
    const totalCollected = contributions.filter(c => c.status === 'PAID').reduce((s, c) => s + Number(c.amount), 0);
    const totalPaidOut = payouts.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + Number(p.amount), 0);
    return { groupStatus: group.status, currentCycle: group.currentCycle, totalCycles: group.totalCycles, totalMembers, collectionRate, paidThisCycle, pendingThisCycle: totalMembers - paidThisCycle, totalCollected: totalCollected / 100, totalPaidOut: totalPaidOut / 100, poolBalance: Number(group.poolBalance || 0) / 100, overdueMembers: overdueContribs.map(c => ({ userId: c.userId, name: `${c.user.firstName} ${c.user.lastName}`, username: c.user.username, dueDate: c.dueDate, amount: Number(c.amount) / 100 })), riskIndicator: collectionRate < 70 ? 'HIGH' : collectionRate < 90 ? 'MEDIUM' : 'LOW', pendingPayouts: payouts.filter(p => p.status === 'SCHEDULED').length };
  }
  async getGroupAnalytics(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId, status: 'ACTIVE' } });
    if (!member) throw new ForbiddenException('Not a group member');
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    const [totalMembersResult, paidThisCycleResult, totalCollectedResult, totalPaidOutResult] = await Promise.all([
      this.prisma.groupMember.count({ where: { groupId, status: 'ACTIVE' } }),
      this.prisma.contribution.count({ where: { groupId, cycleNumber: group.currentCycle, status: 'PAID' } }),
      this.prisma.contribution.aggregate({ where: { groupId, status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.payout.aggregate({ where: { groupId, status: 'COMPLETED' }, _sum: { amount: true } }),
    ]);
    const totalMembers = totalMembersResult;
    const paidThisCycle = paidThisCycleResult;
    const totalCollected = Number(totalCollectedResult._sum.amount ?? 0);
    const totalPaidOut = Number(totalPaidOutResult._sum.amount ?? 0);
    const collectionRate = totalMembers > 0 ? (paidThisCycle / totalMembers) * 100 : 0;
    const weeklyData = await this.prisma.$queryRaw<any[]>`SELECT DATE_TRUNC('week', "paidAt") AS week, SUM(amount) AS collected FROM contributions WHERE "groupId" = ${groupId} AND status = 'PAID' GROUP BY week ORDER BY week DESC LIMIT 8`;
    return { overview: { totalMembers, currentCycle: group.currentCycle, totalCycles: group.totalCycles, collectionRate: Math.round(collectionRate), totalCollected: totalCollected / 100, totalPaidOut: totalPaidOut / 100, paidThisCycle, pendingThisCycle: totalMembers - paidThisCycle, poolBalance: Number(group.poolBalance || 0) / 100 }, weeklyData: weeklyData.map(w => ({ week: w.week, collected: Number(w.collected) / 100, target: Number(group.contributionAmount) * totalMembers / 100 })) };
  }
  @Cron(CronExpression.EVERY_HOUR)
  async handleOverdueContributions() {
    const overdue = await this.prisma.$queryRaw<any[]>`SELECT c.*, g.name AS group_name, g.slug AS group_slug, g."ownerId" AS owner_id, g."penaltyAmount" AS penalty_amount FROM contributions c JOIN groups g ON g.id = c."groupId" WHERE c.status = 'PENDING' AND c."dueDate" < NOW() LIMIT 500 FOR UPDATE OF c SKIP LOCKED`;
    const notificationJobs: Array<() => Promise<any>> = [];
    for (const contrib of overdue) {
      try {
        await this.prisma.executeTransaction(async (tx) => {
          const fresh = await tx.$queryRaw<any[]>`SELECT id, status FROM contributions WHERE id = ${contrib.id} FOR UPDATE`;
          if (!fresh[0] || fresh[0].status !== 'PENDING') return;
          await tx.$executeRaw`UPDATE contributions SET status = 'OVERDUE', "updatedAt" = NOW() WHERE id = ${contrib.id}`;
          if (Number(contrib.penalty_amount) > 0) {
            const penaltyAmount = BigInt(Number(contrib.penalty_amount));
            const deducted = await tx.$executeRaw`UPDATE wallets SET balance = balance - ${penaltyAmount}, "updatedAt" = NOW() WHERE "userId" = ${contrib.userId} AND balance >= ${penaltyAmount}`;
            const penaltyStatus = deducted > 0 ? 'COMPLETED' : 'FAILED';
            const walletRow = await tx.wallet.findUnique({ where: { userId: contrib.userId }, select: { id: true } });
            if (walletRow) { await tx.walletTransaction.create({ data: { walletId: walletRow.id, userId: contrib.userId, type: 'PENALTY', amount: penaltyAmount, status: penaltyStatus, reference: `PENALTY-${contrib.id}-${nanoid(8)}`, metadata: { groupId: contrib.groupId, cycleNumber: contrib.cycleNumber, contributionId: contrib.id } } }); }
            // Route the collected penalty into the platform revenue (SYSTEM) wallet instead of it vanishing.
            if (deducted > 0) {
              const systemWallet = await tx.wallet.findUnique({ where: { userId: 'SYSTEM' }, select: { id: true, balance: true } });
              if (systemWallet) {
                await tx.wallet.update({ where: { userId: 'SYSTEM' }, data: { balance: { increment: penaltyAmount } } });
                await tx.walletTransaction.create({ data: { walletId: systemWallet.id, userId: 'SYSTEM', type: 'PENALTY', amount: penaltyAmount, status: 'COMPLETED', reference: `PENALTY-REVENUE-${contrib.id}-${nanoid(8)}`, metadata: { source: 'late_penalty_fee', fromUserId: contrib.userId, groupId: contrib.groupId, contributionId: contrib.id } } });
              }
            }
          }
          await tx.user.update({ where: { id: contrib.userId }, data: { reputationScore: { decrement: 3 } } });
          await tx.auditLog.create({ data: { actorId: 'SYSTEM', action: 'CONTRIBUTION_OVERDUE', entityType: 'CONTRIBUTION', entityId: contrib.id, metadata: { groupId: contrib.groupId, userId: contrib.userId, cycleNumber: contrib.cycleNumber } } });
        });
        await this.graceService.startGracePeriod(contrib.groupId, contrib.userId, contrib.id).catch(() => {});
        notificationJobs.push(() => this.notificationsService.create({ userId: contrib.userId, type: 'CONTRIBUTION_DUE', title: 'Contribution overdue', body: `Your contribution for cycle ${contrib.cycleNumber} of ${contrib.group_name} is overdue`, data: { groupId: contrib.groupId, groupSlug: contrib.group_slug } }));
        notificationJobs.push(() => this.notificationsService.create({ userId: contrib.owner_id, type: 'CONTRIBUTION_DUE', title: 'Member contribution overdue', body: `A member contribution for cycle ${contrib.cycleNumber} is overdue in ${contrib.group_name}`, data: { groupId: contrib.groupId } }));
      } catch (err) { console.error(`[handleOverdueContributions] Failed for contribution ${contrib.id}:`, err); }
    }
    await Promise.allSettled(notificationJobs.map(fn => fn()));
  }
  @Cron('0 9 * * *')
  async sendContributionReminders() {
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const upcoming = await this.prisma.contribution.findMany({ where: { status: 'PENDING', dueDate: { gte: now, lte: in3Days } }, include: { group: { select: { name: true, slug: true, ownerId: true } } } });
    await Promise.allSettled(upcoming.map(async (contrib) => {
      const daysUntilDue = Math.ceil((contrib.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const title = daysUntilDue <= 1 ? 'Contribution due tomorrow!' : `Contribution due in ${daysUntilDue} days`;
      const body = `Your NGN ${(Number(contrib.amount)/100).toLocaleString()} contribution for ${contrib.group.name} is due ${daysUntilDue <= 1 ? 'tomorrow' : `in ${daysUntilDue} days`}`;
      await this.notificationsService.create({ userId: contrib.userId, type: 'CONTRIBUTION_DUE', title, body, data: { groupId: contrib.groupId, groupSlug: contrib.group.slug, cycleNumber: contrib.cycleNumber } });
    }));
  }
  @Cron(CronExpression.EVERY_HOUR)
  async autoStartGroups() {
    const groupsToStart = await this.prisma.group.findMany({ where: { status: 'DRAFT', startDate: { lte: new Date() } } });
    await Promise.allSettled(groupsToStart.map(async (group) => {
      const memberCount = await this.prisma.groupMember.count({ where: { groupId: group.id, status: 'ACTIVE' } });
      if (memberCount >= 2) { await this.startGroup(group.ownerId, group.id).catch((err) => { if (!(err instanceof BadRequestException)) console.error('[autoStartGroups] Failed:', err); }); }
    }));
  }
  // Safety-net cron: catches any group left sitting on a fully-paid cycle
  // that never triggered a payout (e.g. the grace-period race described
  // above, before the Stage 5 fix, or any other edge case that slips
  // through). Runs hourly; harmless no-op for groups that are fine.
  @Cron(CronExpression.EVERY_HOUR)
  async catchMissedPayouts() {
    const activeGroups = await this.prisma.group.findMany({ where: { status: 'ACTIVE', currentCycle: { gt: 0 } }, select: { id: true, currentCycle: true } });
    await Promise.allSettled(activeGroups.map(g => this.checkAndTriggerPayout(g.id, g.currentCycle).catch((err) => console.error(`[catchMissedPayouts] group ${g.id} failed:`, err))));
  }
  private async promoteFromWaitlist(tx: any, groupId: string): Promise<Array<() => Promise<any>>> {
    const nextWaitlisted = await tx.groupMember.findFirst({ where: { groupId, status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' } });
    if (!nextWaitlisted) return [];
    const activeCount = await tx.groupMember.count({ where: { groupId, status: 'ACTIVE' } });
    const totalCount  = await tx.groupMember.count({ where: { groupId } });
    await tx.groupMember.update({ where: { id: nextWaitlisted.id }, data: { status: 'ACTIVE', payoutPosition: activeCount + 1, memberNumber: totalCount } });
    return [() => this.notificationsService.create({ userId: nextWaitlisted.userId, type: 'GROUP_JOIN_APPROVED', title: "You've been promoted from the waitlist!", body: 'A spot opened up and you have been added to the group', data: { groupId } })];
  }
  // Cycle length in days = the payout frequency's duration.
  private getCycleDuration(payoutFrequency: string, customDays?: number): number {
    if (payoutFrequency === 'CUSTOM' && customDays) return customDays;
    return FREQUENCY_DAYS[payoutFrequency] || 30;
  }
  // How many contribution-periods fit inside one payout window.
  // e.g. contribution DAILY (1 day) inside payout MONTHLY (30 days) = 30.
  // Never less than 1. If payout period is shorter than contribution period, clamps to 1.
  private getPeriodsPerCycle(contributionFrequency: string, payoutFrequency: string, customDays?: number): number {
    const contribDays = contributionFrequency === 'CUSTOM' ? (customDays || 1) : (FREQUENCY_DAYS[contributionFrequency] || 30);
    const payoutDays  = payoutFrequency === 'CUSTOM' ? (customDays || 30) : (FREQUENCY_DAYS[payoutFrequency] || 30);
    if (contribDays <= 0) return 1;
    const periods = Math.round(payoutDays / contribDays);
    return Math.max(1, periods);
  }
  private async requireAdmin(userId: string, groupId: string) {
    const member = await this.prisma.groupMember.findFirst({ where: { groupId, userId, status: 'ACTIVE', role: { in: ['ADMIN','MODERATOR'] } } });
    if (!member) throw new ForbiddenException('Admin access required');
    return member;
  }
  private async requireOwner(userId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');
    if (group.ownerId !== userId) throw new ForbiddenException('Only the group owner can perform this action');
    return group;
  }
  private async notifyAllMembersById(groupId: string, type: string, title: string, body: string) {
    const members = await this.prisma.groupMember.findMany({ where: { groupId, status: 'ACTIVE' } });
    await Promise.allSettled(members.map(m => this.notificationsService.create({ userId: m.userId, type, title, body, data: { groupId } })));
  }
  private async verifyPin(pin: string, transactionPinHash: string): Promise<boolean> {
    const bcrypt = await import('bcrypt');
    return bcrypt.compare(pin, transactionPinHash);
  }
  private formatGroup(group: any, requestingUserId?: string) {
    return { ...group, contributionAmount: Number(group.contributionAmount) / 100, penaltyAmount: Number(group.penaltyAmount || 0) / 100, poolBalance: Number(group.poolBalance || 0) / 100, memberCount: group._count?.members ?? 0, myMembership: requestingUserId ? (group.members?.find?.((m: any) => m.userId === requestingUserId) ?? null) : (group.members?.length === 1 ? group.members[0] : null) };
  }
}
@ApiTags('Groups')
@Controller('groups')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post() @ApiOperation({ summary: 'Create a new Ajo group (starts in DRAFT)' })
  create(@Req() req: any, @Body() dto: CreateGroupDto) { return this.groupsService.createGroup(req.user.id, dto); }

  @Get() @ApiOperation({ summary: 'List groups' })
  findAll(@Req() req: any, @Query('page') page = 1, @Query('limit') limit = 12, @Query('search') search?: string, @Query('visibility') visibility?: string) { return this.groupsService.getGroups(req.user.id, +page, +limit, search, visibility); }

  @Get('me/pending-contributions') @ApiOperation({ summary: 'Get my pending contributions across all groups' })
  myPendingContributions(@Req() req: any) { return this.groupsService.getMyPendingContributions(req.user.id); }

  @Get('invite/:code') @ApiOperation({ summary: 'Get group by invite code' })
  getByInviteCode(@Param('code') code: string) { return this.groupsService.getGroupByInviteCode(code); }

  @Get(':id/analytics') @ApiOperation({ summary: 'Group analytics' })
  getAnalytics(@Req() req: any, @Param('id') id: string) { return this.groupsService.getGroupAnalytics(req.user.id, id); }

  @Get(':id/health') @ApiOperation({ summary: 'Group health (admin)' })
  getHealth(@Req() req: any, @Param('id') id: string) { return this.groupsService.getGroupHealth(req.user.id, id); }

  @Delete(':id') @ApiOperation({ summary: 'Delete DRAFT group' })
  deleteGroup(@Req() req: any, @Param('id') id: string) { return this.groupsService.deleteGroup(req.user.id, id); }

  @Get(':slug') @ApiOperation({ summary: 'Get group by slug' })
  findOne(@Param('slug') slug: string, @Req() req: any) { return this.groupsService.getGroupBySlug(slug, req.user.id); }

  @Post(':id/start') @ApiOperation({ summary: 'Start group' })
  startGroup(@Req() req: any, @Param('id') id: string) { return this.groupsService.startGroup(req.user.id, id); }

  @Post(':id/join') @ApiOperation({ summary: 'Join group' })
  join(@Req() req: any, @Param('id') id: string, @Body() dto: JoinGroupDto) { return this.groupsService.joinGroup(req.user.id, id, dto); }

  @Post(':id/accept-agreement') @ApiOperation({ summary: 'Accept group rules before joining' })
  acceptAgreement(@Req() req: any, @Param('id') id: string, @Body() dto: AcceptAgreementDto) { return this.groupsService.acceptGroupAgreement(req.user.id, id, dto.deviceInfo, req.ip); }

  @Post(':id/leave') @ApiOperation({ summary: 'Leave group' })
  leave(@Req() req: any, @Param('id') id: string) { return this.groupsService.leaveGroup(req.user.id, id); }

  @Post(':id/contribute') @ApiOperation({ summary: 'Pay contribution from wallet' })
  contribute(@Req() req: any, @Param('id') id: string, @Body() dto: MakeContributionDto, @Headers('Idempotency-Key') idempotencyKey?: string) { return this.groupsService.makeContribution(req.user.id, id, dto, idempotencyKey); }

  @Post(':id/transfer-ownership') @ApiOperation({ summary: 'Transfer ownership' })
  transferOwnership(@Req() req: any, @Param('id') id: string, @Body() dto: TransferOwnershipDto) { return this.groupsService.transferOwnership(req.user.id, id, dto); }

  @Post(':id/members/:memberId/approve') @ApiOperation({ summary: 'Approve pending member' })
  approveMember(@Req() req: any, @Param('id') id: string, @Param('memberId') memberId: string) { return this.groupsService.approveMember(req.user.id, id, memberId); }

  @Post(':id/members/:memberId/reject') @ApiOperation({ summary: 'Reject pending member' })
  rejectMember(@Req() req: any, @Param('id') id: string, @Param('memberId') memberId: string) { return this.groupsService.rejectMember(req.user.id, id, memberId); }

  @Post(':id/members/:memberId/ban') @ApiOperation({ summary: 'Ban member' })
  banMember(@Req() req: any, @Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: BanMemberDto) { return this.groupsService.banMember(req.user.id, id, memberId, dto); }

  @Post(':id/members/:memberId/reinstate') @ApiOperation({ summary: 'Reinstate banned member' })
  reinstateMember(@Req() req: any, @Param('id') id: string, @Param('memberId') memberId: string) { return this.groupsService.reinstateMember(req.user.id, id, memberId); }

  @Delete(':id/members/:memberId') @ApiOperation({ summary: 'Remove member' })
  removeMember(@Req() req: any, @Param('id') id: string, @Param('memberId') memberId: string, @Query('reason') reason?: string) { return this.groupsService.removeMember(req.user.id, id, memberId, reason); }

  @Post(':id/invite-link') @ApiOperation({ summary: 'Generate invite link' })
  generateInvite(@Req() req: any, @Param('id') id: string, @Query('maxUses') maxUses?: number, @Query('expiresInDays') expiresInDays?: number) { return this.groupsService.generateInviteLink(req.user.id, id, maxUses ? +maxUses : undefined, expiresInDays ? +expiresInDays : undefined); }

  @Patch(':id/payout-order') @ApiOperation({ summary: 'Reorder payout queue' })
  reorderPayouts(@Req() req: any, @Param('id') id: string, @Body() dto: ReorderPayoutDto) { return this.groupsService.reorderPayouts(req.user.id, id, dto); }

  @Patch(':id/unfreeze') @ApiOperation({ summary: 'Admin unfreeze group' })
  unfreezeGroup(@Req() req: any, @Param('id') id: string) { return this.groupsService.unfreezeGroup(req.user.id, id); }

  @Post(':id/pause') @ApiOperation({ summary: 'Pause group' })
  pauseGroup(@Req() req: any, @Param('id') id: string) { return this.groupsService.pauseGroup(req.user.id, id); }

  @Post(':id/resume') @ApiOperation({ summary: 'Resume group' })
  resumeGroup(@Req() req: any, @Param('id') id: string) { return this.groupsService.resumeGroup(req.user.id, id); }

  @Post(':id/archive') @ApiOperation({ summary: 'Archive group' })
  archiveGroup(@Req() req: any, @Param('id') id: string) { return this.groupsService.archiveGroup(req.user.id, id); }

  @Patch(':id/settings') @ApiOperation({ summary: 'Update group settings' })
  updateSettings(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateGroupSettingsDto) { return this.groupsService.updateGroupSettings(req.user.id, id, dto); }

  @Get(':id/contributions/history') @ApiOperation({ summary: 'Get contributions by cycle' })
  getContributionsByCycle(@Req() req: any, @Param('id') id: string, @Query('cycle') cycle: number) { return this.groupsService.getContributionsByCycle(req.user.id, id, +cycle); }

  @Get(':id/payouts') @ApiOperation({ summary: 'Full payout history for this group, any cycle, any status' })
  getPayoutHistory(@Req() req: any, @Param('id') id: string) { return this.groupsService.getPayoutHistory(req.user.id, id); }

  @Patch(':id/contributions/:contributionId/mark-paid') @ApiOperation({ summary: 'Admin marks contribution paid' })
  markContributionPaid(@Req() req: any, @Param('id') id: string, @Param('contributionId') contributionId: string) { return this.groupsService.markContributionPaid(req.user.id, id, contributionId); }
}

@Module({
  imports: [PrismaModule, NotificationsModule, ScheduleModule.forRoot(), KycModule, GraceModule, UsersModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}