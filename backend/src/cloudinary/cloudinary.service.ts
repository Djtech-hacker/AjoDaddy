// ============================================================
// CLOUDINARY SERVICE — signed uploads for TAREVA
// ============================================================
//
// Why SIGNED uploads (not the unsigned preset you use for KYC faces):
//   - An unsigned preset lets anyone who finds the preset name upload files.
//   - Vendor documents (CAC, screenshots) must be PRIVATE. Only "authenticated"
//     type assets are private, and the type is locked by the signature, so a
//     user cannot change it in the browser.
//
// Flow:
//   1. Frontend asks our backend for an upload signature  (POST .../upload-signature)
//   2. Frontend uploads the file straight to Cloudinary with that signature
//   3. Frontend sends us the returned public_id
//   4. We ask Cloudinary about that public_id (verifyUploadedAsset) to confirm it
//      exists, belongs to this user's folder, and is a valid size and format.
//
// Env vars (backend .env, NEVER in a VITE_ variable):
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET

import { Injectable, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

export type UploadKind = 'VENDOR_DOC' | 'PRODUCT_IMAGE';

const IS_PROD = process.env.NODE_ENV === 'production';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const DOC_FORMATS   = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger('CloudinaryService');
  private readonly cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
  private readonly apiKey    = process.env.CLOUDINARY_API_KEY || '';
  private readonly apiSecret = process.env.CLOUDINARY_API_SECRET || '';
  private readonly configured: boolean;

  constructor() {
    this.configured = !!(this.cloudName && this.apiKey && this.apiSecret);
    if (!this.configured) {
      const msg = 'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are not all set. Put them in the backend .env file.';
      if (IS_PROD) throw new Error(msg);
      this.logger.error(msg);
    } else {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key:    this.apiKey,
        api_secret: this.apiSecret,
        secure:     true,
      });
    }
  }

  private assertConfigured() {
    if (!this.configured) throw new ServiceUnavailableException('File uploads are not available right now.');
  }

  // Each user can only upload into (and reference) their own folder.
  folderFor(kind: UploadKind, userId: string): string {
    return kind === 'VENDOR_DOC'
      ? `ajodaddy/vendor-docs/${userId}`
      : `ajodaddy/products/${userId}`;
  }

  private typeFor(kind: UploadKind): 'authenticated' | 'upload' {
    return kind === 'VENDOR_DOC' ? 'authenticated' : 'upload';
  }

  private formatsFor(kind: UploadKind): string[] {
    return kind === 'VENDOR_DOC' ? DOC_FORMATS : IMAGE_FORMATS;
  }

  // ── Step 1: give the browser a signature ──────────────────
  getUploadSignature(kind: UploadKind, userId: string) {
    this.assertConfigured();
    const timestamp       = Math.floor(Date.now() / 1000);
    const folder          = this.folderFor(kind, userId);
    const type            = this.typeFor(kind);
    const allowed_formats = this.formatsFor(kind).join(',');

    // Every parameter the browser sends (except file, api_key, resource_type)
    // must be in this object, or Cloudinary rejects the upload.
    const signature = cloudinary.utils.api_sign_request(
      { allowed_formats, folder, timestamp, type },
      this.apiSecret,
    );

    return {
      cloudName:      this.cloudName,
      apiKey:         this.apiKey,
      timestamp,
      signature,
      folder,
      type,
      allowedFormats: allowed_formats,
      maxBytes:       MAX_UPLOAD_BYTES,
      uploadUrl:      `https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`,
    };
  }

  // ── Step 4: confirm an uploaded file is real, ours and valid ─
  async verifyUploadedAsset(kind: UploadKind, userId: string, publicId: string) {
    this.assertConfigured();

    const prefix = this.folderFor(kind, userId) + '/';
    if (!publicId.startsWith(prefix) || publicId.includes('..')) {
      throw new BadRequestException('Invalid file reference. Please upload the file again.');
    }

    const type = this.typeFor(kind);
    let asset: any;
    try {
      asset = await cloudinary.api.resource(publicId, { resource_type: 'image', type });
    } catch {
      throw new BadRequestException('We could not find the uploaded file. Please upload it again.');
    }

    const format = String(asset?.format || '').toLowerCase();
    if (!this.formatsFor(kind).includes(format)) {
      await this.destroy(kind, publicId);
      throw new BadRequestException(`File type not allowed. Use: ${this.formatsFor(kind).join(', ')}.`);
    }
    if (Number(asset?.bytes || 0) > MAX_UPLOAD_BYTES) {
      await this.destroy(kind, publicId);
      throw new BadRequestException('File is too large. The maximum size is 5MB.');
    }

    return {
      bytes:    Number(asset.bytes || 0),
      format,
      mimeType: format === 'pdf' ? 'application/pdf' : `image/${format === 'jpg' ? 'jpeg' : format}`,
      url:      String(asset.secure_url || ''),
    };
  }

  // ── Private files: a signed URL that only the backend uses ──
  // Cloudinary signed URLs do not expire on their own, so we NEVER hand this URL
  // to the browser. The backend downloads the file and streams it to staff
  // (after checking their role and writing an audit log).
  signedPrivateUrl(publicId: string, mimeType?: string | null): string {
    this.assertConfigured();
    return cloudinary.url(publicId, {
      resource_type: 'image',
      type:          'authenticated',
      sign_url:      true,
      secure:        true,
      ...(mimeType === 'application/pdf' ? { format: 'pdf' } : {}),
    });
  }

  // Public product images: we store the public_id and build the URL when needed.
  // Cloudinary resizes and picks the best format (webp/avif) automatically.
  publicImageUrl(publicId: string, width = 800): string {
    if (!this.configured) return '';
    return cloudinary.url(publicId, {
      resource_type:  'image',
      type:           'upload',
      secure:         true,
      transformation: [{ width, crop: 'limit', fetch_format: 'auto', quality: 'auto' }],
    });
  }

  async destroy(kind: UploadKind, publicId: string): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        type:          this.typeFor(kind),
        invalidate:    true,
      });
    } catch (err: any) {
      this.logger.warn(`Could not delete ${publicId}: ${err?.message}`);
    }
  }
}