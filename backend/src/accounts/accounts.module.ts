// ============================================================
// ACCOUNTS MODULE — money movements, balance check, money owed,
// and payment requests (salary, delivery, other).
// Accounts staff REQUEST; only a Super Admin can APPROVE.
// ============================================================
import {
  Module, Controller, Get, Post, Body, Param, Query, Req, UseGuards, Injectable,
  CanActivate, ExecutionContext, ForbiddenException, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsIn, Min, Matches, MinLength, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, AuthService, AuthModule } from '../auth/auth.module';
import { PaymentsService, PaymentsModule } from '../payments/payments.module';
import { readCompanyMoney, lockCompanyMoney } from './company-money';

const CATEGORIES = ['SALARY', 'DELIVERY', 'OTHER'];
const naira = (kobo: bigint | number | null | undefined) => Number(kobo || 0) / 100;
const show = (kobo: bigint) => '₦' + naira(kobo).toLocaleString();

export class AccountsGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !['ACCOUNTANT', 'SUPER_ADMIN'].includes(user.role)) throw new ForbiddenException('Accounts access required');
    return true;
  }
}

export class ApproverGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only a Super Admin can approve or reject payments');
    return true;
  }
}

export class CreateExpenseDto {
  @IsIn(CATEGORIES) category: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) amount: number;
  @IsString() @MinLength(3) @MaxLength(200) note: string;
  @Matches(/^\d{10}$/) accountNumber: string;
  @IsString() bankCode: string;
  @IsOptional() @IsString() bankName?: string;
  @IsString() @MinLength(2) accountName: string;
}

export class ApproveExpenseDto {
  @IsString() password: string;
  @IsString() @MinLength(10) facePhotoUrl: string;
}

export class RejectExpenseDto {
  @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly paymentsService: PaymentsService,
  ) {}

  private get db(): any { return this.prisma; }

  private async person(id: string) {
    const u = await this.db.user.findUnique({ where: { id }, select: { username: true, firstName: true, lastName: true } });
    return u ? `${u.firstName} ${u.lastName} (@${u.username})` : id;
  }

  // ── Money owed: what must not be spent ──
  async overview() {
    const company = await readCompanyMoney(this.db);
    const [users, pools, pending] = await Promise.all([
      this.db.wallet.aggregate({ where: { userId: { not: 'SYSTEM' } }, _sum: { balance: true, lockedBalance: true } }),
      this.db.group.aggregate({ _sum: { poolBalance: true } }),
      this.db.companyExpense.findMany({ where: { status: 'PENDING' }, select: { amount: true, category: true } }),
    ]);
    // what a new request can still use, after the requests already waiting
    const waiting = (delivery: boolean): bigint => pending
      .filter((p: any) => (p.category === 'DELIVERY') === delivery)
      .reduce((sum: bigint, p: any) => sum + p.amount, 0n);
    const atLeastZero = (v: bigint) => (v > 0n ? v : 0n);
    const waitingDelivery = waiting(true);
    // the courier's share only: the rest of the delivery money is the Paystack transfer fee
    const courierLeft = company.courier - company.deliveryPaid - waitingDelivery;
    const deliveryLeft = company.owed - waitingDelivery;

    return {
      availableForExpenses: naira(atLeastZero(company.own - waiting(false))),
      availableForDelivery: naira(atLeastZero(deliveryLeft)),
      courierDue: naira(atLeastZero(courierLeft < deliveryLeft ? courierLeft : deliveryLeft)),
      ownMoney: naira(company.own),
      owedForDelivery: naira(company.owed),
      deliveryPaid: naira(company.deliveryPaid),
      shopEscrow: naira(company.escrow),
      companyWallet: naira(company.balance),
      userWallets: naira(users._sum.balance),
      userLocked: naira(users._sum.lockedBalance),
      groupPools: naira(pools._sum.poolBalance),
      pendingTotal: naira(waiting(true) + waiting(false)),
      pendingCount: pending.length,
    };
  }

  // ── Every recorded transaction ──
  async movements(page = 1, limit = 30, type?: string, status?: string, search?: string) {
    const take = Math.min(Math.max(limit || 30, 1), 5000);
    const current = Math.max(page || 1, 1);
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { user: { username: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.db.transaction.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (current - 1) * take, take,
        include: { user: { select: { username: true } } },
      }),
      this.db.transaction.count({ where }),
    ]);
    return {
      rows: rows.map((t: any) => ({
        id: t.id, createdAt: t.createdAt, who: t.userId === 'SYSTEM' ? 'Company' : t.user?.username || t.userId,
        type: t.type, status: t.status, amount: naira(t.amount), reference: t.reference, description: t.description || '',
      })),
      total, page: current, totalPages: Math.max(Math.ceil(total / take), 1),
    };
  }

  // ── Does each user wallet match its transaction records? ──
  async balanceCheck() {
    const notSystem = { userId: { not: 'SYSTEM' } };
    const [wallets, sums, adjustments] = await Promise.all([
      this.db.wallet.findMany({ where: notSystem, include: { user: { select: { username: true } } } }),
      this.db.transaction.groupBy({ by: ['userId', 'type', 'status'], where: notSystem, _sum: { amount: true } }),
      this.db.transaction.findMany({ where: { ...notSystem, type: 'ADJUSTMENT', status: 'COMPLETED' }, select: { userId: true, amount: true, metadata: true } }),
    ]);

    const expected: Record<string, bigint> = {};
    const add = (userId: string, kobo: bigint) => { expected[userId] = (expected[userId] || 0n) + kobo; };

    for (const row of sums) {
      const amount: bigint = row._sum.amount || 0n;
      const done = row.status === 'COMPLETED' || row.status === 'REVERSED';
      // a failed withdrawal was taken first and returned as a separate REFUND row, so it counts as money out
      if (row.type === 'WITHDRAWAL') add(row.userId, -amount);
      else if (!done) continue;
      else if (['WALLET_FUNDING', 'PAYOUT', 'REFUND'].includes(row.type)) add(row.userId, amount);
      else if (['CONTRIBUTION', 'PENALTY'].includes(row.type)) add(row.userId, -amount);
    }
    for (const a of adjustments) add(a.userId, (a.metadata as any)?.direction === 'DEBIT' ? -a.amount : a.amount);

    const mismatches = wallets
      .map((w: any) => ({
        username: w.user?.username || w.userId,
        holds: naira(w.balance),
        records: naira(expected[w.userId] || 0n),
        difference: naira(w.balance - (expected[w.userId] || 0n)),
      }))
      .filter((m: any) => m.difference !== 0)
      .sort((a: any, b: any) => Math.abs(b.difference) - Math.abs(a.difference));

    return { checked: wallets.length, mismatches };
  }

  // ── Payment requests ──
  async listExpenses() {
    const rows = await this.db.companyExpense.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const refs = rows.map((r: any) => r.reference).filter(Boolean);
    const txs = refs.length ? await this.db.transaction.findMany({ where: { reference: { in: refs } }, select: { reference: true, status: true } }) : [];
    const bankStatus = new Map(txs.map((t: any) => [t.reference, t.status]));
    return rows.map((r: any) => ({ ...r, amount: naira(r.amount), bankStatus: r.reference ? bankStatus.get(r.reference) || null : null }));
  }

  private assertAffordable(category: string, amount: bigint, company: { owed: bigint; own: bigint; free: bigint }) {
    if (amount > company.free) throw new BadRequestException(`The company wallet only has ${show(company.free)}`);
    if (category === 'DELIVERY') {
      if (amount > company.owed) throw new BadRequestException(`Only ${show(company.owed)} is owed for delivery`);
    } else if (amount > company.own) {
      throw new BadRequestException(`Only ${show(company.own > 0n ? company.own : 0n)} is the company's own money. The rest is for delivery.`);
    }
  }

  async createExpense(userId: string, dto: CreateExpenseDto) {
    const amount = BigInt(Math.round(dto.amount * 100));
    const company = await readCompanyMoney(this.db);
    // requests still waiting for approval already have a claim on the same money
    const waiting = await this.db.companyExpense.findMany({ where: { status: 'PENDING' }, select: { amount: true, category: true } });
    const sameBucket = waiting
      .filter((w: any) => (w.category === 'DELIVERY') === (dto.category === 'DELIVERY'))
      .reduce((sum: bigint, w: any) => sum + w.amount, 0n);
    this.assertAffordable(dto.category, amount + sameBucket, company);

    const requestedByName = await this.person(userId);
    const expense = await this.db.companyExpense.create({
      data: {
        category: dto.category, amount, note: dto.note.trim(),
        accountNumber: dto.accountNumber, bankCode: dto.bankCode, bankName: dto.bankName, accountName: dto.accountName,
        requestedById: userId, requestedByName,
      },
    });
    await this.db.auditLog.create({
      data: { actorId: userId, action: 'EXPENSE_REQUESTED', entityType: 'CompanyExpense', entityId: expense.id, metadata: { amount: dto.amount, category: dto.category, note: dto.note } },
    });
    return { message: 'Request sent for approval', id: expense.id };
  }

  async approveExpense(adminId: string, id: string, dto: ApproveExpenseDto) {
    const passwordValid = await this.authService.verifyPassword(adminId, dto.password);
    if (!passwordValid) throw new ForbiddenException('Incorrect password');

    const decidedByName = await this.person(adminId);
    const reference = `COMPANYWD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const expense = await this.prisma.executeTransaction(async (tx: any) => {
      const company = await lockCompanyMoney(tx);
      if (!company.walletId) throw new NotFoundException('Company revenue wallet not found');

      // only one approval can move a request out of PENDING, so it can never be paid twice
      const claimed = await tx.companyExpense.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'SENDING', reference, decidedById: adminId, decidedByName, decidedAt: new Date() },
      });
      if (claimed.count !== 1) throw new BadRequestException('This request is no longer waiting for approval');

      const row = await tx.companyExpense.findUnique({ where: { id } });
      this.assertAffordable(row.category, row.amount, company);

      await tx.wallet.update({ where: { userId: 'SYSTEM' }, data: { balance: { decrement: row.amount } } });
      await tx.transaction.create({
        data: {
          userId: 'SYSTEM', walletId: company.walletId, type: 'WITHDRAWAL', status: 'PENDING', amount: row.amount,
          balanceBefore: company.balance, balanceAfter: company.balance - row.amount, reference,
          description: `${row.category}: ${row.note} (to ${row.accountName}, ${row.accountNumber})`,
          metadata: { category: row.category, expenseId: row.id, accountNumber: row.accountNumber, bankCode: row.bankCode, accountName: row.accountName, bankName: row.bankName, initiatedBy: adminId },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId, action: 'EXPENSE_APPROVED', entityType: 'CompanyExpense', entityId: id,
          metadata: { amount: naira(row.amount), category: row.category, reference, facePhotoUrl: dto.facePhotoUrl, passwordVerified: true },
        },
      });
      return row;
    });

    try {
      await this.paymentsService.sendBankTransfer(
        naira(expense.amount), expense.accountNumber, expense.bankCode, expense.accountName,
        reference, `TAREVA ${expense.category.toLowerCase()} payment`,
      );
    } catch (err: any) {
      // keep the provider's reason, so it can be seen on the request
      const why = String(err?.response?.data?.message || err?.response?.message || err?.message || 'No reason given').slice(0, 200);
      console.error(`[Accounts] transfer ${reference} failed: ${why}`);
      await this.prisma.executeTransaction(async (tx: any) => {
        await tx.wallet.update({ where: { userId: 'SYSTEM' }, data: { balance: { increment: expense.amount } } });
        await tx.transaction.updateMany({ where: { reference }, data: { status: 'FAILED' } });
        await tx.companyExpense.update({ where: { id }, data: { status: 'FAILED', rejectReason: why } });
      });
      throw new BadRequestException(`Bank transfer failed: ${why}. The money was returned to the company wallet.`);
    }

    await this.db.transaction.updateMany({ where: { reference, status: 'PENDING' }, data: { status: 'PROCESSING' } });
    await this.db.companyExpense.update({ where: { id }, data: { status: 'SENT' } });
    return { message: `${show(expense.amount)} is being sent to ${expense.accountName}` };
  }

  async rejectExpense(adminId: string, id: string, reason: string) {
    const decidedByName = await this.person(adminId);
    const result = await this.db.companyExpense.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectReason: reason, decidedById: adminId, decidedByName, decidedAt: new Date() },
    });
    if (result.count !== 1) throw new BadRequestException('This request is no longer waiting for approval');
    await this.db.auditLog.create({
      data: { actorId: adminId, action: 'EXPENSE_REJECTED', entityType: 'CompanyExpense', entityId: id, metadata: { reason } },
    });
    return { message: 'Request rejected' };
  }
}

@ApiTags('Accounts')
@Controller('accounts')
@UseGuards(JwtAuthGuard, AccountsGuard)
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('overview')
  overview() { return this.accounts.overview(); }

  @Get('movements')
  movements(@Query('page') page = 1, @Query('limit') limit = 30, @Query('type') type?: string, @Query('status') status?: string, @Query('search') search?: string) {
    return this.accounts.movements(+page, +limit, type, status, search);
  }

  @Get('balance-check')
  balanceCheck() { return this.accounts.balanceCheck(); }

  @Get('expenses')
  expenses() { return this.accounts.listExpenses(); }

  @Post('expenses')
  create(@Req() req: any, @Body() dto: CreateExpenseDto) { return this.accounts.createExpense(req.user.id, dto); }

  @Post('expenses/:id/approve')
  @UseGuards(ApproverGuard)
  approve(@Req() req: any, @Param('id') id: string, @Body() dto: ApproveExpenseDto) { return this.accounts.approveExpense(req.user.id, id, dto); }

  @Post('expenses/:id/reject')
  @UseGuards(ApproverGuard)
  reject(@Req() req: any, @Param('id') id: string, @Body() dto: RejectExpenseDto) { return this.accounts.rejectExpense(req.user.id, id, dto.reason); }
}

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}