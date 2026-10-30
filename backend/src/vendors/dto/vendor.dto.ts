import {
  IsString, IsOptional, MinLength, MaxLength, IsArray, ArrayMinSize, ArrayMaxSize,
  IsUrl, IsUUID, IsIn, IsBoolean, Matches, Equals,
} from 'class-validator';

// ── Applicant side ───────────────────────────────────────────

export class SaveApplicationDto {
  @IsString() @MinLength(2) @MaxLength(120)
  businessName: string;

  @IsString() @MinLength(2) @MaxLength(60)
  category: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be 10 to 15 digits' })
  phone?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string;

  // RC1234567, BN1234567, IT12345 or just the digits
  @IsString() @Matches(/^(RC|BN|IT)?[\s-]?\d{3,10}$/i, { message: 'Enter a valid CAC number, e.g. RC1234567' })
  cacNumber: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
  socialLinks: string[];

  // The vendor's payout account: one of their saved BankAccount rows
  @IsUUID()
  bankAccountId: string;
}

export class AddDocumentDto {
  @IsIn(['CAC', 'SOCIAL_PROOF', 'SALES_PROOF'])
  type: 'CAC' | 'SOCIAL_PROOF' | 'SALES_PROOF';

  // public_id returned by Cloudinary after the browser upload
  @IsString() @Matches(/^[A-Za-z0-9/_-]{5,200}$/, { message: 'Invalid file reference' })
  cloudinaryPublicId: string;

  @IsOptional() @IsString() @MaxLength(150)
  fileName?: string;
}

export class SubmitApplicationDto {
  @IsBoolean() @Equals(true, { message: 'You must accept the vendor terms and refund policy' })
  acceptTerms: boolean;
}

// ── Staff side ───────────────────────────────────────────────

export class ReviewDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class ApplicationNoteDto {
  @IsString() @MinLength(1) @MaxLength(1000)
  text: string;
}

export class RecommendDto {
  @IsIn(['RECOMMEND_APPROVE', 'RECOMMEND_REJECT', 'NEEDS_MORE_INFO'])
  recommendation: 'RECOMMEND_APPROVE' | 'RECOMMEND_REJECT' | 'NEEDS_MORE_INFO';

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class DecisionDto {
  @IsIn(['APPROVE', 'REJECT', 'NEEDS_MORE_INFO'])
  decision: 'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO';

  // required for REJECT and NEEDS_MORE_INFO (shown to the applicant)
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  // admin only: approve even though the name check was flagged (reason is then required)
  @IsOptional() @IsBoolean()
  overrideKycFlag?: boolean;
}

export class SuspendVendorDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}
