// ============================================================
// PAYMENTS MODULE — Paystack only for now (Flutterwave disabled)
// ============================================================
// FIX: removed the `processScheduledPayouts` cron and its helper
// `creditPayoutToWallet`. That cron ran every 5 minutes, picked up
// ANY payout row with status SCHEDULED across the whole platform,
// and credited it immediately — with no check that contributions
// had actually been collected, no poolBalance decrement, no audit
// log entry, and no cycle advancement. It also marked the payout
// COMPLETED using a different field (`processedAt`) than the one
// GroupsService's real payout pipeline uses (`completedAt`), which
// is why completed payouts kept showing a null completedAt.
//
// GroupsService (_executePayoutUnderLock, in groups.module.ts) is
// the single, correct owner of payout processing: it verifies the
// pool balance, decrements it, credits the wallet, writes the audit
// log, and advances the cycle — all inside one transaction, only
// once every active member's contribution for that cycle is PAID.
// Having a second system race it against that logic caused payouts
// to be marked complete before the pool was ever paid out, silently
// blocking the real payout from ever running for that cycle.
// ============================================================
//
// FIX #2: PLATFORM_FEE_PERCENT was a hardcoded module-level constant,
// so Super Admin's "Platform fee (%)" setting (persisted to the
// PlatformSetting table) was saved but never read by anything —
// every withdrawal was silently charged the original 1% forever,
// regardless of what was saved in Settings. Fee calculation now
// pulls the live value from PlatformSetting on every request, with
// the original 1% kept only as a fallback if that row is ever
// missing (e.g. before it's first seeded).
// ============================================================
//
// FIX #3: verifyBankAccount() swallowed the real Paystack error and
// always threw the same generic "Could not verify account" message
// regardless of the actual cause (bad secret key, wrong bank code,
// test-mode restriction, Paystack outage, etc). Now logs the real
// response and surfaces Paystack's own message where available.
// ============================================================

import {
  Module, Controller, Post, Get, Body, Req,
  UseGuards, HttpCode, HttpStatus, Injectable,
  BadRequestException, Logger, RawBodyRequest,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNumber, Min, IsString, IsEnum, IsOptional } from 'class-validator';
import { Request } from 'express';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import * as crypto from 'crypto';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.module';
import { JwtAuthGuard } from '../auth/auth.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletModule } from '../wallet/wallet.module';

// ── Constants ─────────────────────────────────────────────────
// Fallback only — used if the PlatformSetting row somehow doesn't
// exist yet. The real, live value is fetched from the DB on every
// fee calculation via PaymentsService.getPlatformFeePercent().
const DEFAULT_PLATFORM_FEE_PERCENT = 1
const MIN_WITHDRAWAL_NAIRA  = 500
const MAX_WITHDRAWAL_NAIRA  = 5_000_000

// ── Fee helpers ───────────────────────────────────────────────
// Paystack bank transfer fees: ₦10 flat ≤ ₦5k, ₦25 flat above
function calcPaystackTransferFee(amountNaira: number): number {
  return amountNaira <= 5_000 ? 10 : 25
}

function calcPlatformFee(amountNaira: number, platformFeePercent: number): number {
  return Math.ceil(amountNaira * (platformFeePercent / 100))
}

function calcWithdrawalFees(amountNaira: number, platformFeePercent: number) {
  const platformFee     = calcPlatformFee(amountNaira, platformFeePercent)
  const paystackFee     = calcPaystackTransferFee(amountNaira)
  const totalFees       = platformFee + paystackFee
  const amountAfterFees = amountNaira - totalFees
  return { platformFee, paystackFee, totalFees, amountAfterFees }
}

// ── DTOs ─────────────────────────────────────────────────────

export class InitiatePaymentDto {
  @IsNumber() @Min(100)
  amount: number

  // Flutterwave temporarily disabled — Paystack only for now
  @IsString() @IsEnum(['paystack'])
  provider: string

  @IsString()
  purpose: string

  @IsOptional() @IsString()
  groupId?: string
}

export class VerifyPaymentDto {
  @IsString() reference: string
  // Flutterwave temporarily disabled — Paystack only for now
  @IsString() @IsEnum(['paystack']) provider: string
}

export class WithdrawDto {
  @IsNumber() @Min(MIN_WITHDRAWAL_NAIRA)
  amount: number

  @IsString() accountNumber: string
  @IsString() bankCode: string
  @IsString() accountName: string

  // Frontend sends this (the bank's display name, e.g. "OPay Digital
  // Services") alongside bankCode so receipts/transaction rows can show
  // a human-readable bank name. Was missing from the DTO, so with
  // forbidNonWhitelisted: true in main.ts, every withdrawal request was
  // rejected outright — this is what fixes that.
  @IsOptional() @IsString()
  bankName?: string

  @IsOptional() @IsString()
  transactionPin?: string
}

// ── Payment Service ───────────────────────────────────────────

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Live platform fee lookup ──────────────────────────────
  // PlatformSetting is a singleton row (one row total). findFirst()
  // is used rather than a hardcoded id so this doesn't need to know
  // or assume what id the settings row was seeded with.
  private async getPlatformFeePercent(): Promise<number> {
    const setting = await this.prisma.platformSetting.findFirst({
      select: { platformFeePercent: true },
    })
    if (!setting) {
      this.logger.warn('No PlatformSetting row found — falling back to default platform fee')
      return DEFAULT_PLATFORM_FEE_PERCENT
    }
    return Number(setting.platformFeePercent)
  }

  // ── Fee preview (call before showing withdrawal form) ─────
  async getWithdrawalFeePreview(amountNaira: number) {
    if (amountNaira < MIN_WITHDRAWAL_NAIRA)
      throw new BadRequestException(`Minimum withdrawal is ₦${MIN_WITHDRAWAL_NAIRA}`)

    const platformFeePercent = await this.getPlatformFeePercent()
    const fees = calcWithdrawalFees(amountNaira, platformFeePercent)
    return {
      requestedAmount: amountNaira,
      platformFee:     fees.platformFee,
      paystackFee:     fees.paystackFee,
      totalFees:       fees.totalFees,
      youWillReceive:  fees.amountAfterFees,
      breakdown: [
        { label: 'Withdrawal amount',                     amount:  amountNaira        },
        { label: `Platform fee (${platformFeePercent}%)`, amount: -fees.platformFee    },
        { label: 'Transfer fee',                          amount: -fees.paystackFee    },
        { label: 'You will receive',                      amount:  fees.amountAfterFees },
      ],
    }
  }

  // ── Initiate wallet funding ───────────────────────────────
  async initiatePayment(userId: string, dto: InitiatePaymentDto) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { email: true, firstName: true, lastName: true },
    })
    const amountKobo = Math.round(dto.amount * 100)
    const reference  = `PP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

    // Flutterwave temporarily disabled — Paystack only for now
    return this.initiatePaystack(user, amountKobo, reference, dto)
  }

  private async initiatePaystack(user: any, amountKobo: number, reference: string, dto: InitiatePaymentDto) {
    const secretKey = this.configService.get('paystack.secretKey')
    try {
      const { data } = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email: user.email, amount: amountKobo, reference,
          metadata:     { purpose: dto.purpose, groupId: dto.groupId },
          callback_url: `${this.configService.get('app.frontendUrl')}/payment/verify`,
        },
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      return { provider: 'paystack', reference, authorizationUrl: data.data.authorization_url, accessCode: data.data.access_code }
    } catch (err) {
      this.logger.error('Paystack init failed', err.response?.data)
      throw new BadRequestException('Payment initialization failed')
    }
  }

  // Dormant — Flutterwave disabled, kept here in case it's re-enabled later
  private async initiateFlutterwave(user: any, amountKobo: number, reference: string, dto: InitiatePaymentDto) {
    const secretKey = this.configService.get('flutterwave.secretKey')
    try {
      const { data } = await axios.post(
        'https://api.flutterwave.com/v3/payments',
        {
          tx_ref: reference, amount: amountKobo / 100, currency: 'NGN',
          redirect_url: `${this.configService.get('app.frontendUrl')}/payment/verify`,
          customer:     { email: user.email, name: `${user.firstName} ${user.lastName}` },
          customizations: { title: 'PayPaddy Wallet Funding', logo: '' },
          meta: { purpose: dto.purpose, groupId: dto.groupId },
        },
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      return { provider: 'flutterwave', reference, authorizationUrl: data.data.link }
    } catch (err) {
      this.logger.error('Flutterwave init failed', err.response?.data)
      throw new BadRequestException('Payment initialization failed')
    }
  }

  // ── Verify payment after redirect ────────────────────────
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const existing = await this.prisma.paymentRecord.findFirst({ where: { providerRef: dto.reference } })
    if (existing?.verifiedAt) return { status: 'already_processed', message: 'Payment already verified' }

    // Flutterwave temporarily disabled — Paystack only for now
    return this.verifyPaystack(userId, dto.reference)
  }

  private async verifyPaystack(userId: string, reference: string) {
    const secretKey = this.configService.get('paystack.secretKey')
    try {
      const { data } = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      if (data.data.status !== 'success')
        throw new BadRequestException(`Payment failed: ${data.data.gateway_response}`)
      return this.creditUserWallet(userId, BigInt(data.data.amount), reference, 'paystack', data.data.metadata, data.data)
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      throw new BadRequestException('Payment verification failed')
    }
  }

  // Dormant — Flutterwave disabled, kept here in case it's re-enabled later
  private async verifyFlutterwave(userId: string, reference: string) {
    const secretKey = this.configService.get('flutterwave.secretKey')
    try {
      const { data } = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${reference}/verify`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      if (data.data.status !== 'successful') throw new BadRequestException('Payment not successful')
      return this.creditUserWallet(userId, BigInt(Math.round(data.data.amount * 100)), reference, 'flutterwave', data.data.meta, data.data)
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      throw new BadRequestException('Payment verification failed')
    }
  }

  // ── Credit wallet (deposits — NO platform fee) ────────────
  private async creditUserWallet(
    userId: string, amountKobo: bigint, reference: string,
    provider: string, metadata: any, rawPayload: any,
  ) {
    return this.prisma.executeTransaction(async (tx) => {
      const already = await tx.transaction.findFirst({ where: { reference } })
      if (already) return { success: true, amount: Number(amountKobo) / 100, reference, message: 'Wallet funded successfully' }

      const wallet = await tx.wallet.findUnique({ where: { userId } })

      const transaction = await tx.transaction.create({
        data: {
          userId, walletId: wallet.id, type: 'WALLET_FUNDING', status: 'COMPLETED',
          amount: amountKobo, balanceBefore: wallet.balance, balanceAfter: wallet.balance + amountKobo,
          reference, externalRef: reference, provider: provider.toUpperCase() as any,
          description: 'Wallet funding', metadata,
        },
      })

      await tx.wallet.update({ where: { userId }, data: { balance: { increment: amountKobo } } })

      await tx.paymentRecord.create({
        data: {
          transactionId: transaction.id, provider: provider.toUpperCase() as any,
          providerRef: reference, amount: amountKobo, status: 'success',
          webhookPayload: rawPayload, verifiedAt: new Date(),
        },
      })

      // NOTE: no totalContributed increment — wallet funding ≠ ajo contribution

      await this.notificationsService.create({
        userId, type: 'WALLET_FUNDED', title: 'Wallet Funded',
        body: `₦${Number(amountKobo) / 100} has been added to your wallet`,
        data: { amount: Number(amountKobo) / 100, reference },
      })

      return { success: true, amount: Number(amountKobo) / 100, reference, message: 'Wallet funded successfully' }
    })
  }

  // ── WITHDRAWAL: wallet → bank account ────────────────────
  // Platform fee (live from PlatformSetting) + Paystack transfer fee
  // deducted from amount. User requests ₦X, receives ₦X minus fees.
  async initiateWithdrawal(userId: string, dto: WithdrawDto) {
    const amountNaira = dto.amount
    const amountKobo  = BigInt(Math.round(amountNaira * 100))

    if (amountNaira < MIN_WITHDRAWAL_NAIRA)
      throw new BadRequestException(`Minimum withdrawal is ₦${MIN_WITHDRAWAL_NAIRA}`)
    if (amountNaira > MAX_WITHDRAWAL_NAIRA)
      throw new BadRequestException(`Maximum withdrawal is ₦${MAX_WITHDRAWAL_NAIRA.toLocaleString()} per transaction`)

    const platformFeePercent = await this.getPlatformFeePercent()
    const fees            = calcWithdrawalFees(amountNaira, platformFeePercent)
    const totalFeesKobo   = BigInt(Math.round(fees.totalFees * 100))
    const amountAfterKobo = BigInt(Math.round(fees.amountAfterFees * 100))

    if (fees.amountAfterFees <= 0)
      throw new BadRequestException('Amount too small after fees')

    // Check balance
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } })
    if (!wallet) throw new BadRequestException('Wallet not found')

    const available = wallet.balance - wallet.lockedBalance
    if (available < amountKobo)
      throw new BadRequestException(`Insufficient balance. Available: ₦${(Number(available) / 100).toLocaleString()}`)

    const secretKey = this.configService.get('paystack.secretKey')

    // Verify bank account first (before touching wallet)
    // FIX: swallowed the real Paystack error before — logs it now so a
    // failure here shows exactly why in the terminal instead of just
    // "Could not verify bank account."
    try {
      const res = await axios.get(
        `https://api.paystack.co/bank/resolve?account_number=${dto.accountNumber}&bank_code=${dto.bankCode}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      if (!res.data.status) throw new Error('Paystack returned status: false')
    } catch (err) {
      this.logger.error(
        'Bank resolve failed during withdrawal',
        err.response?.data || err.message,
      )
      throw new BadRequestException(
        err.response?.data?.message || 'Could not verify bank account. Please check your details.',
      )
    }

    const reference = `WD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

    // Deduct from wallet atomically
    await this.prisma.executeTransaction(async (tx) => {
      const fresh     = await tx.wallet.findUnique({ where: { userId } })
      const freshAvail = fresh.balance - fresh.lockedBalance
      if (freshAvail < amountKobo) throw new BadRequestException('Insufficient balance')

      await tx.wallet.update({ where: { userId }, data: { balance: { decrement: amountKobo } } })

      await tx.transaction.create({
        data: {
          userId, walletId: fresh.id, type: 'WITHDRAWAL', status: 'PENDING',
          amount: amountKobo, fee: totalFeesKobo,
          balanceBefore: fresh.balance, balanceAfter: fresh.balance - amountKobo,
          reference, description: `Withdrawal to ${dto.accountName} (${dto.accountNumber})`,
          metadata: {
            accountNumber:   dto.accountNumber, bankCode: dto.bankCode,
            accountName:     dto.accountName,   bankName: dto.bankName,
            platformFee: fees.platformFee,
            platformFeePercent, paystackFee: fees.paystackFee,
            amountAfterFees: fees.amountAfterFees,
          },
        },
      })
    })

    // Initiate Paystack transfer
    try {
      const recipientRes = await axios.post(
        'https://api.paystack.co/transferrecipient',
        { type: 'nuban', name: dto.accountName, account_number: dto.accountNumber, bank_code: dto.bankCode, currency: 'NGN' },
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )

      await axios.post(
        'https://api.paystack.co/transfer',
        {
          source: 'balance', amount: Number(amountAfterKobo), // kobo
          recipient: recipientRes.data.data.recipient_code,
          reason: 'PayPaddy withdrawal', reference,
        },
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )

      await this.prisma.transaction.updateMany({ where: { reference }, data: { status: 'PROCESSING' } })

      // Route the platform fee into the platform revenue (SYSTEM) wallet instead
      // of it just being an untracked surplus. Does NOT include the Paystack transfer
      // fee, since that's paid out externally and isn't retained revenue.
      if (fees.platformFee > 0) {
        const platformFeeKobo = BigInt(Math.round(fees.platformFee * 100))
        const systemWallet = await this.prisma.wallet.findUnique({ where: { userId: 'SYSTEM' } })
        if (systemWallet) {
          await this.prisma.executeTransaction(async (tx) => {
            await tx.wallet.update({ where: { userId: 'SYSTEM' }, data: { balance: { increment: platformFeeKobo } } })
            await tx.transaction.create({
              data: {
                userId: 'SYSTEM', walletId: systemWallet.id, type: 'WALLET_FUNDING', status: 'COMPLETED',
                amount: platformFeeKobo, balanceBefore: systemWallet.balance, balanceAfter: systemWallet.balance + platformFeeKobo,
                reference: `PLATFORMFEE-${reference}`, description: `Platform fee (${platformFeePercent}%) from withdrawal by user ${userId}`,
                metadata: { source: 'withdrawal_platform_fee', fromUserId: userId, originalReference: reference, platformFeePercent },
              },
            })
          }).catch((e) => this.logger.error('Failed to credit platform fee to SYSTEM wallet', e))
        }
      }

      await this.notificationsService.create({
        userId, type: 'SYSTEM', title: 'Withdrawal in progress',
        body: `₦${fees.amountAfterFees.toLocaleString()} is being sent to your bank. This usually takes a few minutes.`,
        data: { amount: fees.amountAfterFees, reference },
      })

      this.logger.log(`Withdrawal: ₦${amountNaira} → ₦${fees.amountAfterFees} sent to ${dto.accountNumber} (${reference}) [platform fee ${platformFeePercent}%]`)

      return {
        success: true, reference,
        amountRequested: amountNaira,
        platformFee:     fees.platformFee,
        paystackFee:     fees.paystackFee,
        amountSent:      fees.amountAfterFees,
        message: `₦${fees.amountAfterFees.toLocaleString()} is being sent to your bank account`,
      }
    } catch (err) {
      // Paystack failed — refund wallet
      this.logger.error('Paystack transfer failed — refunding', err.response?.data)

      await this.prisma.executeTransaction(async (tx) => {
        const w = await tx.wallet.findUnique({ where: { userId } })
        await tx.wallet.update({ where: { userId }, data: { balance: { increment: amountKobo } } })
        await tx.transaction.updateMany({ where: { reference }, data: { status: 'FAILED' } })
        await tx.transaction.create({
          data: {
            userId, walletId: w.id, type: 'REFUND', status: 'COMPLETED',
            amount: amountKobo, balanceBefore: w.balance, balanceAfter: w.balance + amountKobo,
            reference: `REFUND-${reference}`, description: 'Withdrawal failed — funds refunded',
            metadata: { originalReference: reference },
          },
        })
      })

      await this.notificationsService.create({
        userId, type: 'SYSTEM', title: 'Withdrawal failed',
        body: 'Your withdrawal could not be processed. Funds have been returned to your wallet.',
        data: { reference },
      })

      throw new BadRequestException('Withdrawal failed. Your funds have been returned to your wallet.')
    }
  }

  // ── Bank helpers ──────────────────────────────────────────
  async getBanks() {
    const secretKey = this.configService.get('paystack.secretKey')
    try {
      const { data } = await axios.get(
        'https://api.paystack.co/bank?country=nigeria&perPage=100',
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      return data.data.map((b: any) => ({ name: b.name, code: b.code }))
    } catch { throw new BadRequestException('Could not fetch bank list') }
  }

  // FIX: this used to catch-and-discard the real Paystack error, always
  // throwing the same generic "Could not verify account" message no
  // matter what actually went wrong (wrong/missing secret key, invalid
  // bank code, Paystack test-mode daily resolve limit, network error,
  // Paystack outage, etc). Now it logs the real response body and
  // surfaces Paystack's own message when one is available, so the
  // terminal tells you the actual cause instead of a dead end.
  async verifyBankAccount(accountNumber: string, bankCode: string) {
    const secretKey = this.configService.get('paystack.secretKey')
    try {
      const { data } = await axios.get(
        `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      if (!data.status) throw new Error('Paystack returned status: false')
      return { accountName: data.data.account_name, accountNumber: data.data.account_number }
    } catch (err) {
      this.logger.error(
        `Paystack account resolve failed (accountNumber=${accountNumber}, bankCode=${bankCode})`,
        err.response?.data || err.message,
      )
      throw new BadRequestException(
        err.response?.data?.message || 'Could not verify account. Check account number and bank.',
      )
    }
  }

  // ── Cron: flag stuck withdrawals after 24h ────────────────
  @Cron(CronExpression.EVERY_HOUR)
  async checkStuckWithdrawals() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const stuck  = await this.prisma.transaction.findMany({
      where: { type: 'WITHDRAWAL', status: 'PROCESSING', createdAt: { lt: cutoff } },
    })
    for (const tx of stuck) {
      this.logger.warn(`Withdrawal ${tx.reference} stuck >24h — flagging`)
      await this.prisma.transaction.update({
        where: { id: tx.id },
        data:  { status: 'FAILED', metadata: { ...(tx.metadata as any), flaggedReason: 'Stuck >24h' } },
      })
      await this.notificationsService.create({
        userId: tx.userId, type: 'SYSTEM', title: 'Withdrawal under review',
        body: 'Your withdrawal is taking longer than expected. Contact support if needed.',
        data: { reference: tx.reference },
      })
    }
  }

  // ── Paystack Webhook ──────────────────────────────────────
  async handlePaystackWebhook(payload: Buffer, signature: string) {
    const secret      = this.configService.get('paystack.webhookSecret')
    const expectedSig = crypto.createHmac('sha512', secret).update(payload).digest('hex')
    if (expectedSig !== signature) { this.logger.warn('Invalid Paystack webhook signature'); return }

    const event = JSON.parse(payload.toString())
    this.logger.log(`Paystack webhook: ${event.event}`)

    switch (event.event) {
      case 'charge.success':      await this.handlePaystackChargeSuccess(event.data); break
      case 'transfer.success':    await this.handlePaystackTransferSuccess(event.data); break
      case 'transfer.failed':
      case 'transfer.reversed':   await this.handlePaystackTransferFailed(event.data); break
    }
  }

  private async handlePaystackChargeSuccess(data: any) {
    const existing = await this.prisma.paymentRecord.findFirst({ where: { providerRef: data.reference } })
    if (existing) return
    const user = await this.prisma.user.findUnique({ where: { email: data.customer.email } })
    if (!user) return
    await this.creditUserWallet(user.id, BigInt(data.amount), data.reference, 'paystack', data.metadata, data)
  }

  private async handlePaystackTransferSuccess(data: any) {
    await this.prisma.transaction.updateMany({
      where: { reference: data.reference, type: 'WITHDRAWAL' },
      data:  { status: 'COMPLETED' },
    })
    const tx = await this.prisma.transaction.findFirst({ where: { reference: data.reference } })
    if (tx) {
      await this.notificationsService.create({
        userId: tx.userId, type: 'SYSTEM', title: '✅ Withdrawal successful',
        body: `₦${(Number(tx.amount) / 100 - Number(tx.fee ?? 0n) / 100).toLocaleString()} has been sent to your bank account.`,
        data: { reference: data.reference },
      })
    }
  }

  private async handlePaystackTransferFailed(data: any) {
    const tx = await this.prisma.transaction.findFirst({
      where: { reference: data.reference, type: 'WITHDRAWAL' },
    })
    if (!tx) return

    await this.prisma.executeTransaction(async (prismaClient) => {
      const wallet = await prismaClient.wallet.findUnique({ where: { userId: tx.userId } })
      await prismaClient.wallet.update({ where: { userId: tx.userId }, data: { balance: { increment: tx.amount } } })
      await prismaClient.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } })
      await prismaClient.transaction.create({
        data: {
          userId: tx.userId, walletId: wallet.id, type: 'REFUND', status: 'COMPLETED',
          amount: tx.amount, balanceBefore: wallet.balance, balanceAfter: wallet.balance + tx.amount,
          reference: `REFUND-${data.reference}`, description: 'Withdrawal failed — funds refunded',
          metadata: { originalReference: data.reference, reason: data.reason },
        },
      })
    })

    await this.notificationsService.create({
      userId: tx.userId, type: 'SYSTEM', title: '❌ Withdrawal failed',
      body: 'Your withdrawal failed and funds have been returned to your wallet.',
      data: { reference: data.reference },
    })
  }

  // ── Flutterwave Webhook ───────────────────────────────────
  // Dormant — Flutterwave disabled, kept here in case it's re-enabled later.
  // Since nothing can initiate a Flutterwave payment anymore, this should
  // never receive a legitimate, correctly-signed event in practice.
  async handleFlutterwaveWebhook(payload: any, signature: string) {
    const secret      = this.configService.get('flutterwave.webhookSecret')
    const expectedSig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
    if (expectedSig !== signature) { this.logger.warn('Invalid Flutterwave webhook signature'); return }

    if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
      const existing = await this.prisma.paymentRecord.findFirst({ where: { providerRef: payload.data.tx_ref } })
      if (existing) return
      const user = await this.prisma.user.findUnique({ where: { email: payload.data.customer.email } })
      if (!user) return
      await this.creditUserWallet(user.id, BigInt(Math.round(payload.data.amount * 100)), payload.data.tx_ref, 'flutterwave', payload.data.meta, payload.data)
    }
  }
}

// ── Payments Controller ───────────────────────────────────────

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initiate')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate wallet funding' })
  initiatePayment(@Req() req: any, @Body() dto: InitiatePaymentDto) {
    return this.paymentsService.initiatePayment(req.user.id, dto)
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify payment after redirect' })
  verifyPayment(@Req() req: any, @Body() dto: VerifyPaymentDto) {
    return this.paymentsService.verifyPayment(req.user.id, dto)
  }

  @Post('withdraw')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Withdraw wallet balance to bank account' })
  withdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    return this.paymentsService.initiateWithdrawal(req.user.id, dto)
  }

  @Get('withdraw/fees')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Preview withdrawal fees before confirming' })
  getWithdrawalFees(@Req() req: any) {
    const amount = Number(req.query.amount)
    if (!amount || isNaN(amount)) throw new BadRequestException('Pass ?amount=XXXX')
    return this.paymentsService.getWithdrawalFeePreview(amount)
  }

  @Get('banks')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Get list of Nigerian banks for withdrawal form' })
  getBanks() { return this.paymentsService.getBanks() }

  @Get('verify-account')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify bank account number' })
  verifyAccount(@Req() req: any) {
    const { accountNumber, bankCode } = req.query
    if (!accountNumber || !bankCode) throw new BadRequestException('Pass ?accountNumber=&bankCode=')
    return this.paymentsService.verifyBankAccount(accountNumber, bankCode)
  }

  @Post('webhook/paystack')
  @HttpCode(HttpStatus.OK)
  paystackWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') sig: string) {
    return this.paymentsService.handlePaystackWebhook(req.rawBody, sig)
  }

  @Post('webhook/flutterwave')
  @HttpCode(HttpStatus.OK)
  flutterwaveWebhook(@Body() payload: any, @Headers('verif-hash') sig: string) {
    return this.paymentsService.handleFlutterwaveWebhook(payload, sig)
  }
}

@Module({
  imports:     [WalletModule, NotificationsModule],
  controllers: [PaymentsController],
  providers:   [PaymentsService],
  exports:     [PaymentsService],
})
export class PaymentsModule {}