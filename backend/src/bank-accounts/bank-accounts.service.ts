import {
  BadRequestException, ForbiddenException, Injectable, InternalServerErrorException,
  Logger, NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcrypt'            // if your auth service uses 'bcryptjs', change this to 'bcryptjs'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { matchesAny } from './name-match'

const MAX_ACCOUNTS = 3
const PAYSTACK = 'https://api.paystack.co'

@Injectable()
export class BankAccountsService {
  private readonly log = new Logger(BankAccountsService.name)

  constructor(private prisma: PrismaService, private config: ConfigService, private mail: MailService) {}

  // ── Paystack ────────────────────────────────────────────────
  private async paystack<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data?: T; message?: string }> {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY')
    if (!key) throw new InternalServerErrorException('Payments are not configured')
    const res = await fetch(`${PAYSTACK}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    const body: any = await res.json().catch(() => ({}))
    return { ok: res.ok && body?.status !== false, status: res.status, data: body?.data, message: body?.message }
  }

  private async resolveName(bankCode: string, accountNumber: string): Promise<string> {
    const r = await this.paystack<{ account_name: string }>(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`,
    )
    if (!r.ok || !r.data?.account_name) {
      this.log.warn(`resolve failed (${r.status}): ${r.message}`)
      throw new BadRequestException('We could not verify this account. Check the bank and account number.')
    }
    return r.data.account_name
  }

  // ── helpers ─────────────────────────────────────────────────
  private async getUser(userId: string) {
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identityRecord: true },
    })
    if (!user) throw new NotFoundException('User not found')
    return user
  }

  /** Names we compare the bank name against: verified KYC name first, then profile name. */
  private referenceNames(user: any): string[] {
    const kyc = [user.identityRecord?.firstName, user.identityRecord?.lastName].filter(Boolean).join(' ')
    const profile = [user.firstName, user.lastName].filter(Boolean).join(' ')
    return [kyc, profile].filter(Boolean)
  }

  private async assertPin(user: any, pin: string) {
    const hash: string | undefined = user.transactionPinHash
    if (!hash) throw new BadRequestException('Set your transaction PIN first')
    if (!(await bcrypt.compare(pin, hash))) throw new ForbiddenException('Incorrect transaction PIN')
  }

  private hashAccount(bankCode: string, accountNumber: string) {
    const pepper = this.config.get<string>('BANK_HASH_PEPPER') || this.config.get<string>('JWT_SECRET') || ''
    return createHash('sha256').update(`${pepper}:${bankCode}:${accountNumber}`).digest('hex')
  }

  private toDto(a: any) {
    // recipientCode and hash never leave the server
    return {
      id: a.id, bankName: a.bankName, accountName: a.accountName, last4: a.accountLast4,
      isDefault: a.isDefault, usableAfter: a.usableAfter, createdAt: a.createdAt,
    }
  }

  // ── API ─────────────────────────────────────────────────────
  async list(userId: string) {
    const rows = await this.prisma.bankAccount.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
    return rows.map(r => this.toDto(r))
  }

  /** Preview step. The third-party account holder's name is only returned when it matches the user. */
  async resolve(userId: string, bankCode: string, accountNumber: string) {
    const user = await this.getUser(userId)
    const accountName = await this.resolveName(bankCode, accountNumber)
    const matched = matchesAny(this.referenceNames(user), accountName)
    return matched
      ? { matched: true, accountName }
      : { matched: false, reason: "The name on this account doesn't match your verified identity. You can only add accounts in your own name." }
  }

  async add(userId: string, bankCode: string, accountNumber: string, pin: string, bankName?: string) {
    const user = await this.getUser(userId)
    await this.assertPin(user, pin)

    if ((await this.prisma.bankAccount.count({ where: { userId } })) >= MAX_ACCOUNTS) {
      throw new BadRequestException(`You can save up to ${MAX_ACCOUNTS} bank accounts. Remove one first.`)
    }

    // Always re-resolve on the server; never trust a name sent by the client.
    const accountName = await this.resolveName(bankCode, accountNumber)
    if (!matchesAny(this.referenceNames(user), accountName)) {
      throw new ForbiddenException("This account isn't in your name. Contact support if you think this is a mistake.")
    }

    const accountHash = this.hashAccount(bankCode, accountNumber)
    if (await this.prisma.bankAccount.findUnique({ where: { userId_accountHash: { userId, accountHash } } })) {
      throw new BadRequestException('This account is already saved')
    }

    const rec = await this.paystack<{ recipient_code: string; details?: { bank_name?: string } }>('/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({ type: 'nuban', name: accountName, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' }),
    })
    if (!rec.ok || !rec.data?.recipient_code) {
      this.log.error(`recipient failed (${rec.status}): ${rec.message}`)
      throw new BadRequestException('Could not save this account with our payment provider. Try again.')
    }

    const holdHours = Number(this.config.get('BANK_ACCOUNT_HOLD_HOURS') ?? 24)
    const isFirst = (await this.prisma.bankAccount.count({ where: { userId } })) === 0
    const row = await this.prisma.bankAccount.create({
      data: {
        userId, bankCode, accountName, accountHash,
        bankName: rec.data.details?.bank_name || bankName || 'Bank',
        accountLast4: accountNumber.slice(-4),
        recipientCode: rec.data.recipient_code,
        isDefault: isFirst,
        usableAfter: new Date(Date.now() + holdHours * 3600_000),
      },
    })

    void this.mail.sendBankAccountAlert(user.email, user.firstName, 'added', row.bankName, row.accountLast4)
    this.log.log(`bank account added user=${userId} last4=${row.accountLast4}`)
    return this.toDto(row)
  }

  async setDefault(userId: string, id: string, pin: string) {
    const user = await this.getUser(userId)
    await this.assertPin(user, pin)
    const acct = await this.prisma.bankAccount.findFirst({ where: { id, userId } })
    if (!acct) throw new NotFoundException('Account not found')
    await this.prisma.$transaction([
      this.prisma.bankAccount.updateMany({ where: { userId }, data: { isDefault: false } }),
      this.prisma.bankAccount.update({ where: { id }, data: { isDefault: true } }),
    ])
    void this.mail.sendBankAccountAlert(user.email, user.firstName, 'default', acct.bankName, acct.accountLast4)
    return this.list(userId)
  }

  async remove(userId: string, id: string, pin: string) {
    const user = await this.getUser(userId)
    await this.assertPin(user, pin)
    const acct = await this.prisma.bankAccount.findFirst({ where: { id, userId } })
    if (!acct) throw new NotFoundException('Account not found')
    await this.prisma.bankAccount.delete({ where: { id } })
    if (acct.isDefault) {
      const next = await this.prisma.bankAccount.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
      if (next) await this.prisma.bankAccount.update({ where: { id: next.id }, data: { isDefault: true } })
    }
    void this.mail.sendBankAccountAlert(user.email, user.firstName, 'removed', acct.bankName, acct.accountLast4)
    return this.list(userId)
  }

  /**
   * Call this from PaymentsService.withdraw instead of accepting raw bank details.
   * Returns the Paystack recipient code to transfer to.
   */
  async getWithdrawableRecipient(userId: string, accountId?: string): Promise<{ recipientCode: string; accountName: string; last4: string }> {
    const acct = accountId
      ? await this.prisma.bankAccount.findFirst({ where: { id: accountId, userId } })
      : await this.prisma.bankAccount.findFirst({ where: { userId, isDefault: true } })
    if (!acct) throw new BadRequestException('Add a bank account before withdrawing')
    if (acct.usableAfter > new Date()) {
      const hrs = Math.ceil((acct.usableAfter.getTime() - Date.now()) / 3600_000)
      throw new ForbiddenException(`This account was added recently and can receive withdrawals in about ${hrs}h.`)
    }
    return { recipientCode: acct.recipientCode, accountName: acct.accountName, last4: acct.accountLast4 }
  }
}