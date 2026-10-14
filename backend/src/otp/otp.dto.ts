import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class SendPhoneOtpDto {
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class VerifyPhoneOtpDto {
  @IsString()
  @IsNotEmpty()
  otpToken: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;
}