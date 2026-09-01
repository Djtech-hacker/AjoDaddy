// ============================================================
// REACT QUERY HOOKS — All data-fetching hooks
// ============================================================

import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query'
import {
  authApi, usersApi, groupsApi, contributionsApi,
  walletApi, paymentsApi, analyticsApi, notificationsApi,
  chatApi, adminApi,
} from '@/api/services'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore }   from '@/stores/uiStore'
import type { User, Group, DashboardSummary } from '@/types'

// ── Query key factory ─────────────────────────────────────────
export const qk = {
  me:              ['me']                        as const,
  summary:         ['summary']                   as const,
  groups:          (p?: any) => ['groups', p]    as const,
  group:           (slug: string) => ['group', slug] as const,
  groupAnalytics:  (id: string)   => ['group-analytics', id] as const,
  contributions:   (p?: any) => ['contributions', p] as const,
  wallet:          ['wallet']                    as const,
  walletTx:        (p?: any) => ['wallet-tx', p] as const,
  notifications:   (p?: any) => ['notifications', p] as const,
  chat:            (gid: string) => ['chat', gid] as const,
  leaderboard:     (p?: any) => ['leaderboard', p] as const,
  insights:        ['insights']                  as const,
  trend:           (p?: any) => ['trend', p]     as const,
  adminDashboard:  ['admin-dashboard']            as const,
  adminUsers:      (p?: any) => ['admin-users', p] as const,
  adminFraud:      (p?: any) => ['admin-fraud', p] as const,
  adminAudit:      (p?: any) => ['admin-audit', p] as const,
}

// NOTE: when *invalidating* a keyed query (groups, contributions, etc.),
// always use the base key WITHOUT params — e.g. ['groups'], not qk.groups().
// qk.groups() with no args resolves to ['groups', undefined], and React
// Query's cache matching does NOT treat `undefined` as a wildcard for the
// second slot — it fails to match ['groups', { visibility, search }] and
// silently invalidates nothing. Using the bare ['groups'] prefix matches
// every params variant of that query correctly.

// ── Auth hooks ────────────────────────────────────────────────

export function useLogin() {
  const { setUser, setAccessToken } = useAuthStore()
  const { showToast }               = useUIStore()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      authApi.login(data).then(r => r.data),
    onSuccess: (data: any) => {
      setAccessToken(data.data?.accessToken)
      setUser(data.data?.user)
      qc.invalidateQueries({ queryKey: qk.me })
    },
    onError: (err: any) => {
      showToast(err.response?.data?.message || 'Login failed', 'error')
    },
  })
}

export function useRegister() {
  const { showToast } = useUIStore()
  return useMutation({
    mutationFn: (data: any) => authApi.register(data).then(r => r.data),
    onError: (err: any) => {
      showToast(err.response?.data?.message || 'Registration failed', 'error')
    },
  })
}

export function useLogout() {
  const { logout }    = useAuthStore()
  const { showToast } = useUIStore()
  const qc = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      logout()
      qc.clear()
      window.location.href = '/login'
    },
    onError: () => {
      logout()
      qc.clear()
      window.location.href = '/login'
    },
  })
}

// ── User hooks ────────────────────────────────────────────────

export function useMe() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: qk.me,
    queryFn:  () => usersApi.getProfile().then(r => r.data.data as User),
    enabled:  !!user,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePublicProfile(username: string) {
  return useQuery({
    queryKey: ['profile', username],
    queryFn:  () => usersApi.getPublicProfile(username).then(r => r.data.data),
    enabled:  !!username,
  })
}

export function useLeaderboard(params?: { groupId?: string; period?: string }) {
  return useQuery({
    queryKey: qk.leaderboard(params),
    queryFn:  () => usersApi.getLeaderboard(params).then(r => r.data.data),
  })
}

export function useUpdateProfile() {
  const { showToast } = useUIStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<User>) => usersApi.updateProfile(data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.me })
      showToast('Profile updated', 'success')
    },
    onError: (err: any) => showToast(err.response?.data?.message || 'Update failed', 'error'),
  })
}

// ── Dashboard/Analytics hooks ─────────────────────────────────

export function useDashboardSummary() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: qk.summary,
    queryFn:  () => analyticsApi.getSummary().then(r => r.data.data as DashboardSummary),
    enabled:  !!user,
    refetchInterval: 60_000, // refresh every minute
  })
}

export function useTrend(params?: { groupId?: string; weeks?: number }) {
  return useQuery({
    queryKey: qk.trend(params),
    queryFn:  () => analyticsApi.getTrend(params).then(r => r.data.data),
  })
}

export function useInsights() {
  return useQuery({
    queryKey: qk.insights,
    queryFn:  () => analyticsApi.getInsights().then(r => r.data.data),
    staleTime: 10 * 60 * 1000,
  })
}

// ── Group hooks ───────────────────────────────────────────────

export function useGroups(params?: { page?: number; limit?: number; search?: string; visibility?: string }) {
  return useQuery({
    queryKey: qk.groups(params),
    queryFn:  () => groupsApi.list(params).then(r => r.data.data),
  })
}

export function useGroup(slug: string) {
  return useQuery({
    queryKey: qk.group(slug),
    queryFn:  () => groupsApi.getBySlug(slug).then(r => r.data.data as Group),
    enabled:  !!slug,
  })
}

export function useGroupAnalytics(groupId: string) {
  return useQuery({
    queryKey: qk.groupAnalytics(groupId),
    queryFn:  () => groupsApi.getAnalytics(groupId).then(r => r.data.data),
    enabled:  !!groupId,
  })
}

export function useCreateGroup() {
  const { showToast } = useUIStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => groupsApi.create(data).then(r => r.data.data as Group),
    onSuccess: (group) => {
      // FIX: was qc.invalidateQueries({ queryKey: qk.groups() }) — that
      // resolves to ['groups', undefined], which does not match the
      // actual cached ['groups', { visibility, search }] queries and
      // silently invalidates nothing. Use the bare prefix instead.
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: qk.summary })
      showToast(`${group.name} created!`, 'success')
    },
    onError: (err: any) => showToast(err.response?.data?.message || 'Failed to create group', 'error'),
  })
}

export function useJoinGroup() {
  const { showToast } = useUIStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, inviteCode }: { id: string; inviteCode?: string }) =>
      groupsApi.join(id, inviteCode).then(r => r.data),
    onSuccess: (data: any) => {
      // FIX: same undefined-params mismatch as useCreateGroup above.
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: qk.summary })
      showToast(data.data?.message || 'Joined group!', 'success')
    },
    onError: (err: any) => showToast(err.response?.data?.message || 'Failed to join', 'error'),
  })
}

// ── Contribution hooks ────────────────────────────────────────

export function useContributions(params?: { groupId?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: qk.contributions(params),
    queryFn:  () => contributionsApi.list(params).then(r => r.data.data),
  })
}

export function useMakeContribution() {
  const { showToast } = useUIStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, pin }: { groupId: string; pin?: string }) =>
      contributionsApi.pay(groupId, pin).then(r => r.data),
    onSuccess: (data: any, vars) => {
      qc.invalidateQueries({ queryKey: qk.wallet })
      qc.invalidateQueries({ queryKey: qk.summary })
      // FIX: same undefined-params mismatch — qk.contributions() resolved
      // to ['contributions', undefined], which never matched the real
      // ['contributions', { groupId, page, limit }] cached query.
      qc.invalidateQueries({ queryKey: ['contributions'] })
      qc.invalidateQueries({ queryKey: qk.group(vars.groupId) })
      showToast('Contribution made successfully! 🎉', 'success')
    },
    onError: (err: any) => showToast(err.response?.data?.message || 'Payment failed', 'error'),
  })
}

// ── Wallet hooks ──────────────────────────────────────────────

export function useWallet() {
  return useQuery({
    queryKey: qk.wallet,
    queryFn:  () => walletApi.getWallet().then(r => r.data.data),
    refetchInterval: 30_000,
  })
}

export function useWalletTransactions(params?: { page?: number; limit?: number; type?: string }) {
  return useQuery({
    queryKey: qk.walletTx(params),
    queryFn:  () => walletApi.getTransactions(params).then(r => r.data.data),
  })
}

export function useInitiatePayment() {
  const { showToast } = useUIStore()
  return useMutation({
    mutationFn: (data: { amount: number; provider: string; purpose: string; groupId?: string }) =>
      paymentsApi.initiate(data).then(r => r.data.data),
    onSuccess: (data: any) => {
      // FIX: was window.open(data.authorizationUrl, '_blank') — that sends
      // the user to Paystack in a NEW tab. When Paystack redirects back to
      // /wallet?reference=..., it lands in that new tab, not the original
      // one the user is looking at. usePaymentVerify + refetchWallet() then
      // run in the wrong tab, so the original tab looks stale until its
      // 30s refetchInterval catches up or the user reloads. Redirecting in
      // the SAME tab avoids the split entirely.
      if (data.authorizationUrl) window.location.href = data.authorizationUrl
    },
    onError: (err: any) => showToast(err.response?.data?.message || 'Payment init failed', 'error'),
  })
}

export function useVerifyPayment() {
  const { showToast } = useUIStore()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ reference, provider }: { reference: string; provider: string }) =>
      paymentsApi.verify(reference, provider).then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: qk.wallet })
      qc.invalidateQueries({ queryKey: qk.summary })
      showToast(data.data?.message || 'Wallet funded!', 'success')
    },
    onError: (err: any) => showToast(err.response?.data?.message || 'Verification failed', 'error'),
  })
}

// ── Notification hooks ────────────────────────────────────────

export function useNotifications(params?: { page?: number; unreadOnly?: boolean }) {
  return useQuery({
    queryKey: qk.notifications(params),
    queryFn:  () => notificationsApi.list(params).then(r => r.data.data),
    refetchInterval: 30_000,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: qk.notifications() }),
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  const { showToast } = useUIStore()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: qk.notifications() })
      showToast('All notifications marked as read', 'success')
    },
  })
}

// ── Chat hooks ────────────────────────────────────────────────

export function useChatMessages(groupId: string) {
  return useQuery({
    queryKey: qk.chat(groupId),
    queryFn:  () => chatApi.getMessages(groupId).then(r => r.data.data),
    enabled:  !!groupId,
    refetchOnWindowFocus: false,
  })
}

// ── Admin hooks ───────────────────────────────────────────────

export function useAdminDashboard() {
  return useQuery({
    queryKey: qk.adminDashboard,
    queryFn:  () => adminApi.getDashboard().then(r => r.data.data),
    refetchInterval: 60_000,
  })
}

export function useAdminUsers(params?: any) {
  return useQuery({
    queryKey: qk.adminUsers(params),
    queryFn:  () => adminApi.getUsers(params).then(r => r.data.data),
  })
}

export function useSuspendUser() {
  const qc = useQueryClient()
  const { showToast } = useUIStore()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.suspendUser(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminUsers() })
      showToast('User suspended', 'success')
    },
  })
}