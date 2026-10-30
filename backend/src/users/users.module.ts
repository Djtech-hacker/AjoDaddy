// ============================================================
// USERS MODULE — Profiles, avatars, reputation, badges
// ============================================================
// ADDED: the badge award engine (checkAndAwardBadges / awardBadgeIfMissing).
// ADDED: adjustReputationScore() — clamps reputation to 0-1000.
// ADDED: uploadAvatarFromDataUrl() — registration avatar upload.
//
// UPDATED (this pass): date of birth + phone come from verified sources.
//   - UpdateProfileDto no longer accepts dateOfBirth (or phone, email,
//     twoFactorEnabled). DOB is written only by NIN/BVN verification.
//   - getFullProfileById() reads the viewer's own identity record and
//     shapeProfile() returns:
//        dobDisplay = "23 February" (day + month only, the YEAR is never sent)
//        phone      = users.phone, falling back to the NIN record's phone
//     The raw dateOfBirth is no longer included in any API response.
//   - Private fields are still returned ONLY when the viewer is looking
//     at their own profile.
// ============================================================

import {
  Module, Controller, Get, Patch, Post, Body, Req, Param,
  Query, UseGuards, Injectable, NotFoundException,
  BadRequestException, Logger, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v2 as cloudinary } from 'cloudinary';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsModule } from '../notifications/notifications.module';

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(50)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(50)
  lastName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  bio?: string;

  @IsOptional() @IsString() @MaxLength(200)
  streetAddress?: string;

  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @MaxLength(100)
  state?: string;

  @IsOptional() @IsString() @MaxLength(20)
  postalCode?: string;

  @IsOptional() @IsString() @MaxLength(100)
  country?: string;
}

// Friendly text for badge-earned notifications. Matches the 10 badges
// actually shown in ProfilePage.tsx's BADGE_META.
const BADGE_NOTIFICATION_TEXT: Record<string, { title: string; body: string }> = {
  FIRST_CONTRIBUTION: { title: 'Badge earned: New Saver 🌱',         body: 'You made your first contribution!' },
  STREAK_7:            { title: 'Badge earned: Early Contributor 🔥', body: 'You contributed 7 days in a row.' },
  STREAK_30:           { title: 'Badge earned: Streak Starter ⚡',    body: '30 consecutive contribution days — impressive!' },
  STREAK_90:           { title: 'Badge earned: Consistent Saver 💎',  body: '90 consecutive contribution days.' },
  PERFECT_CYCLE:       { title: 'Badge earned: Trusted Member 🏆',    body: 'You paid on time every contribution in a completed cycle.' },
  CONTRIBUTED_100K:    { title: 'Badge earned: Group Builder 👥',     body: "You've contributed ₦100,000 in total." },
  EARLY_SUPPORTER:     { title: 'Badge earned: Active Saver 🎯',      body: 'You joined a group in its first 30 days.' },
  TOP_SAVER:           { title: 'Badge earned: Cycle Champ 🥇',       body: "You're in the top 10% of all contributors." },
  VERIFIED:            { title: 'Badge earned: Reliable ✅',          body: 'Your identity is fully verified.' },
  VETERAN:             { title: 'Badge earned: Top Contributor 🎖️',   body: "You've been a member for a full year." },
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    cloudinary.config({
      cloud_name: configService.get('cloudinary.cloudName'),
      api_key:    configService.get('cloudinary.apiKey'),
      api_secret: configService.get('cloudinary.apiSecret'),
    });
  }

  // Parses the date of birth stored on the NIN/BVN record. Providers return
  // it as "1999-02-23", "23-02-1999", "23/02/1999" or similar.
  private parseDob(raw?: string | null): Date | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s); // DD-MM-YYYY or DD/MM/YYYY
    const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // ── Full profile by ID ─────────────────────────────────────
  // viewerId = the logged-in user making the request. Private fields
  // (email, phone, DOB, address, 2FA) are only returned when
  // viewerId === userId.
  async getFullProfileById(userId: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, username: true, firstName: true,
        lastName: true, phone: true, avatarUrl: true, bio: true,
        role: true, status: true, isEmailVerified: true,
        hasTransactionPin: true,
        dateOfBirth: true, streetAddress: true, city: true,
        state: true, postalCode: true, country: true,
        twoFactorEnabled: true,
        reputationScore: true, totalContributed: true,
        totalReceived: true, currentStreak: true, longestStreak: true,
        referralCode: true, createdAt: true,
        badges: { select: { type: true, earnedAt: true } },
        streak: true,
        profileStats: true,
        leaderboardRankings: {
          where: { category: 'REPUTATION' },
          take: 1,
        },
        activityFeed: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            ownedGroups: true,
            memberships: { where: { status: 'ACTIVE' } },
            contributions: { where: { status: 'PAID' } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // The NIN/BVN record is the source of truth for date of birth, and a
    // fallback for phone. Only loaded for the user's own profile.
    const isSelf = viewerId === userId;
    const identity = isSelf
      ? await this.prisma.identityRecord.findUnique({
          where: { userId },
          select: { dateOfBirth: true, phone: true },
        })
      : null;

    return this.shapeProfile(user, isSelf, identity);
  }

  // ── Full profile by username (public view — never private fields) ──
  async getFullProfileByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true, username: true, firstName: true, lastName: true,
        avatarUrl: true, bio: true, reputationScore: true,
        hasTransactionPin: true,
        totalContributed: true, totalReceived: true,
        currentStreak: true, longestStreak: true, createdAt: true,
        badges: { select: { type: true, earnedAt: true } },
        streak: true,
        profileStats: true,
        leaderboardRankings: {
          where: { category: 'REPUTATION' },
          take: 1,
        },
        activityFeed: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            ownedGroups: true,
            memberships: { where: { status: 'ACTIVE' } },
            contributions: { where: { status: 'PAID' } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.shapeProfile(user, false);
  }

  // ── Shape DB result into the exact shape ProfilePage.tsx expects ──
  private shapeProfile(
    user: any,
    includePrivate = false,
    identity?: { dateOfBirth?: string | null; phone?: string | null } | null,
  ) {
    const ps = user.profileStats;
    const streak = user.streak;
    const ranking = user.leaderboardRankings?.[0];

    return {
      id:         user.id,
      username:   user.username,
      firstName:  user.firstName,
      lastName:   user.lastName,
      bio:        user.bio ?? '',
      avatarUrl:  user.avatarUrl ?? '',
      createdAt:  user.createdAt,
      created_at: user.createdAt,
      hasTransactionPin: user.hasTransactionPin ?? false,
      reputation_score: user.reputationScore ?? 100,
      currentStreak: streak?.currentStreak ?? user.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? user.longestStreak ?? 0,
      streak: {
        userId:               user.id,
        currentStreak:        streak?.currentStreak ?? user.currentStreak ?? 0,
        longestStreak:        streak?.longestStreak ?? user.longestStreak ?? 0,
        lastContributionDate: streak?.lastContributionDate
          ? new Date(streak.lastContributionDate).toISOString().split('T')[0]
          : null,
      },
      achievements: (user.badges ?? []).map((b: any) => ({
        id:        `${user.id}-${b.type}`,
        user_id:   user.id,
        type:      b.type,
        earned_at: b.earnedAt,
      })),
      stats: {
        groups_joined:             ps?.groupsJoined             ?? user._count?.memberships ?? 0,
        groups_created:            ps?.groupsCreated            ?? user._count?.ownedGroups ?? 0,
        completed_cycles:          ps?.completedCycles          ?? user._count?.contributions ?? 0,
        on_time_payment_pct:       ps ? Number(ps.onTimePaymentPct) : 0,
        contribution_success_rate: ps ? Number(ps.contributionSuccessRate) : 0,
        total_payouts_received:    ps ? Number(ps.totalPayoutsReceived) / 100 : Number(user.totalReceived ?? 0) / 100,
        total_contributed:         ps ? Number(ps.totalContributed) / 100    : Number(user.totalContributed ?? 0) / 100,
      },
      activity: (user.activityFeed ?? []).map((a: any) => ({
        id:          a.id,
        user_id:     user.id,
        type:        a.type,
        description: a.description,
        metadata:    a.metadata ?? {},
        created_at:  a.createdAt,
      })),
      rank: ranking ? {
        user_id:         user.id,
        global_rank:     ranking.globalRank     ?? 0,
        group_rank:      ranking.groupRank      ?? 0,
        weekly_movement: ranking.weeklyMovement ?? 0,
        category:        ranking.category,
      } : {
        user_id:         user.id,
        global_rank:     0,
        group_rank:      0,
        weekly_movement: 0,
        category:        'REPUTATION',
      },

      // Private fields: own profile only.
      ...(includePrivate ? (() => {
        // NIN/BVN date of birth wins. Only day + month ever leave the server.
        const dob = this.parseDob(identity?.dateOfBirth)
          ?? (user.dateOfBirth ? new Date(user.dateOfBirth) : null);
        const validDob = dob && !isNaN(dob.getTime()) ? dob : null;
        return {
          email:            user.email,
          phone:            user.phone ?? (identity?.phone || null),
          dobDisplay:       validDob ? `${validDob.getUTCDate()} ${MONTH_NAMES[validDob.getUTCMonth()]}` : null,
          streetAddress:    user.streetAddress ?? null,
          city:             user.city ?? null,
          state:            user.state ?? null,
          postalCode:       user.postalCode ?? null,
          country:          user.country ?? null,
          twoFactorEnabled: user.twoFactorEnabled ?? false,
        };
      })() : {}),
    };
  }

  // getProfile() is the "own profile" helper, so the viewer is the user.
  async getProfile(userId: string) {
    return this.getFullProfileById(userId, userId);
  }

  async getPublicProfile(username: string) {
    return this.getFullProfileByUsername(username);
  }

  // ── Set transaction PIN (first time) ───────────────────────
  async setTransactionPin(userId: string, pin: string) {
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      throw new BadRequestException('PIN must be exactly 4 digits');
    }
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { hasTransactionPin: true },
    });
    if (existing?.hasTransactionPin) {
      throw new BadRequestException('Transaction PIN already set. Use change PIN instead.');
    }
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash(pin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { transactionPinHash: hash, hasTransactionPin: true },
    });
    return { message: 'Transaction PIN set successfully' };
  }

  // ── Update profile ─────────────────────────────────────────
  // Email, phone, date of birth and 2FA are deliberately NOT editable here.
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Record<string, any> = {};

    if (dto.firstName     !== undefined) data.firstName     = dto.firstName;
    if (dto.lastName      !== undefined) data.lastName      = dto.lastName;
    if (dto.bio           !== undefined) data.bio           = dto.bio;
    if (dto.streetAddress !== undefined) data.streetAddress = dto.streetAddress;
    if (dto.city          !== undefined) data.city          = dto.city;
    if (dto.state         !== undefined) data.state         = dto.state;
    if (dto.postalCode    !== undefined) data.postalCode    = dto.postalCode;
    if (dto.country       !== undefined) data.country       = dto.country;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No changes to save');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true, email: true, username: true, firstName: true,
        lastName: true, phone: true, avatarUrl: true, bio: true,
        streetAddress: true, city: true,
        state: true, postalCode: true, country: true,
      },
    });
  }

  // ── Avatar upload (multipart file — "change photo" route) ──
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Image must be under 5MB');
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('File must be an image');

    return new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:         'paypaddy/avatars',
          public_id:      `user_${userId}`,
          overwrite:      true,
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto:good' },
          ],
        },
        async (error, result) => {
          if (error) { reject(new BadRequestException('Upload failed')); return; }
          if (result) {
            await this.prisma.user.update({
              where: { id: userId },
              data:  { avatarUrl: result.secure_url },
            });
            resolve({ avatarUrl: result.secure_url });
          }
        },
      );
      stream.end(file.buffer);
    });
  }

  // ── Avatar upload from a base64 data URL — used at registration.
  // Deliberately swallows its own errors: a broken or oversized image
  // must never turn a successful account creation into a failure.
  async uploadAvatarFromDataUrl(userId: string, dataUrl: string) {
    if (!dataUrl?.startsWith('data:image/')) return;
    try {
      const result = await cloudinary.uploader.upload(dataUrl, {
        folder:         'paypaddy/avatars',
        public_id:      `user_${userId}`,
        overwrite:      true,
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto:good' },
        ],
      });
      await this.prisma.user.update({
        where: { id: userId },
        data:  { avatarUrl: result.secure_url },
      });
    } catch (err) {
      this.logger.error(`[uploadAvatarFromDataUrl] failed for ${userId}:`, err);
    }
  }

  // ── Claim daily streak ─────────────────────────────────────
  async claimStreak(userId: string) {
    const todayStr = new Date().toISOString().split('T')[0];

    const existing = await this.prisma.userStreak.findUnique({
      where: { userId },
    });

    const lastDate = existing?.lastContributionDate
      ? new Date(existing.lastContributionDate).toISOString().split('T')[0]
      : null;

    if (lastDate === todayStr) {
      throw new BadRequestException('Streak already claimed today');
    }

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const newStreak = lastDate === yesterdayStr
      ? (existing?.currentStreak ?? 0) + 1
      : 1;
    const longestStreak = Math.max(newStreak, existing?.longestStreak ?? 0);

    const updated = await this.prisma.userStreak.upsert({
      where:  { userId },
      create: {
        userId,
        currentStreak:        newStreak,
        longestStreak,
        lastContributionDate: new Date(),
      },
      update: {
        currentStreak:        newStreak,
        longestStreak,
        lastContributionDate: new Date(),
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data:  { currentStreak: newStreak, longestStreak },
    });

    // Fire-and-forget — a streak claim is exactly when STREAK_7/30/90
    // become true, so check right after. Doesn't block the response.
    this.checkAndAwardBadges(userId).catch((err) => this.logger.error(`[claimStreak] checkAndAwardBadges failed for ${userId}:`, err));

    return {
      userId,
      currentStreak:        updated.currentStreak,
      longestStreak:        updated.longestStreak,
      lastContributionDate: todayStr,
    };
  }

  // ── Reputation score adjustment (clamped 0-1000) ───────────
  async adjustReputationScore(userId: string, delta: number, tx?: any) {
    const db = tx ?? this.prisma;
    await db.$executeRaw`UPDATE users SET "reputationScore" = LEAST(1000, GREATEST(0, "reputationScore" + ${delta})) WHERE id = ${userId}`;
  }

  // ── Badges ─────────────────────────────────────────────────

  // Award a single badge type if the user doesn't already have it.
  // createMany + skipDuplicates makes this safe to call concurrently.
  // Returns true if this call is the one that actually awarded it.
  async awardBadgeIfMissing(userId: string, type: string, tx?: any): Promise<boolean> {
    const db = tx ?? this.prisma;
    const result = await db.userBadge.createMany({
      data: [{ userId, type: type as any }],
      skipDuplicates: true,
    });
    const awarded = result.count > 0;
    if (awarded) {
      const text = BADGE_NOTIFICATION_TEXT[type];
      if (text) {
        this.notificationsService.create({
          userId, type: 'BADGE_EARNED', title: text.title, body: text.body, data: { badgeType: type },
        }).catch((err) => this.logger.error(`[awardBadgeIfMissing] notification failed for ${userId}/${type}:`, err));
      }
    }
    return awarded;
  }

  // Checks the badges whose conditions can be evaluated from a single
  // user's own data. PERFECT_CYCLE / EARLY_SUPPORTER / TOP_SAVER are
  // handled at their own call sites (groups.module.ts, the daily cron).
  async checkAndAwardBadges(userId: string, tx?: any): Promise<string[]> {
    const db = tx ?? this.prisma;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { totalContributed: true, currentStreak: true, createdAt: true },
    });
    if (!user) return [];

    const newlyAwarded: string[] = [];
    const maybeAward = async (type: string, qualifies: boolean) => {
      if (!qualifies) return;
      if (await this.awardBadgeIfMissing(userId, type, db)) newlyAwarded.push(type);
    };

    const paidCount = await db.contribution.count({ where: { userId, status: 'PAID' } });
    await maybeAward('FIRST_CONTRIBUTION', paidCount >= 1);
    await maybeAward('STREAK_7',  user.currentStreak >= 7);
    await maybeAward('STREAK_30', user.currentStreak >= 30);
    await maybeAward('STREAK_90', user.currentStreak >= 90);
    await maybeAward('CONTRIBUTED_100K', Number(user.totalContributed) >= 100000 * 100); // amounts stored in kobo

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    await maybeAward('VETERAN', user.createdAt <= oneYearAgo);

    return newlyAwarded;
  }

  // Call from wherever KYC flips a user to VERIFIED (kyc.module.ts).
  async awardVerifiedBadge(userId: string) {
    return this.awardBadgeIfMissing(userId, 'VERIFIED');
  }

  // TOP_SAVER — cross-user comparison, recomputed daily.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async awardTopSaverBadges() {
    const totalActive = await this.prisma.user.count({ where: { status: 'ACTIVE' } });
    if (totalActive === 0) return;
    const topCount = Math.max(1, Math.ceil(totalActive * 0.1));
    const topUsers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { totalContributed: 'desc' },
      take: topCount,
      select: { id: true },
    });
    await Promise.allSettled(
      topUsers.map((u) => this.awardBadgeIfMissing(u.id, 'TOP_SAVER').catch((err) => this.logger.error(`[awardTopSaverBadges] failed for ${u.id}:`, err))),
    );
  }

  // ── Badges (legacy read endpoint — kept for /users/me/badges) ──
  async getUserBadges(userId: string) {
    const badges = await this.prisma.userBadge.findMany({
      where:   { userId },
      orderBy: { earnedAt: 'desc' },
    });

    const badgeDetails: Record<string, any> = {
      FIRST_CONTRIBUTION: { label: 'First Steps',       icon: '🌱', color: '#16a34a' },
      STREAK_7:           { label: '7-Day Streak',      icon: '🔥', color: '#d97706' },
      STREAK_30:          { label: '30-Day Streak',     icon: '⚡', color: '#7c3aed' },
      STREAK_90:          { label: '90-Day Streak',     icon: '💎', color: '#0891b2' },
      PERFECT_CYCLE:      { label: 'Perfect Cycle',     icon: '🏆', color: '#b45309' },
      CONTRIBUTED_100K:   { label: 'Group Builder',     icon: '👥', color: '#2563eb' },
      EARLY_SUPPORTER:    { label: 'Active Saver',      icon: '🎯', color: '#0284c7' },
      TOP_SAVER:          { label: 'Cycle Champ',       icon: '🥇', color: '#b45309' },
      VERIFIED:           { label: 'Reliable',          icon: '✅', color: '#059669' },
      VETERAN:            { label: 'Veteran Saver',     icon: '🎖️', color: '#9333ea' },
    };

    return badges.map(b => ({ ...b, details: badgeDetails[b.type] || {} }));
  }

  // ── Leaderboard ────────────────────────────────────────────
  async getLeaderboard(category = 'REPUTATION', limit = 10) {
    const rankings = await this.prisma.leaderboardRanking.findMany({
      where:   { category: category as any },
      orderBy: { globalRank: 'asc' },
      take:    limit,
      include: {
        user: {
          select: {
            id: true, username: true, firstName: true,
            lastName: true, avatarUrl: true,
          },
        },
      },
    });

    if (!rankings.length) {
      const users = await this.prisma.user.findMany({
        where:   { status: 'ACTIVE' },
        orderBy: category === 'STREAK'
          ? { currentStreak: 'desc' }
          : { reputationScore: 'desc' },
        take: limit,
        select: {
          id: true, username: true, firstName: true, lastName: true,
          avatarUrl: true, reputationScore: true, currentStreak: true,
          totalContributed: true,
        },
      });

      return users.map((u, i) => ({
        userId: u.id,
        rank:   i + 1,
        score:  category === 'STREAK' ? u.currentStreak : u.reputationScore,
        user:   {
          id:        u.id,
          username:  u.username,
          firstName: u.firstName,
          lastName:  u.lastName,
          avatarUrl: u.avatarUrl,
        },
      }));
    }

    return rankings.map(r => ({
      userId: r.userId,
      rank:   r.globalRank,
      score:  r.score ? Number(r.score) : 0,
      user:   r.user,
    }));
  }
}

// ─── Controller ───────────────────────────────────────────────

@ApiTags('Users')
@Controller('users')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('transaction-pin')
  @ApiOperation({ summary: 'Set transaction PIN (first time only)' })
  setTransactionPin(@Req() req: any, @Body() body: { pin: string }) {
    return this.usersService.setTransactionPin(req.user.id, body.pin);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  getMe(@Req() req: any) {
    return this.usersService.getFullProfileById(req.user.id, req.user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile' })
  updateMe(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Get('me/badges')
  @ApiOperation({ summary: 'Get own badges' })
  getBadges(@Req() req: any) {
    return this.usersService.getUserBadges(req.user.id);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload or replace own profile picture' })
  uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadAvatar(req.user.id, file);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get leaderboard' })
  getLeaderboard(
    @Query('category') category = 'REPUTATION',
    @Query('limit') limit = 10,
  ) {
    return this.usersService.getLeaderboard(category, Number(limit));
  }

  @Get('by-username/:username/profile')
  @ApiOperation({ summary: 'Get full profile by username' })
  getProfileByUsername(@Param('username') username: string) {
    return this.usersService.getFullProfileByUsername(username);
  }

  @Get(':id/profile')
  @ApiOperation({ summary: 'Get full profile by user ID (private fields only for your own)' })
  getProfileById(@Req() req: any, @Param('id') id: string) {
    return this.usersService.getFullProfileById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update profile by user ID' })
  updateProfile(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    if (req.user.id !== id) throw new BadRequestException('You can only update your own profile');
    return this.usersService.updateProfile(id, dto);
  }

  @Post(':id/streak/claim')
  @ApiOperation({ summary: 'Claim daily streak' })
  claimStreak(@Req() req: any, @Param('id') id: string) {
    if (req.user.id !== id) throw new BadRequestException('You can only claim your own streak');
    return this.usersService.claimStreak(id);
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get public profile by username' })
  getPublicProfile(@Param('username') username: string) {
    return this.usersService.getPublicProfile(username);
  }
}

@Module({
  imports:     [NotificationsModule],
  controllers: [UsersController],
  providers:   [UsersService],
  exports:     [UsersService],
})
export class UsersModule {}