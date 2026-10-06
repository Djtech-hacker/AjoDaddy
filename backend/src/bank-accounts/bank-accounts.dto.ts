import { IsString, Length, Matches } from 'class-validator'

export class ResolveAccountDto {
  @IsString() @Length(2, 12) bankCode: string
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' }) accountNumber: string
}

export class AddBankAccountDto extends ResolveAccountDto {
  @Matches(/^\d{4}$/, { message: 'Enter your 4-digit transaction PIN' }) pin: string
}

export class PinDto {
  @Matches(/^\d{4}$/, { message: 'Enter your 4-digit transaction PIN' }) pin: string
}