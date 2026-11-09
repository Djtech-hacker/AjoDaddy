import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const REPORT_REASONS = ['SCAM', 'NOT_AS_DESCRIBED', 'NO_DELIVERY', 'OFF_PLATFORM', 'ABUSE', 'OTHER'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ReportVendorDto {
  @IsIn(REPORT_REASONS as unknown as string[])
  reason: (typeof REPORT_REASONS)[number];

  @IsString() @MinLength(10, { message: 'Please tell us a little more (at least 10 characters).' }) @MaxLength(1500)
  details: string;

  // Say which vendor you mean with ONE of these (the chat is best, because we attach the last messages)
  @IsOptional() @Matches(UUID, { message: 'Invalid chat' })
  threadId?: string;

  @IsOptional() @Matches(UUID, { message: 'Invalid plan' })
  orderId?: string;

  @IsOptional() @Matches(UUID, { message: 'Invalid product' })
  productId?: string;
}