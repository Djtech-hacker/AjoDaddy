// ============================================================
// SETTINGS MODULE — Platform settings, fees, freezes, maintenance
// mode (manual + scheduled), balance adjustments, revenue summary
// ============================================================

import {
  Module, Controller, Get, Patch, Post, Body, Param, Req,
  UseGuards, Injectable, BadRequestException, NotFoundException,
  ServiceUnavailableException, CanActivate, ExecutionContext,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Cron } from '@nestjs/schedule';
import { IsNumber, IsOptional, IsBoolean, IsString, IsInt, IsISO8601, Min, Max } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.module';
import { AdminGuard, SuperAdminGuard } from '../admin/admin.module';

const SETTINGS_ID = 'singleton';

// Audit log entries created by the cron job itself (no admin was
// logged in) use a null actorId — AuditLog.actorId is an optional FK
// to User, so it must be either a real user id or null, never a
// placeholder string like 'system' (that would violate the FK
// constraint the first time this cron job runs).
const SYSTEM_ACTOR_ID = null;

export class UpdatePlatformSettingsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  platformFeePercent?: number;

  @IsOptional() @IsNumber() @Min(0)
  minContribution?: number;

  @IsOptional() @IsNumber() @Min(0)
  maxContribution?: number;

  @IsOptional() @IsBoolean()
  withdrawalsFrozen?: boolean;

  @IsOptional() @IsBoolean()
  contributionsFrozen?: boolean;

  @IsOptional() @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional() @IsBoolean()
  paystackEnabled?: boolean;

  @IsOptional() @IsBoolean()
  flutterwaveEnabled?: boolean;

  @IsOptional() @IsInt() @Min(1)
  reportFlagThreshold?: number;

  @IsOptional() @IsInt() @Min(1)
  reportHighPriorityThreshold?: number;

  @IsOptional() @IsInt() @Min(1)
  reportAutoEscalateThreshold?: number;

  // ── Scheduled maintenance ──
  // ISO timestamp for when maintenance should auto-activate. Send this
  // together with maintenanceAnnouncement to schedule; send
  // clearScheduledMaintenance: true to cancel a pending schedule.
  @IsOptional() @IsISO8601()
  maintenanceScheduledAt?: string;

  @IsOptional() @IsString()
  maintenanceAnnouncement?: string;

  @IsOptional() @IsBoolean()
  clearScheduledMaintenance?: boolean;
}

export class AdjustBalanceDto {
  @IsNumber()
  amount: number; // naira — positive to credit, negative to debit

  @IsString()
  reason: string;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    const settings = await this.prisma.platformSetting.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
    return {
      ...settings,
      platformFeePercent: Number(settings.platformFeePercent),
      minContribution:    Number(settings.minContributionKobo) / 100,
      maxContribution:    Number(settings.maxContributionKobo) / 100,
    };
  }

  async updateSettings(adminId: string, dto: UpdatePlatformSettingsDto) {
    const data: any = { updatedById: adminId };
    if (dto.platformFeePercent  !== undefined) data.platformFeePercent  = dto.platformFeePercent;
    if (dto.minContribution     !== undefined) data.minContributionKobo = BigInt(Math.round(dto.minContribution * 100));
    if (dto.maxContribution     !== undefined) data.maxContributionKobo = BigInt(Math.round(dto.maxContribution * 100));
    if (dto.withdrawalsFrozen   !== undefined) data.withdrawalsFrozen   = dto.withdrawalsFrozen;
    if (dto.contributionsFrozen !== undefined) data.contributionsFrozen = dto.contributionsFrozen;
    if (dto.maintenanceMode     !== undefined) data.maintenanceMode     = dto.maintenanceMode;
    if (dto.paystackEnabled     !== undefined) data.paystackEnabled     = dto.paystackEnabled;
    if (dto.flutterwaveEnabled  !== undefined) data.flutterwaveEnabled  = dto.flutterwaveEnabled;

    if (dto.reportFlagThreshold         !== undefined) data.reportFlagThreshold         = dto.reportFlagThreshold;
    if (dto.reportHighPriorityThreshold !== undefined) data.reportHighPriorityThreshold = dto.reportHighPriorityThreshold;
    if (dto.reportAutoEscalateThreshold !== undefined) data.reportAutoEscalateThreshold = dto.reportAutoEscalateThreshold;

    if (dto.maintenanceAnnouncement !== undefined) data.maintenanceAnnouncement = dto.maintenanceAnnouncement;
    if (dto.maintenanceScheduledAt  !== undefined) data.maintenanceScheduledAt  = new Date(dto.maintenanceScheduledAt);
    if (dto.clearScheduledMaintenance) data.maintenanceScheduledAt = null;

    await this.prisma.platformSetting.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });

    await this.prisma.auditLog.create({
      data: { actorId: adminId, action: 'PLATFORM_SETTINGS_UPDATED', entityType: 'PlatformSetting', entityId: SETTINGS_ID, metadata: dto as any },
    });

    return this.getSettings();
  }

  async adjustUserBalance(adminId: string, userId: string, dto: AdjustBalanceDto) {
    const amountKobo = BigInt(Math.round(dto.amount * 100));
    if (amountKobo === 0n) throw new BadRequestException('Adjustment amount cannot be zero');

    const reference = `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const result = await this.prisma.executeTransaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      if (amountKobo < 0n) {
        const available = wallet.balance - wallet.lockedBalance;
        if (available < -amountKobo) {
          throw new BadRequestException(
            `Cannot deduct ₦${(Number(-amountKobo) / 100).toLocaleString()} — only ₦${(Number(available) / 100).toLocaleString()} available`,
          );
        }
      }

      const updatedWallet = await tx.wallet.update({ where: { userId }, data: { balance: { increment: amountKobo } } });

      const transaction = await tx.transaction.create({
        data: {
          userId, walletId: wallet.id, type: 'ADJUSTMENT', status: 'COMPLETED',
          amount: amountKobo < 0n ? -amountKobo : amountKobo,
          balanceBefore: wallet.balance, balanceAfter: updatedWallet.balance,
          reference, description: `Manual balance adjustment by admin: ${dto.reason}`,
          metadata: { adjustedBy: adminId, reason: dto.reason, direction: amountKobo < 0n ? 'DEBIT' : 'CREDIT' },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId, action: 'BALANCE_ADJUSTED', entityType: 'User', entityId: userId,
          metadata: { amount: Number(amountKobo) / 100, reason: dto.reason, transactionId: transaction.id },
        },
      });

      return updatedWallet;
    });

    return { message: 'Balance adjusted', newBalance: Number(result.balance) / 100, reference };
  }

  async getRevenueSummary() {
    const [feeAgg, totalWithdrawalsProcessed, totalAdjustments] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { type: 'WITHDRAWAL', status: { in: ['COMPLETED', 'PROCESSING'] } },
        _sum: { fee: true },
      }),
      this.prisma.transaction.count({ where: { type: 'WITHDRAWAL', status: 'COMPLETED' } }),
      this.prisma.transaction.count({ where: { type: 'ADJUSTMENT' } }),
    ]);

    return {
      totalFeesCollected:        Number(feeAgg._sum.fee || 0) / 100,
      totalWithdrawalsProcessed,
      totalManualAdjustments:    totalAdjustments,
    };
  }

  // ── Scheduled maintenance auto-activation ──
  // Runs every 30s. If a schedule time has passed and maintenance isn't
  // already on, flips it on automatically and clears the schedule.
  @Cron('*/30 * * * * *')
  async checkScheduledMaintenance() {
    const settings = await this.prisma.platformSetting.findUnique({ where: { id: SETTINGS_ID } });
    if (!settings?.maintenanceScheduledAt || settings.maintenanceMode) return;
    if (new Date(settings.maintenanceScheduledAt).getTime() > Date.now()) return;

    await this.prisma.platformSetting.update({
      where: { id: SETTINGS_ID },
      data: { maintenanceMode: true, maintenanceScheduledAt: null },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: SYSTEM_ACTOR_ID,
        action: 'MAINTENANCE_AUTO_ACTIVATED',
        entityType: 'PlatformSetting',
        entityId: SETTINGS_ID,
        metadata: { scheduledAt: settings.maintenanceScheduledAt },
      },
    });
  }
}

// ── Maintenance mode guard — blocks all non-admin, non-auth API
// traffic while maintenanceMode is on. Runs globally (see app.module.ts).
// NOTE: this does one settings lookup per request with no caching yet —
// fine functionally, but worth optimizing with a short in-memory cache
// later if traffic grows.
@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(private readonly settingsService: SettingsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (req.path?.startsWith('/api/admin')) return true;
    if (req.path?.startsWith('/api/auth'))  return true;
    if (req.path?.startsWith('/api/platform')) return true;

    const settings = await this.settingsService.getSettings();
    if (settings.maintenanceMode) {
      throw new ServiceUnavailableException('PayPaddy is temporarily down for maintenance. Please check back shortly.');
    }
    return true;
  }
}

@ApiTags('Admin Settings')
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current platform settings' })
  getSettings() { return this.settingsService.getSettings(); }

  @Patch()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Update platform settings (super admin only)' })
  updateSettings(@Req() req: any, @Body() dto: UpdatePlatformSettingsDto) {
    return this.settingsService.updateSettings(req.user.id, dto);
  }

  @Get('revenue')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Revenue summary (super admin only)' })
  getRevenue() { return this.settingsService.getRevenueSummary(); }

  @Post('users/:id/adjust-balance')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: "Manually adjust a user's wallet balance (super admin only)" })
  adjustBalance(@Req() req: any, @Param('id') id: string, @Body() dto: AdjustBalanceDto) {
    return this.settingsService.adjustUserBalance(req.user.id, id, dto);
  }
}

// ── Public platform status — no auth required. Regular users poll
// this to detect scheduled or active maintenance before they even hit
// a blocked request. Deliberately excludes everything except what a
// visitor needs to render a banner or maintenance screen.
@ApiTags('Platform Status')
@Controller('platform')
export class PlatformStatusController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('status')
  @ApiOperation({ summary: 'Public platform status — maintenance mode, schedule, announcement' })
  async getStatus() {
    const settings = await this.settingsService.getSettings();
    return {
      maintenanceMode:          settings.maintenanceMode,
      maintenanceScheduledAt:   settings.maintenanceScheduledAt,
      maintenanceAnnouncement:  settings.maintenanceAnnouncement,
    };
  }
}

@Module({
  controllers: [SettingsController, PlatformStatusController],
  providers:   [SettingsService, MaintenanceModeGuard],
  exports:     [SettingsService, MaintenanceModeGuard],
})
export class SettingsModule {}