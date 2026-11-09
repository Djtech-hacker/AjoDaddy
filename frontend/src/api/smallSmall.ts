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
  // The transaction PIN travels in a header so it never gets mixed into the plan details
  start: (body: PlanChoice & { paymentMode: 'MANUAL' | 'AUTO'; idempotencyKey: string }, pin: string) =>
    api.post('/small-small/orders', body, { headers: { 'x-transaction-pin': pin }, timeout: 60000 }),
  list: (params: { status?: string; page?: number }) => api.get('/small-small/orders', { params }),
  get: (id: string) => api.get(`/small-small/orders/${id}`),
  pay: (id: string, body: { amount: number; idempotencyKey: string }, pin: string) =>
    api.post(`/small-small/orders/${id}/pay`, body, { headers: { 'x-transaction-pin': pin }, timeout: 60000 }),
  setMode: (id: string, mode: 'MANUAL' | 'AUTO') => api.post(`/small-small/orders/${id}/payment-mode`, { mode }),
  refund: (id: string) => api.post(`/small-small/orders/${id}/refund`),
  // the customer confirms the goods arrived
  received: (id: string) => api.post(`/small-small/orders/${id}/received`),
  // where the customer wants the goods delivered
  deliveryQuote: (id: string) => api.get(`/small-small/orders/${id}/delivery-quote`),
  setOption: (id: string, optionId: string) => api.post(`/small-small/orders/${id}/delivery-option`, { optionId }),
  setMethod: (id: string, method: 'DELIVERY' | 'PICKUP') => api.post(`/small-small/orders/${id}/delivery-method`, { method }),
  setAddress: (id: string, body: { name: string; phone: string; address: string; city: string; state: string; latitude?: number; longitude?: number }) =>
    api.post(`/small-small/orders/${id}/delivery-address`, body),
}

// ── Vendors: products, stock, orders, delivery, refunds ──────

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
  // view: PAYING | TO_DISPATCH | DISPATCHED | DELIVERED | CANCELLED | ALL
  orders: (params: { status?: string; page?: number; productId?: string; view?: string }) => api.get('/small-small/vendor/orders', { params }),
  // my products that have customers, with a count for each stage
  orderProducts: () => api.get('/small-small/vendor/order-products'),
  // mark an order as sent (or update the delivery details)
  dispatch: (id: string, body: { courier: string; trackingNumber?: string; note?: string }) =>
    api.post(`/small-small/vendor/orders/${id}/dispatch`, body),
  // GIG Logistics: see the price, then book a rider
  readyForPickup: (id: string, body: { note?: string; location?: string }) => api.post(`/small-small/vendor/orders/${id}/ready-for-pickup`, body),
  gigQuote: (id: string) => api.post(`/small-small/vendor/orders/${id}/gig-quote`),
  gigBook: (id: string) => api.post(`/small-small/vendor/orders/${id}/gig-book`, {}, { timeout: 60000 }),
  refunds: (params: { page?: number }) => api.get('/small-small/vendor/refunds', { params }),
}

// ── Chat between the customer and the vendor of a plan ───────

export const chatApi = {
  messages: (threadId: string) => api.get(`/small-small/chat/${threadId}/messages`),
  send: (threadId: string, content: string) => api.post(`/small-small/chat/${threadId}/messages`, { content }),
  remove: (threadId: string, messageId: string) => api.delete(`/small-small/chat/${threadId}/messages/${messageId}`),
  // chat with a vendor before buying
  startForProduct: (productId: string) => api.post(`/small-small/chat/product/${productId}`),
  // the vendor's inbox
  vendorThreads: () => api.get('/small-small/chat/vendor/threads'),
  // all my conversations (as customer and as vendor) and the unread number for the Messages button
  myThreads: () => api.get('/small-small/chat/threads'),
  unreadCount: () => api.get('/small-small/chat/unread-count'),
}

// ── Report a vendor ──────────────────────────────────────────

export const reportApi = {
  vendor: (body: { reason: string; details: string; threadId?: string; orderId?: string; productId?: string }) =>
    api.post('/small-small/reports/vendor', body),
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