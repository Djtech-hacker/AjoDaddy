// ============================================================
// WALLET MODULE — Atomic balance operations, full audit trail
// ============================================================
// FIX: getTransactionHistory() and getWalletStats() previously only
// queried the `transaction` table (written by payments.module.ts for
// WALLET_FUNDING / WITHDRAWAL / REFUND). But groups.module.ts writes
// CONTRIBUTION / PAYOUT / PENALTY rows into a *different* table,
// `walletTransaction`. Since the wallet page only ever read from
// `transaction`, contributions and payouts could never appear in the
// UI list or stats no matter what filter was selected — the money
// moved correctly, but the record of it lived somewhere the endpoint
// never looked. Both methods below now query both tables, normalize
// them into one shape, and merge/sort/paginate in application code.
// ============================================================

import {
  Module, Controller, Get, Post, Body, Req, UseGuards,
  Injectable, BadRequestException, NotFoundException,
  ForbiddenException, Query, Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNumber, Min, IsString, IsOptional, IsEnum } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.module';
import { Throttle } from '@nestjs/throttler';

// ── DTOs ─────────────────────────────────────────────────────

export class FundWalletDto {
  @IsNumber()
  @Min(100, { message: 'Minimum funding amount is ₦100' })
  amount: number; // in Naira, converted to kobo internally

  @IsString()
  provider: 'paystack' | 'flutterwave';
}

export class WithdrawDto {
  @IsNumber()
  @Min(500, { message: 'Minimum withdrawal is ₦500' })
  amount: number;

  @IsString()
  accountNumber: string;

  @IsString()
  bankCode: string;

  @IsString()
  accountName: string;

  @IsString()
  transactionPin: string;
}

// ── Wallet Service ────────────────────────────────────────────

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        id: true, balance: true, lockedBalance: true, currency: true, isActive: true, createdAt: true,
      },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return {
      ...wallet,
      balance:        Number(wallet.balance) / 100,       // kobo → naira
      lockedBalance:  Number(wallet.lockedBalance) / 100,
      availableBalance: (Number(wallet.balance) - Number(wallet.lockedBalance)) / 100,
    };
  }

  // ── Merged transaction history ────────────────────────────
  // Pulls from BOTH `transaction` (funding/withdrawal/refund, written by
  // PaymentsService) and `walletTransaction` (contribution/payout/penalty,
  // written by GroupsService), normalizes them to one shape, then sorts
  // and paginates the combined result in app code. Over-fetches
  // (skip + limit) rows from each source so the merged sort/slice is
  // correct even when one source has far more rows than the other.
  async getTransactionHistory(userId: string, page = 1, limit = 20, type?: string) {
    const skip = (page - 1) * limit;
    const fetchCount = skip + limit;

    const txWhere: any = { userId };
    const wtWhere: any = { userId };
    if (type) { txWhere.type = type; wtWhere.type = type; }

    const [txRows, wtRows, txTotal, wtTotal] = await Promise.all([
      this.prisma.transaction.findMany({
        where: txWhere,
        orderBy: { createdAt: 'desc' },
        take: fetchCount,
        select: {
          id: true, type: true, status: true, amount: true, fee: true,
          balanceBefore: true, balanceAfter: true, currency: true,
          reference: true, description: true, metadata: true, createdAt: true,
        },
      }),
      this.prisma.walletTransaction.findMany({
        where: wtWhere,
        orderBy: { createdAt: 'desc' },
        take: fetchCount,
        select: {
          id: true, type: true, status: true, amount: true,
          reference: true, metadata: true, createdAt: true,
        },
      }),
      this.prisma.transaction.count({ where: txWhere }),
      this.prisma.walletTransaction.count({ where: wtWhere }),
    ]);

    const normalized = [
      ...txRows.map(tx => ({
        id: tx.id, type: tx.type, status: tx.status,
        amount: Number(tx.amount) / 100,
        fee: Number(tx.fee ?? 0) / 100,
        balanceBefore: tx.balanceBefore != null ? Number(tx.balanceBefore) / 100 : null,
        balanceAfter:  tx.balanceAfter  != null ? Number(tx.balanceAfter)  / 100 : null,
        currency: tx.currency ?? 'NGN',
        reference: tx.reference,
        description: tx.description,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
      })),
      ...wtRows.map(wt => ({
        id: wt.id, type: wt.type, status: wt.status,
        amount: Number(wt.amount) / 100,
        fee: 0,
        balanceBefore: null,
        balanceAfter:  null,
        currency: 'NGN',
        reference: wt.reference,
        description: null,
        metadata: wt.metadata,
        createdAt: wt.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = txTotal + wtTotal;
    const pageRows = normalized.slice(skip, skip + limit);

    return {
      transactions: pageRows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Credit wallet — ATOMIC operation with full audit trail
   * All amounts in kobo internally
   */
  async creditWallet(
    userId: string,
    amountKobo: bigint,
    type: string,
    description: string,
    metadata?: any,
    prismaClient?: any,
  ) {
    const db = prismaClient || this.prisma;

    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (!wallet.isActive) throw new ForbiddenException('Wallet is inactive');

    const newBalance = wallet.balance + amountKobo;

    await db.wallet.update({ where: { userId }, data: { balance: newBalance } });

    const tx = await db.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        status: 'COMPLETED',
        amount: amountKobo,
        balanceBefore: wallet.balance,
        balanceAfter: newBalance,
        description,
        metadata,
      },
    });

    return { transaction: tx, newBalance };
  }

  /**
   * Debit wallet — ATOMIC with overdraft protection
   */
  async debitWallet(
    userId: string,
    amountKobo: bigint,
    type: string,
    description: string,
    metadata?: any,
    prismaClient?: any,
  ) {
    const db = prismaClient || this.prisma;

    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (!wallet.isActive) throw new ForbiddenException('Wallet is inactive');

    const available = wallet.balance - wallet.lockedBalance;
    if (available < amountKobo) {
      throw new BadRequestException(`Insufficient balance. Available: ₦${Number(available) / 100}`);
    }

    const newBalance = wallet.balance - amountKobo;

    await db.wallet.update({ where: { userId }, data: { balance: newBalance } });

    const tx = await db.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        status: 'COMPLETED',
        amount: amountKobo,
        balanceBefore: wallet.balance,
        balanceAfter: newBalance,
        description,
        metadata,
      },
    });

    return { transaction: tx, newBalance };
  }

  /**
   * Lock funds (for pending transactions)
   */
  async lockFunds(userId: string, amountKobo: bigint) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const available = wallet.balance - wallet.lockedBalance;
    if (available < amountKobo) {
      throw new BadRequestException('Insufficient available balance');
    }

    await this.prisma.wallet.update({
      where: { userId },
      data: { lockedBalance: { increment: amountKobo } },
    });
  }

  /**
   * Unlock funds
   */
  async unlockFunds(userId: string, amountKobo: bigint) {
    await this.prisma.wallet.update({
      where: { userId },
      data: { lockedBalance: { decrement: amountKobo } },
    });
  }

  // ── Merged wallet stats ────────────────────────────────────
  // Same root issue as getTransactionHistory: PAYOUT lives only in
  // `walletTransaction` and CONTRIBUTION only in `walletTransaction`,
  // while WALLET_FUNDING/WITHDRAWAL live in `transaction`. Aggregating
  // only one table silently undercounted totalReceived/totalSpent.
  async getWalletStats(userId: string) {
    const monthStart = new Date(new Date().setDate(1));

    const [
      txIn, wtIn,
      txOut, wtOut,
      txMonthlyIn,
    ] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId, type: { in: ['WALLET_FUNDING', 'PAYOUT'] }, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { userId, type: { in: ['WALLET_FUNDING', 'PAYOUT'] }, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: { in: ['CONTRIBUTION', 'WITHDRAWAL'] }, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { userId, type: { in: ['CONTRIBUTION', 'WITHDRAWAL'] }, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId, type: 'WALLET_FUNDING', status: 'COMPLETED',
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalReceived = Number(txIn._sum.amount || 0) + Number(wtIn._sum.amount || 0);
    const totalSpent     = Number(txOut._sum.amount || 0) + Number(wtOut._sum.amount || 0);
    const monthlyFunded   = Number(txMonthlyIn._sum.amount || 0); // WALLET_FUNDING only ever lands in `transaction`

    return {
      totalReceived: totalReceived / 100,
      totalSpent:    totalSpent / 100,
      monthlyFunded: monthlyFunded / 100,
    };
  }
}

// ── Wallet Controller ─────────────────────────────────────────

@ApiTags('Wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get wallet balance and info' })
  getWallet(@Req() req: any) {
    return this.walletService.getWallet(req.user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get wallet statistics' })
  getStats(@Req() req: any) {
    return this.walletService.getWalletStats(req.user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get paginated transaction history' })
  getTransactions(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('type') type?: string,
  ) {
    return this.walletService.getTransactionHistory(req.user.id, +page, +limit, type);
  }
}

// ── Wallet Module ─────────────────────────────────────────────

@Module({
  controllers: [WalletController],
  providers:   [WalletService],
  exports:     [WalletService],   // ← this line must be here
})
export class WalletModule {}