// ============================================================
// PAY SMALL SMALL: API calls (new file; your existing services.ts is untouched)
// Every call goes through your normal `api` client, so login tokens, refresh and
// maintenance mode all work as they do everywhere else.
// ============================================================

import api from '@/lib/api'

export type UploadSignature = {
  cloudName: string
  apiKey: string
  timestamp: number
  signature: string
  folder: string
  type: string
  allowedFormats: string
  maxBytes: number
  uploadUrl: string
}

// ── Vendor application ───────────────────────────────────────

export const vendorApi = {
  me: () => api.get('/vendors/me'),

  saveApplication: (body: {
    businessName: string
    category: string
    description?: string
    phone?: string
    address?: string
    cacNumber: string
    socialLinks: string[]
    bankAccountId: string
  }) => api.post('/vendors/applications', body),

  uploadSignature: () => api.post('/vendors/applications/upload-signature'),

  addDocument: (applicationId: string, body: { type: 'CAC' | 'SOCIAL_PROOF' | 'SALES_PROOF'; cloudinaryPublicId: string; fileName?: string }) =>
    api.post(`/vendors/applications/${applicationId}/documents`, body),

  removeDocument: (applicationId: string, documentId: string) =>
    api.delete(`/vendors/applications/${applicationId}/documents/${documentId}`),

  submit: (applicationId: string, body: { acceptTerms: boolean }) =>
    api.post(`/vendors/applications/${applicationId}/submit`, body),
}

// The vendor's payout account is one of their saved bank accounts
export const vendorBankApi = {
  list: () => api.get('/bank-accounts'),
}

// ── Customers: browse products and manage plans ──────────────

export const shopApi = {
  list: (params: { q?: string; category?: string; page?: number }) => api.get('/small-small/products', { params }),
  get: (idOrReference: string) => api.get(`/small-small/products/${idOrReference}`),
}

export type PlanChoice = {
  productId: string
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM'
  customIntervalDays?: number
  durationDays: number
  depositAmount: number
}

export const planApi = {
  preview: (body: PlanChoice) => api.post('/small-small/orders/preview', body),
  start: (body: PlanChoice & { paymentMode: 'MANUAL' | 'AUTO'; idempotencyKey: string }) => api.post('/small-small/orders', body),
  list: (params: { status?: string; page?: number }) => api.get('/small-small/orders', { params }),
  get: (id: string) => api.get(`/small-small/orders/${id}`),
  pay: (id: string, body: { amount: number; idempotencyKey: string }) => api.post(`/small-small/orders/${id}/pay`, body),
  setMode: (id: string, mode: 'MANUAL' | 'AUTO') => api.post(`/small-small/orders/${id}/payment-mode`, { mode }),
  refund: (id: string) => api.post(`/small-small/orders/${id}/refund`),
}

// ── Vendors: products, stock, orders, refunds ────────────────

export type ProductPayload = {
  name: string
  description: string
  category?: string
  price: number
  imagePublicIds: string[]
  allowedFrequencies: string[]
  customIntervalDays: number[]
  paymentDeadlineDays: number
  refundThresholdPercent: number
  payoutMode: 'ON_FULL_PAYMENT'
}

export const vendorShopApi = {
  signature: () => api.post('/small-small/vendor/products/upload-signature'),
  create: (body: ProductPayload & { totalStock: number }) => api.post('/small-small/vendor/products', body),
  list: (params: { status?: string; page?: number }) => api.get('/small-small/vendor/products', { params }),
  get: (id: string) => api.get(`/small-small/vendor/products/${id}`),
  update: (id: string, body: Partial<ProductPayload>) => api.patch(`/small-small/vendor/products/${id}`, body),
  setStock: (id: string, body: { totalStock: number; reason?: string }) => api.post(`/small-small/vendor/products/${id}/stock`, body),
  setStatus: (id: string, status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED') => api.post(`/small-small/vendor/products/${id}/status`, { status }),
  orders: (params: { status?: string; page?: number }) => api.get('/small-small/vendor/orders', { params }),
  refunds: (params: { page?: number }) => api.get('/small-small/vendor/refunds', { params }),
}

// ── Chat between the customer and the vendor of a plan ───────

export const chatApi = {
  messages: (threadId: string) => api.get(`/small-small/chat/${threadId}/messages`),
  send: (threadId: string, content: string) => api.post(`/small-small/chat/${threadId}/messages`, { content }),
  remove: (threadId: string, messageId: string) => api.delete(`/small-small/chat/${threadId}/messages/${messageId}`),
}

// ── Staff: customer care, admin ──────────────────────────────

export const staffApi = {
  applications: (params: { status?: string; page?: number }) => api.get('/vendors/review/applications', { params }),
  application: (id: string) => api.get(`/vendors/review/applications/${id}`),
  start: (id: string) => api.post(`/vendors/review/applications/${id}/start`),
  addNote: (id: string, text: string) => api.post(`/vendors/review/applications/${id}/notes`, { text }),
  recommend: (id: string, body: { recommendation: 'RECOMMEND_APPROVE' | 'RECOMMEND_REJECT' | 'NEEDS_MORE_INFO'; note?: string }) =>
    api.post(`/vendors/review/applications/${id}/recommend`, body),
  decide: (id: string, body: { decision: 'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO'; reason?: string; overrideKycFlag?: boolean }) =>
    api.post(`/vendors/review/applications/${id}/decision`, body),
  reviewDoc: (docId: string, body: { status: 'VERIFIED' | 'REJECTED'; note?: string }) =>
    api.post(`/vendors/review/documents/${docId}/review`, body),
  docFile: (docId: string) => api.get(`/vendors/review/documents/${docId}/file`, { responseType: 'blob' }),
  accounts: (params: { status?: string }) => api.get('/vendors/review/accounts', { params }),
  suspend: (userId: string, reason: string) => api.post(`/vendors/review/accounts/${userId}/suspend`, { reason }),
  reinstate: (userId: string) => api.post(`/vendors/review/accounts/${userId}/reinstate`),
  verifyVendor: (userId: string) => api.post(`/vendors/review/accounts/${userId}/verify`),
  unverifyVendor: (userId: string) => api.post(`/vendors/review/accounts/${userId}/unverify`),
  products: (params: { q?: string; page?: number }) => api.get('/small-small/care/products', { params }),
  flagProduct: (id: string, body: { flagged: boolean; reason: string }) => api.post(`/small-small/care/products/${id}/flag`, body),
  productNote: (id: string, text: string) => api.post(`/small-small/care/products/${id}/notes`, { text }),
  runChecks: () => api.post('/small-small/admin/run-checks'),
}

// ── Direct upload to Cloudinary ──────────────────────────────
// The file goes from the browser straight to Cloudinary using the signature our backend
// created. It does NOT go through `api` (that would add our login token and the wrong URL).
export async function uploadToCloudinary(sig: UploadSignature, file: File): Promise<{ public_id: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sig.apiKey)
  form.append('timestamp', String(sig.timestamp))
  form.append('signature', sig.signature)
  form.append('folder', sig.folder)
  form.append('type', sig.type)
  form.append('allowed_formats', sig.allowedFormats)

  const res = await fetch(sig.uploadUrl, { method: 'POST', body: form })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || !json?.public_id) {
    throw new Error(json?.error?.message || 'The upload failed. Please try again.')
  }
  return json
}