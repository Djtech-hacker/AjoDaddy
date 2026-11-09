import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// The vendor says the goods have been handed to a logistics company (or delivered by hand)
export class DispatchOrderDto {
  // Name of the logistics company, e.g. "GIG Logistics". For hand delivery send "I delivered it myself".
  @IsString() @MinLength(2) @MaxLength(60)
  courier: string;

  @IsOptional() @IsString() @MaxLength(60)
  trackingNumber?: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

// Where the customer wants the goods delivered
export class DeliveryAddressDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  name: string;

  @IsString() @MinLength(7) @MaxLength(20)
  phone: string;

  @IsString() @MinLength(5) @MaxLength(200)
  address: string;

  @IsString() @IsNotEmpty() @MaxLength(60)
  city: string;

  @IsString() @IsNotEmpty() @MaxLength(40)
  state: string;

  // the customer's exact spot, taken from their phone's location (optional)
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;
}

// How the customer wants the goods: brought by a GIG rider, or collected from the vendor
export class DeliveryMethodDto {
  @IsIn(['DELIVERY', 'PICKUP'])
  method: 'DELIVERY' | 'PICKUP';
}

// The vendor says the goods are ready for the customer to collect
export class PickupReadyDto {
  // where the customer should come to collect it (empty = use the address on the vendor profile)
  @IsOptional() @IsString() @MaxLength(300)
  location?: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

// The courier choice the customer picked (one of the options we showed them)
export class DeliveryOptionDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  optionId: string;
}