// ============================================================
// API CLIENT — Axios with auth interceptors + token refresh
// ============================================================

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useMaintenanceStore } from '@/stores/maintenanceStore'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

// Default wait. The backend talks to a remote database, so a request can
// legitimately take well over 15s on a slow connection.
const DEFAULT_TIMEOUT_MS = 30000

// These endpoints do several database writes in a row. If the browser gives up
// before the server finishes, the user sees "failed" even though it worked
// (that is how a second register attempt ended in "Phone number already registered").
const SLOW_ENDPOINTS = [
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/auth/send-phone-otp',
  '/auth/verify-phone-otp',
]
const SLOW_TIMEOUT_MS = 60000

export const api = axios.create({
  baseURL:         BASE_URL,
  withCredentials: true,
  headers:         { 'Content-Type': 'application/json' },
  timeout:         DEFAULT_TIMEOUT_MS,
})

// ── Lazy-load the store to break the circular import ─────────
// DO NOT top-level import useAuthStore here — it was imported at the
// bottom of the old file after being referenced at the top, meaning
// the interceptor closures captured `undefined` at registration time.
const getAuthStore = () =>
  (import('@/stores/authStore') as any).then((m: any) => m.useAuthStore)

// Synchronous getter for the request interceptor (store is always
// initialised by the time a request fires).
let _authStore: any = null
import('@/stores/authStore').then((m: any) => { _authStore = m.useAuthStore })

// ── Inject access token on every request ─────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = _authStore?.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`

  // Give slow multi-step endpoints more time. Never lowers a timeout a caller
  // already set higher (e.g. withdrawals use 60s).
  if (SLOW_ENDPOINTS.some(p => config.url?.includes(p))) {
    config.timeout = Math.max(config.timeout ?? 0, SLOW_TIMEOUT_MS)
  }

  // Any successful request means the platform isn't down — clear a
  // stale maintenance flag if one was set (e.g. admin just turned it off).
  if (useMaintenanceStore.getState().isMaintenanceMode) {
    useMaintenanceStore.getState().setMaintenanceMode(false)
  }

  return config
})

// ── Handle 401 → attempt token refresh ───────────────────────
let isRefreshing = false
let failedQueue: Array<{ resolve: (t: string) => void; reject: (e: any) => void }> = []

const processQueue = (error: any, token?: string) => {
  failedQueue.forEach(p => (error ? p.reject(error) : p.resolve(token!)))
  failedQueue = []
}

api.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    // ── Platform-wide maintenance mode — show the maintenance
    // screen instead of letting every page render broken/empty
    // states (no wallet balance, "user not found", etc).
    if (error.response?.status === 503) {
      const data = error.response.data as any
      useMaintenanceStore.getState().setMaintenanceMode(
        true,
        data?.message || "TAREVA is temporarily down for maintenance. We'll be back shortly.",
      )
      return Promise.reject(error)
    }

    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    // ── Skip the interceptor for the refresh call itself, and for
    // login/register — a 401 on /auth/login means "wrong password" or
    // "email not verified", NOT "your session expired". Letting those
    // fall into the refresh-retry path below caused a failed login to
    // trigger a doomed refresh attempt → logout() → hard redirect to
    // /login?reason=session_expired, wiping out the real error message
    // (e.g. "Please verify your email before logging in") before the
    // login form ever got to show it.
    if (
      original.url?.includes('/auth/refresh') ||
      original.url?.includes('/auth/login') ||
      original.url?.includes('/auth/register')
    ) {
      return Promise.reject(error)
    }

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    // ── Queue concurrent requests while a refresh is in flight ─
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then(token => {
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      })
    }

    original._retry = true
    isRefreshing    = true

    try {
      // Use a plain axios instance — NOT `api` — so this call
      // bypasses the response interceptor entirely and can't loop.
      const { data } = await axios.post(
        `${BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true, timeout: SLOW_TIMEOUT_MS },
      )

      const newToken = data.data?.accessToken ?? data.accessToken
      if (!newToken) throw new Error('No token in refresh response')

      // Persist the new token
      const store = await getAuthStore()
      store.getState().setAccessToken(newToken)

      processQueue(null, newToken)
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)

    } catch (refreshErr) {
      processQueue(refreshErr)

      // Only logout + redirect if the refresh itself got a 401/403.
      // Network errors (500, timeout) should NOT log the user out.
      const status = (refreshErr as AxiosError).response?.status
      if (!status || status === 401 || status === 403) {
        const store = await getAuthStore()
        store.getState().logout()
        window.location.href = '/login?reason=session_expired'
      }

      return Promise.reject(refreshErr)

    } finally {
      isRefreshing = false
    }
  },
)

export default api