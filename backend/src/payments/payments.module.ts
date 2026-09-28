// ============================================================
// PAYMENTS MODULE — Paystack only for now (Flutterwave disabled)
// ============================================================
// FIX: removed the `processScheduledPayouts` cron and its helper
// `creditPayoutToWallet`. GroupsService (_executePayoutUnderLock, in
// groups.module.ts) is the single, correct owner of payout processing.
// ============================================================
//
// FIX #2: platform fee is read live from the PlatformSetting table on
// every request (falls back to 1% only if the row is missing).
// ============================================================
//
// FIX #3: verifyBankAccount() logs and surfaces the real Paystack error.
// ============================================================
//
// FIX #4 (withdrawals):
//  - Paystack balance is checked BEFORE the user's wallet is debited,
//    so a low Paystack balance never causes a debit-then-refund cycle.
//  - A user is only refunded when Paystack CLEARLY rejected the transfer
//    (4xx). Timeouts / network errors / 5xx leave the withdrawal PENDING
//    and the webhook or reconciliation cron settles it. This prevents
//    paying the user AND refunding them.
//  - All refunds go through refundFailedWithdrawal(), which only acts on
//    PENDING/PROCESSING withdrawals, so duplicate webhooks, the cron and
//    the request handler can never refund the same withdrawal twice.
//  - Post-transfer steps (status update, platform fee, notification) can
//    never trigger a refund.
//  - checkStuckWithdrawals verifies with Paystack instead of blindly
//    marking withdrawals FAILED (which used to make user money vanish).
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

  // Frontend sends the bank's display name alongside bankCode so
  // receipts/transaction rows can show a human-readable bank name.
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

  // ── Paystack balance lookup ───────────────────────────────
  // Returns null if the lookup itself fails, so a hiccup on /balance
  // doesn't block withdrawals; the transfer call decides in that case.
  private async getPaystackBalanceKobo(): Promise<bigint | null> {
    const secretKey = this.configService.get('paystack.secretKey')
    try {
      const { data } = await axios.get('https://api.paystack.co/balance', {
        headers: { Authorization: `Bearer ${secretKey}` },
      })
      const ngn = data.data?.find((b: any) => b.currency === 'NGN')
      return ngn ? BigInt(ngn.balance) : 0n
    } catch (err) {
      this.logger.error('Could not fetch Paystack balance', err.response?.data || err.message)
      return null
    }
  }

  // ── Idempotent refund ─────────────────────────────────────
  // The updateMany is the guard: it only flips PENDING/PROCESSING -> FAILED.
  // If the withdrawal is already FAILED or COMPLETED, count is 0 and NO
  // refund happens. Returns true if it refunded, false if already handled.
  private async refundFailedWithdrawal(
    userId: string,
    amountKobo: bigint,
    reference: string,
    reason: string,
  ): Promise<boolean> {
    const refunded = await this.prisma.executeTransaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { reference, type: 'WITHDRAWAL', status: { in: ['PENDING', 'PROCESSING'] } },
        data:  { status: 'FAILED' },
      })
      if (claimed.count === 0) return false

      const w = await tx.wallet.findUnique({ where: { userId } })
      await tx.wallet.update({ where: { userId }, data: { balance: { increment: amountKobo } } })
      await tx.transaction.create({
        data: {
          userId, walletId: w.id, type: 'REFUND', status: 'COMPLETED',
          amount: amountKobo, balanceBefore: w.balance, balanceAfter: w.balance + amountKobo,
          reference: `REFUND-${reference}`, description: 'Withdrawal failed — funds refunded',
          metadata: { originalReference: reference, reason },
        },
      })
      return true
    })

    if (refunded) {
      await this.notificationsService.create({
        userId, type: 'SYSTEM', title: '❌ Withdrawal failed',
        body: 'Your withdrawal could not be processed. Funds have been returned to your wallet.',
        data: { reference },
      }).catch((e) => this.logger.error('Refund notification failed', e))
    }
    return refunded
  }

  // ── Platform fee -> SYSTEM wallet (idempotent) ────────────
  // Does NOT include the Paystack transfer fee (paid out externally,
  // not retained revenue).
  private async creditPlatformFee(
    fromUserId: string,
    reference: string,
    platformFeeNaira: number,
    platformFeePercent: number,
  ) {
    if (!platformFeeNaira || platformFeeNaira <= 0) return
    const feeRef = `PLATFORMFEE-${reference}`
    try {
      const already = await this.prisma.transaction.findFirst({ where: { reference: feeRef } })
      if (already) return

      const platformFeeKobo = BigInt(Math.round(platformFeeNaira * 100))
      const systemWallet = await this.prisma.wallet.findUnique({ where: { userId: 'SYSTEM' } })
      if (!systemWallet) return

      await this.prisma.executeTransaction(async (tx) => {
        await tx.wallet.update({ where: { userId: 'SYSTEM' }, data: { balance: { increment: platformFeeKobo } } })
        await tx.transaction.create({
          data: {
            userId: 'SYSTEM', walletId: systemWallet.id, type: 'WALLET_FUNDING', status: 'COMPLETED',
            amount: platformFeeKobo, balanceBefore: systemWallet.balance, balanceAfter: systemWallet.balance + platformFeeKobo,
            reference: feeRef,
            description: `Platform fee (${platformFeePercent}%) from withdrawal by user ${fromUserId}`,
            metadata: { source: 'withdrawal_platform_fee', fromUserId, originalReference: reference, platformFeePercent },
          },
        })
      })
    } catch (e) {
      this.logger.error('Failed to credit platform fee to SYSTEM wallet', e)
    }
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

    // Check user's wallet balance
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } })
    if (!wallet) throw new BadRequestException('Wallet not found')

    const available = wallet.balance - wallet.lockedBalance
    if (available < amountKobo)
      throw new BadRequestException(`Insufficient balance. Available: ₦${(Number(available) / 100).toLocaleString()}`)

    // ── Paystack balance pre-check (before touching the user's wallet) ──
    const paystackBalance = await this.getPaystackBalanceKobo()
    const requiredKobo = amountAfterKobo + BigInt(fees.paystackFee * 100)
    if (paystackBalance !== null && paystackBalance < requiredKobo) {
      this.logger.error(
        `LOW PAYSTACK BALANCE: need ₦${Number(requiredKobo) / 100}, have ₦${Number(paystackBalance) / 100}. Top up now.`,
      )
      throw new BadRequestException('Withdrawals are temporarily unavailable. Please try again later.')
    }

    const secretKey = this.configService.get('paystack.secretKey')

    // Verify bank account first (before touching wallet)
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
      const fresh      = await tx.wallet.findUnique({ where: { userId } })
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

    // ── STEP 1: create transfer recipient ──────────────────────
    // Nothing has been sent yet, so ANY failure here is safe to refund.
    let recipientCode: string
    try {
      const recipientRes = await axios.post(
        'https://api.paystack.co/transferrecipient',
        { type: 'nuban', name: dto.accountName, account_number: dto.accountNumber, bank_code: dto.bankCode, currency: 'NGN' },
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      recipientCode = recipientRes.data.data.recipient_code
    } catch (err) {
      this.logger.error('Paystack recipient creation failed — refunding', err.response?.data || err.message)
      await this.refundFailedWithdrawal(userId, amountKobo, reference, 'recipient_creation_failed')
      throw new BadRequestException('Withdrawal failed. Your funds have been returned to your wallet.')
    }

    // ── STEP 2: send the transfer ──────────────────────────────
    // Only refund when Paystack CLEARLY rejected it (4xx). A timeout,
    // network error or 5xx means the money may have gone out, so we must
    // NOT refund; the webhook or reconciliation cron will settle it.
    try {
      const transferRes = await axios.post(
        'https://api.paystack.co/transfer',
        { source: 'balance', amount: Number(amountAfterKobo), recipient: recipientCode, reason: 'PayPaddy withdrawal', reference },
        { headers: { Authorization: `Bearer ${secretKey}` }, timeout: 30000 },
      )

      // With OTP confirmation ON, Paystack returns 200 with status 'otp'
      // and the money does NOT move. Turn OTP off in Paystack settings.
      if (transferRes.data?.data?.status === 'otp') {
        this.logger.error(`Transfer ${reference} is waiting for OTP. Disable OTP confirmation in Paystack settings.`)
        await this.refundFailedWithdrawal(userId, amountKobo, reference, 'paystack_otp_required')
        throw new BadRequestException('Withdrawal failed. Your funds have been returned to your wallet.')
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err

      const httpStatus = err.response?.status
      const definitelyRejected = httpStatus >= 400 && httpStatus < 500

      if (definitelyRejected) {
        this.logger.error('Paystack transfer rejected — refunding', err.response?.data)
        await this.refundFailedWithdrawal(userId, amountKobo, reference, err.response?.data?.code || 'transfer_rejected')
        throw new BadRequestException('Withdrawal failed. Your funds have been returned to your wallet.')
      }

      // Unknown outcome: keep the withdrawal PENDING, do NOT refund.
      this.logger.error(`Transfer outcome UNKNOWN for ${reference} — not refunding`, err.message)
      throw new BadRequestException(
        'Your withdrawal is being processed. Check your transaction history shortly.',
      )
    }

    // ── STEP 3: post-processing ────────────────────────────────
    // Paystack accepted the transfer. Nothing below may EVER trigger a
    // refund, so each step is isolated and only logs on failure.
    try {
      await this.prisma.transaction.updateMany({
        where: { reference, status: 'PENDING' },
        data:  { status: 'PROCESSING' },
      })
    } catch (e) { this.logger.error(`Could not mark ${reference} PROCESSING`, e) }

    await this.creditPlatformFee(userId, reference, fees.platformFee, platformFeePercent)

    await this.notificationsService.create({
      userId, type: 'SYSTEM', title: 'Withdrawal in progress',
      body: `₦${fees.amountAfterFees.toLocaleString()} is being sent to your bank. This usually takes a few minutes.`,
      data: { amount: fees.amountAfterFees, reference },
    }).catch((e) => this.logger.error('Withdrawal notification failed', e))

    this.logger.log(`Withdrawal: ₦${amountNaira} → ₦${fees.amountAfterFees} sent to ${dto.accountNumber} (${reference}) [platform fee ${platformFeePercent}%]`)

    return {
      success: true, reference,
      amountRequested: amountNaira,
      platformFee:     fees.platformFee,
      paystackFee:     fees.paystackFee,
      amountSent:      fees.amountAfterFees,
      message: `₦${fees.amountAfterFees.toLocaleString()} is being sent to your bank account`,
    }
  }

  // ── Reusable: send money out via Paystack Transfer ────────
  async sendBankTransfer(
    amountNaira: number,
    accountNumber: string,
    bankCode: string,
    accountName: string,
    reference: string,
    reason: string,
  ) {
    const secretKey = this.configService.get('paystack.secretKey')
    const amountKobo = Math.round(amountNaira * 100)

    const recipientRes = await axios.post(
      'https://api.paystack.co/transferrecipient',
      { type: 'nuban', name: accountName, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' },
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )

    const transferRes = await axios.post(
      'https://api.paystack.co/transfer',
      { source: 'balance', amount: amountKobo, recipient: recipientRes.data.data.recipient_code, reason, reference },
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )

    return { transferCode: transferRes.data.data.transfer_code, status: transferRes.data.data.status }
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

  // ── Cron: reconcile stuck withdrawals with Paystack ───────
  // Instead of blindly marking stuck withdrawals FAILED (which lost the
  // user's money), ask Paystack what actually happened, then act on it.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkStuckWithdrawals() {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000) // older than 30 min
    const stuck  = await this.prisma.transaction.findMany({
      where: { type: 'WITHDRAWAL', status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: cutoff } },
    })
    const secretKey = this.configService.get('paystack.secretKey')

    for (const tx of stuck) {
      try {
        const { data } = await axios.get(
          `https://api.paystack.co/transfer/verify/${tx.reference}`,
          { headers: { Authorization: `Bearer ${secretKey}` } },
        )
        const status = data.data?.status

        if (status === 'success') {
          await this.prisma.transaction.updateMany({
            where: { id: tx.id, status: { in: ['PENDING', 'PROCESSING'] } },
            data:  { status: 'COMPLETED' },
          })
          const meta: any = tx.metadata || {}
          await this.creditPlatformFee(tx.userId, tx.reference, Number(meta.platformFee || 0), Number(meta.platformFeePercent || 0))
        } else if (status === 'failed' || status === 'reversed') {
          await this.refundFailedWithdrawal(tx.userId, tx.amount, tx.reference, `paystack_${status}`)
        }
        // pending / processing / queued / otp: leave it and check again next run
      } catch (err) {
        if (err.response?.status === 404) {
          // Paystack has no record of this transfer, so no money left. Safe to refund.
          this.logger.warn(`Withdrawal ${tx.reference} not found at Paystack — refunding`)
          await this.refundFailedWithdrawal(tx.userId, tx.amount, tx.reference, 'transfer_not_found')
        } else {
          this.logger.error(`Could not verify stuck withdrawal ${tx.reference}`, err.response?.data || err.message)
        }
      }
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
    const tx = await this.prisma.transaction.findFirst({
      where: { reference: data.reference, type: 'WITHDRAWAL' },
    })
    if (!tx || tx.status === 'COMPLETED') return

    await this.prisma.transaction.updateMany({
      where: { id: tx.id },
      data:  { status: 'COMPLETED' },
    })

    // Covers the case where the request handler never got to credit the fee
    const meta: any = tx.metadata || {}
    await this.creditPlatformFee(tx.userId, tx.reference, Number(meta.platformFee || 0), Number(meta.platformFeePercent || 0))

    await this.notificationsService.create({
      userId: tx.userId, type: 'SYSTEM', title: '✅ Withdrawal successful',
      body: `₦${(Number(tx.amount) / 100 - Number(tx.fee ?? 0n) / 100).toLocaleString()} has been sent to your bank account.`,
      data: { reference: data.reference },
    })
  }

  // refundFailedWithdrawal only refunds if the withdrawal is still
  // PENDING/PROCESSING, so duplicate or late webhooks can't refund twice.
  private async handlePaystackTransferFailed(data: any) {
    const tx = await this.prisma.transaction.findFirst({
      where: { reference: data.reference, type: 'WITHDRAWAL' },
    })
    if (!tx) return
    await this.refundFailedWithdrawal(tx.userId, tx.amount, tx.reference, data.reason || 'transfer_failed')
  }

  // ── Flutterwave Webhook ───────────────────────────────────
  // Dormant — Flutterwave disabled, kept here in case it's re-enabled later.
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