// ============================================================
// API SERVICES
// ============================================================
import api from '@/lib/api'
import type { User, Group, Contribution, Payout, Wallet, Transaction, Notification, ChatMessage, DashboardSummary, TrendPoint, Insight, ApiResponse } from '@/types'

export const authApi = {
  register: (data: { email: string; username: string; firstName: string; lastName: string; password: string; referralCode?: string }) => api.post('/auth/register', data),
  login: (data: { email: string; password: string }) => api.post<{ accessToken: string; user: User }>('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  refresh: () => api.post<ApiResponse<{ accessToken: string; user: User }>>('/auth/refresh'),
  verifyEmail: (token: string) => api.post('/auth/verify-email', { token }),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) => api.post('/auth/reset-password', { token, newPassword }),
  setTransactionPin: (pin: string) => api.post('/auth/transaction-pin', { pin }),
  verifyPassword: (password: string) => api.post('/auth/verify-password', { password }),
  sendPinChangeOtp: () => api.post('/auth/send-pin-otp'),
  changePinWithOtp: (data: { otp: string; newPin: string }) => api.post('/auth/change-pin', data),
  getMe: () => api.get<User>('/auth/me'),
}

export const usersApi = {
  getProfile: () => api.get<ApiResponse<User>>('/users/me'),
  updateProfile: (data: Partial<User>) => api.patch<User>('/users/me', data),
  getPublicProfile: (username: string) => api.get<User>(`/users/${username}`),
  getBadges: () => api.get('/users/me/badges'),
  getLeaderboard: (params?: { groupId?: string; period?: string }) => api.get('/users/leaderboard', { params }),
}

export const groupsApi = {
  create: (data: { name: string; contributionAmount: number; frequency: string; maxMembers: number; startDate: string; visibility: string; description?: string; deadlineDays?: number; penaltyAmount?: number }) => api.post<ApiResponse<Group>>('/groups', data),
  list: (params?: { page?: number; limit?: number; search?: string; visibility?: string }) => api.get('/groups', { params }),
  getBySlug: (slug: string) => api.get<ApiResponse<Group>>(`/groups/${slug}`),
  findByInviteCode: (code: string) => api.get(`/groups/invite/${code}`),
  updateGroup: (groupId: string, data: Record<string, any>) => api.patch(`/groups/${groupId}/settings`, data),
  startGroup: (groupId: string) => api.post(`/groups/${groupId}/start`),
  pauseGroup: (groupId: string) => api.post(`/groups/${groupId}/pause`),
  resumeGroup: (groupId: string) => api.post(`/groups/${groupId}/resume`),
  archiveGroup: (groupId: string) => api.post(`/groups/${groupId}/archive`),
  join: (id: string, inviteCode?: string) => api.post(`/groups/${id}/join`, { inviteCode }),
  acceptAgreement: (groupId: string, deviceInfo: string) => api.post(`/groups/${groupId}/accept-agreement`, { deviceInfo }),
  leave: (groupId: string) => api.post(`/groups/${groupId}/leave`),
  approveMember: (groupId: string, memberId: string) => api.post(`/groups/${groupId}/members/${memberId}/approve`),
  rejectMember: (groupId: string, memberId: string) => api.post(`/groups/${groupId}/members/${memberId}/reject`),
  removeMember: (groupId: string, memberId: string, reason?: string) => api.delete(`/groups/${groupId}/members/${memberId}`, { params: { reason } }),
  banMember: (groupId: string, memberId: string, reason?: string) => api.post(`/groups/${groupId}/members/${memberId}/ban`, { reason }),
  reinstateMember: (groupId: string, memberId: string) => api.post(`/groups/${groupId}/members/${memberId}/reinstate`),
  transferOwnership: (groupId: string, newOwnerId: string) => api.post(`/groups/${groupId}/transfer-ownership`, { newOwnerId }),
  generateInvite: (groupId: string, maxUses?: number, expiresInDays?: number) => api.post(`/groups/${groupId}/invite-link`, {}, { params: { maxUses, expiresInDays } }),
  updatePayoutOrder: (groupId: string, memberIds: string[]) => api.patch(`/groups/${groupId}/payout-order`, { memberIds }),
  makeContribution: (groupId: string, pin?: string, idempotencyKey?: string) => api.post(`/groups/${groupId}/contribute`, { pin }, { headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  getContributionsByCycle: (groupId: string, cycle: number) => api.get(`/groups/${groupId}/contributions/history`, { params: { cycle } }),
  getPayoutHistory: (groupId: string) => api.get(`/groups/${groupId}/payouts`),
  markContributionPaid: (groupId: string, contributionId: string) => api.patch(`/groups/${groupId}/contributions/${contributionId}/mark-paid`),
  getMyPendingContributions: () => api.get('/groups/me/pending-contributions'),
  getAnalytics: (groupId: string) => api.get(`/groups/${groupId}/analytics`),
  getHealth: (groupId: string) => api.get(`/groups/${groupId}/health`),
  deleteGroup: (groupId: string) => api.delete(`/groups/${groupId}`),
}

export const contributionsApi = {
  pay: (groupId: string, transactionPin?: string) => api.post<{ contribution: Contribution }>('/contributions/pay', { groupId, transactionPin }),
  list: (params?: { groupId?: string; page?: number; limit?: number }) => api.get('/contributions', { params }),
}

export const walletApi = {
  getWallet: () => api.get<ApiResponse<Wallet>>('/wallet'),
  getStats: () => api.get('/wallet/stats'),
  getTransactions: (params?: { page?: number; limit?: number; type?: string }) => api.get<ApiResponse<{ transactions: Transaction[] }>>('/wallet/transactions', { params }),
}

export const paymentsApi = {
  initiate: (data: { amount: number; provider: string; purpose: string; groupId?: string }) => api.post<ApiResponse<{ authorizationUrl: string; reference: string }>>('/payments/initiate', data),
  verify: (reference: string, provider: string) => api.post('/payments/verify', { reference, provider }),
  withdraw: (data: { amount: number; accountNumber: string; bankCode: string; accountName: string; transactionPin?: string }) => api.post('/payments/withdraw', data),
  getBanks: () => api.get<{ name: string; code: string }[]>('/payments/banks'),
  verifyAccount: (accountNumber: string, bankCode: string) => api.get<{ accountName: string; accountNumber: string }>('/payments/verify-account', { params: { accountNumber, bankCode } }),
  getWithdrawalFees: (amount: number) => api.get('/payments/withdraw/fees', { params: { amount } }),
}

export const analyticsApi = {
  getSummary: () => api.get<ApiResponse<DashboardSummary>>('/analytics/summary'),
  getTrend: (params?: { groupId?: string; weeks?: number }) => api.get<ApiResponse<TrendPoint[]>>('/analytics/contributions/trend', { params }),
  getInsights: () => api.get<ApiResponse<Insight[]>>('/analytics/insights'),
}

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) => api.get('/notifications', { params }),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
}

export const chatApi = {
  getMessages: (groupId: string, params?: { cursor?: string; limit?: number }) => api.get<ApiResponse<{ messages: ChatMessage[]; nextCursor: string | null }>>(`/chat/${groupId}/messages`, { params }),
  getPinned: (groupId: string) => api.get(`/chat/${groupId}/pinned`),
  pinMessage: (groupId: string, messageId: string) => api.post(`/chat/${groupId}/messages/${messageId}/pin`),
  deleteMessage: (groupId: string, messageId: string) => api.delete(`/chat/${groupId}/messages/${messageId}`),
}

// ── KYC ───────────────────────────────────────────────────────
export const kycApi = {
  getStatus:      ()                              => api.get('/kyc/status'),
  verifyNin:      (nin: string)                   => api.post('/kyc/verify-nin', { nin }),
  verifyBvn:      (bvn: string)                   => api.post('/kyc/verify-bvn', { bvn }),
  submitFacePhoto:(facePhotoUrl: string)          => api.post('/kyc/submit-face', { facePhotoUrl }),
  getDebts:       ()                              => api.get('/kyc/debts'),
  checkDebts:     ()                              => api.get('/kyc/check-debts'),
  settleDebt:     (debtId: string)                => api.post(`/kyc/debts/${debtId}/settle`),
}

// ── Customer Service ──────────────────────────────────────────
export const csApi = {
  getTickets:          (params?: { status?: string; page?: number; limit?: number; assignedToId?: string }) => api.get('/cs/tickets', { params }),
  getTicketDetail:     (id: string)                        => api.get(`/cs/tickets/${id}`),
  replyToTicket:       (id: string, message: string)       => api.post(`/cs/tickets/${id}/reply`, { message }),
  addTicketNote:       (id: string, content: string)       => api.post(`/cs/tickets/${id}/notes`, { content }),
  getTicketNotes:      (id: string)                        => api.get(`/cs/tickets/${id}/notes`),
  escalateTicket:      (id: string, note?: string)         => api.patch(`/cs/tickets/${id}/escalate`, { note }),
  assignTicket:        (id: string, assigneeId: string)    => api.patch(`/cs/tickets/${id}/assign`, { assigneeId }),
  updateTicketStatus:  (id: string, status: string)        => api.patch(`/cs/tickets/${id}/status`, { status }),
  getDisputes:         (params?: { status?: string; reportedUserId?: string; groupId?: string; page?: number; limit?: number }) => api.get('/cs/disputes', { params }),
  getDisputeDetail:    (id: string)                        => api.get(`/cs/disputes/${id}`),
  addDisputeNote:      (id: string, content: string)       => api.post(`/cs/disputes/${id}/notes`, { content }),
  getDisputeNotes:     (id: string)                        => api.get(`/cs/disputes/${id}/notes`),
  updateDisputeStatus: (id: string, status: string)        => api.patch(`/cs/disputes/${id}/status`, { status }),
  escalateDispute:     (id: string, note?: string)         => api.patch(`/cs/disputes/${id}/escalate`, { note }),
  assignDispute:       (id: string, assigneeId: string)    => api.patch(`/cs/disputes/${id}/assign`, { assigneeId }),
}

// ── Admin ─────────────────────────────────────────────────────
export const adminApi = {
  getDashboard:       ()                                                                  => api.get('/admin/dashboard'),
  getUsers:           (params?: any)                                                      => api.get('/admin/users', { params }),
  suspendUser:        (id: string, reason: string)                                        => api.patch(`/admin/users/${id}/suspend`, { reason }),
  unsuspendUser:      (id: string)                                                        => api.patch(`/admin/users/${id}/unsuspend`),
  banUser:            (id: string, reason: string)                                        => api.patch(`/admin/users/${id}/ban`, { reason }),
  unbanUser:          (id: string)                                                        => api.patch(`/admin/users/${id}/unban`),
  deleteUser:         (id: string, reason: string)                                        => api.delete(`/admin/users/${id}`, { params: { reason } }),
  getTransactions:    (params?: any)                                                      => api.get('/admin/transactions', { params }),
  getFraudFlags:      (params?: any)                                                      => api.get('/admin/fraud', { params }),
  resolveFraud:       (id: string)                                                        => api.patch(`/admin/fraud/${id}/resolve`),
  getAuditLogs:       (params?: any)                                                      => api.get('/admin/audit-logs', { params }),
  getPendingPayouts:  (params?: any)                                                      => api.get('/admin/payouts/pending', { params }),
  broadcast:          (title: string, body: string)                                       => api.post('/admin/broadcast', { title, body }),
  getGroups:          (params?: any)                                                      => api.get('/admin/groups', { params }),
  freezeGroup:        (id: string, reason: string)                                        => api.patch(`/admin/groups/${id}/freeze`, { reason }),
  unfreezeGroup:      (id: string)                                                        => api.patch(`/admin/groups/${id}/unfreeze`),
  closeGroup:         (id: string, reason: string)                                        => api.patch(`/admin/groups/${id}/close`, { reason }),
  broadcastToGroup:   (id: string, title: string, body: string)                           => api.post(`/admin/groups/${id}/broadcast`, { title, body }),
  flagUser:           (userId: string, type: string, description: string, severity: string) => api.post('/admin/fraud', { userId, type, description, severity }),
  getEscalationQueue: (params?: { page?: number; limit?: number })                        => api.get('/admin/escalation-queue', { params }),
  resolveDispute:     (id: string, status: string, resolution: string)                    => api.patch(`/admin/disputes/${id}/resolve`, { status, resolution }),
  getDisputes:        (params?: any)                                                      => api.get('/admin/disputes', { params }),
  // KYC
  getPendingKyc:      (status?: string)                                                   => api.get('/admin/kyc/pending', { params: status ? { status } : {} }),
  approveKyc:         (userId: string, facePhotoUrl?: string)                             => api.patch(`/admin/kyc/${userId}/approve`, { facePhotoUrl }),
  rejectKyc:          (userId: string, reason: string, facePhotoUrl?: string)             => api.patch(`/admin/kyc/${userId}/reject`, { reason, facePhotoUrl }),
  // Super Admin only — reveal full NIN/BVN (password + face photo audit)
  revealUserIdentity: (userId: string, password: string, facePhotoUrl?: string)           => api.post(`/kyc/admin/reveal/${userId}`, { password, facePhotoUrl }),
}

// ── Super Admin ───────────────────────────────────────────────
export const superAdminApi = {
  getDashboard:       ()                           => api.get('/admin/dashboard'),
  getUsers:           (params?: any)               => api.get('/admin/users', { params }),
  updateUserRole:     (id: string, role: string)   => api.patch(`/admin/users/${id}/role`, { role }),
  banUser:            (id: string, reason: string) => api.patch(`/admin/users/${id}/ban`, { reason }),
  unbanUser:          (id: string)                 => api.patch(`/admin/users/${id}/unban`),
  deleteUser:         (id: string, reason: string) => api.delete(`/admin/users/${id}`, { params: { reason } }),
  getSettings:        ()                           => api.get('/admin/settings'),
  updateSettings:     (data: Record<string, any>)  => api.patch('/admin/settings', data),
  getFullAuditLog:    (params?: any)               => api.get('/admin/audit-logs', { params }),
  getEscalationQueue: (params?: any)               => api.get('/admin/escalation-queue', { params }),
  getAllTickets:       (params?: any)               => api.get('/admin/support/tickets', { params }),
  getTicketDetail:    (id: string)                 => api.get(`/admin/support/tickets/${id}`),
  getAllDisputes:      (params?: any)               => api.get('/admin/disputes', { params }),
  getTransactions:    (params?: any)               => api.get('/admin/transactions', { params }),
  revealUserIdentity: (userId: string, password: string, facePhotoUrl?: string) => api.post(`/kyc/admin/reveal/${userId}`, { password, facePhotoUrl }),
  // Company revenue — SYSTEM wallet balance, broken down by penalty fees vs platform fees
  getRevenue:         ()                           => api.get('/admin/revenue'),
}

// ── Disputes (user-facing) ────────────────────────────────────
export const disputesApi = {
  create:    (data: { type: string; description: string; reportedUserId?: string; groupId?: string; evidenceUrls?: string[] }) => api.post('/disputes', data),
  getMine:   ()              => api.get('/disputes/mine'),
  getReplies:(id: string)    => api.get(`/disputes/${id}/replies`),
  reply:     (id: string, message: string) => api.post(`/disputes/${id}/reply`, { message }),
}

// ── Support (user-facing) ─────────────────────────────────────
export const supportApi = {
  createTicket:    (data: { subject: string; message: string; priority?: string }) => api.post('/support/tickets', data),
  getMyTickets:    ()              => api.get('/support/tickets'),
  getTicketDetail: (id: string)    => api.get(`/support/tickets/${id}`),
  replyToTicket:   (id: string, message: string) => api.post(`/support/tickets/${id}/reply`, { message }),
  closeTicket:     (id: string)    => api.patch(`/support/tickets/${id}/close`),
}

export const platformApi = {
  // Public — no auth required. Used for the global maintenance poll.
  getStatus: () =>
    api.get<{
      maintenanceMode: boolean
      maintenanceScheduledAt: string | null
      maintenanceAnnouncement: string | null
    }>('/platform/status'),
}