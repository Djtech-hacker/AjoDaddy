import { PartialType, OmitType } from '@nestjs/swagger';
import {
  IsString, IsOptional, MinLength, MaxLength, IsArray, ArrayMinSize, ArrayMaxSize,
  ArrayUnique, IsInt, IsNumber, Min, Max, IsIn, IsBoolean, Matches,
} from 'class-validator';

// Money fields are in NAIRA in the API (same as the rest of your app's responses).
// The service converts to kobo before saving.

export class CreateProductDto {
  @IsString() @MinLength(3) @MaxLength(120)
  name: string;

  @IsString() @MinLength(10) @MaxLength(3000)
  description: string;

  @IsOptional() @IsString() @MaxLength(60)
  category?: string;

  // Full price in naira, e.g. 250000
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(500) @Max(100000000)
  price: number;

  // public_ids returned by Cloudinary after the browser upload (the service enforces the max of 5)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique()
  @Matches(/^[A-Za-z0-9/_-]{5,200}$/, { each: true, message: 'Invalid image reference' })
  imagePublicIds: string[];

  @IsInt() @Min(1) @Max(100000)
  totalStock: number;

  // How often customers may pay
  @IsArray() @ArrayMinSize(1) @ArrayUnique()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'], { each: true })
  allowedFrequencies: Array<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'>;

  // Needed when CUSTOM is allowed: e.g. [2, 14] = every 2 days or every 14 days
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique()
  @IsInt({ each: true }) @Min(2, { each: true }) @Max(365, { each: true })
  customIntervalDays?: number[];

  // The longest time a customer has to finish paying, in days (e.g. 90 = 3 months)
  @IsInt() @Min(7) @Max(730)
  paymentDeadlineDays: number;

  // Customer can get a refund while they have paid LESS than this percent. 0 = no refunds.
  @IsInt() @Min(0) @Max(100)
  refundThresholdPercent: number;

  // The vendor is always paid when the customer finishes paying.
  // Optional so older clients that still send it keep working.
  @IsOptional() @IsIn(['ON_FULL_PAYMENT'])
  payoutMode?: 'ON_FULL_PAYMENT';
}

// Stock is changed through its own endpoint (so it is always logged)
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['totalStock'] as const)) {}

export class UpdateStockDto {
  // The new TOTAL stock (not the amount to add). Can go up any time,
  // and down only as far as (reserved in active plans + sold).
  @IsInt() @Min(0) @Max(100000)
  totalStock: number;

  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class SetProductStatusDto {
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

// ── Customer care ────────────────────────────────────────────

export class FlagProductDto {
  // true = put the product on hold (it is paused and the vendor cannot turn it back on)
  // false = release the hold (the vendor can turn it on again)
  @IsBoolean()
  flagged: boolean;

  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}

export class ProductNoteDto {
  @IsString() @MinLength(1) @MaxLength(1000)
  text: string;
}