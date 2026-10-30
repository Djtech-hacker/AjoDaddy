import { IsString, IsOptional, IsInt, IsNumber, Min, Max, IsIn, Matches } from 'class-validator';

// Money is in NAIRA in the API. The service converts to kobo.

// What the customer chose on the "start a plan" screen
export class PreviewPlanDto {
  // product id or its reference number (SS-2026-123456)
  @IsString() @Matches(/^[A-Za-z0-9-]{8,60}$/, { message: 'Invalid product' })
  productId: string;

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'])
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

  // only when frequency is CUSTOM: one of the vendor's custom day options
  @IsOptional() @IsInt() @Min(2) @Max(365)
  customIntervalDays?: number;

  // how many days the customer wants to take to finish paying
  @IsInt() @Min(1) @Max(730)
  durationDays: number;

  // the first payment, in naira
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) @Max(100000000)
  depositAmount: number;
}

export class StartPlanDto extends PreviewPlanDto {
  @IsIn(['MANUAL', 'AUTO'])
  paymentMode: 'MANUAL' | 'AUTO';

  // The app creates a new random value each time the customer opens the confirm screen
  // (for example a UUID). If they tap twice, or the network retries, only ONE plan
  // is created and they are only charged once.
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'Invalid idempotencyKey' })
  idempotencyKey: string;
}

export class PayOrderDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100000000)
  amount: number;

  // new random value per tap on "Pay now" (same idea as above)
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'Invalid idempotencyKey' })
  idempotencyKey: string;
}

export class SetPaymentModeDto {
  @IsIn(['MANUAL', 'AUTO'])
  mode: 'MANUAL' | 'AUTO';
}