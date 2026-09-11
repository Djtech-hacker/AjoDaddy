import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore }   from '@/stores/uiStore'
import { useMaintenanceStore } from '@/stores/maintenanceStore'
import { authApi, platformApi } from '@/api/services'
import { getSocket, disconnectSocket } from '@/lib/socket'
import Toast from '@/components/ui/Toast'
import { CinematicLoader } from '@/components/ui/CinematicLoader'
import { PageTransition }  from '@/components/ui/PageTransition'
import { MaintenanceScreen } from '@/components/ui/MaintenanceScreen'
import { MaintenanceBanner } from '@/components/ui/MaintenanceBanner'

import LoginPage       from '@/pages/auth/LoginPage'
import RegisterPage    from '@/pages/auth/RegisterPage'
import VerifyEmail     from '@/pages/auth/VerifyEmail'
import ForgotPassword  from '@/pages/auth/ForgotPassword'
import ResetPassword   from '@/pages/auth/ResetPassword'
import DashboardPage   from '@/pages/dashboard/DashboardPage'
import GroupsPage      from '@/pages/groups/GroupsPage'
import GroupDetailPage from '@/pages/groups/GroupDetailPage'
import JoinPage        from '@/pages/groups/JoinPage'
import WalletPage      from '@/pages/wallet/WalletPage'
import ProfilePage     from '@/pages/dashboard/ProfilePage'
import AdminPage       from '@/pages/dashboard/AdminPage'
import SuperAdminPage  from '@/pages/dashboard/SuperAdminPage'
import SupportPage     from '@/pages/support/SupportPage'
import CustomerServiceDashboardPage from '@/pages/support/CustomerServiceDashboardPage'
import LandingPage     from '@/pages/LandingPage'
import NotFoundPage    from '@/pages/NotFoundPage'
import KycVerificationPage from '@/pages/Kyc/KycVerificationPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  const location = useLocation()
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user || user.role !== 'SUPER_ADMIN') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}


function RequireCustomerService({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user || user.role !== 'CUSTOMER_SERVICE') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const { user, setUser, setAccessToken, accessToken } = useAuthStore()
  const { toast } = useUIStore()
  const { isMaintenanceMode } = useMaintenanceStore()
  const location  = useLocation()
  const [appReady, setAppReady] = useState(false)

  useEffect(() => {
    if (user && !accessToken) {
      authApi.refresh()
        .then(res => { setAccessToken(res.data.data?.accessToken); setUser(res.data.data?.user) })
        .catch(() => { setUser(null); setAccessToken(null) })
    }
  }, [])

  useEffect(() => {
    if (user && accessToken) {
      const socket = getSocket(accessToken)
      socket.on('notification', (notif: any) => { useUIStore.getState().showToast(notif.title, 'info') })
    } else { disconnectSocket() }
    return () => { disconnectSocket() }
  }, [user, accessToken])

  // ── Poll platform status proactively ──
  // This catches maintenance mode (or a pending schedule) even if the
  // user hasn't triggered a failing API call yet — e.g. someone sitting
  // on the dashboard when the admin flips the toggle, or a countdown
  // banner for maintenance scheduled minutes/hours in advance.
  useEffect(() => {
    const checkStatus = () => {
      platformApi.getStatus().then(res => {
        const data = (res.data as any)?.data || res.data
        if (data.maintenanceMode) {
          useMaintenanceStore.getState().setMaintenanceMode(true, data.maintenanceAnnouncement)
          useMaintenanceStore.getState().setScheduledMaintenance(null)
        } else {
          useMaintenanceStore.getState().setMaintenanceMode(false)
          useMaintenanceStore.getState().setScheduledMaintenance(data.maintenanceScheduledAt, data.maintenanceAnnouncement)
        }
      }).catch(() => {})
    }
    checkStatus()
    const interval = setInterval(checkStatus, 15000)
    return () => clearInterval(interval)
  }, [])

  // Admin & Super Admin stay in — the backend guard already lets
  // /api/admin traffic through during maintenance mode, so they need
  // to still see the app to be able to switch the toggle back off.
  const isExemptFromMaintenance = user && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
  const showMaintenanceScreen = appReady && isMaintenanceMode && !isExemptFromMaintenance

  return (
    <>
      {!appReady && <CinematicLoader onComplete={() => setAppReady(true)} duration={3200} />}
      {appReady && (
        showMaintenanceScreen ? (
          <MaintenanceScreen />
        ) : (
          <>
            <MaintenanceBanner />
            <PageTransition>
              <AnimatePresence mode="wait">
                <Routes location={location} key={location.pathname}>
                  <Route path="/"                element={<LandingPage />} />
                  <Route path="/login"           element={<GuestOnly><LoginPage /></GuestOnly>} />
                  <Route path="/register"        element={<GuestOnly><RegisterPage /></GuestOnly>} />
                  <Route path="/verify-email"    element={<VerifyEmail />} />
                  <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
                  <Route path="/reset-password"  element={<GuestOnly><ResetPassword /></GuestOnly>} />
                  <Route path="/join/:code"      element={<RequireAuth><JoinPage /></RequireAuth>} />
                  <Route path="/dashboard"       element={<RequireAuth><DashboardPage /></RequireAuth>} />
                  <Route path="/groups"          element={<RequireAuth><GroupsPage /></RequireAuth>} />
                  <Route path="/groups/:slug"    element={<RequireAuth><GroupDetailPage /></RequireAuth>} />
                  <Route path="/verify-identity" element={<KycVerificationPage />} />
                  <Route path="/wallet"          element={<RequireAuth><WalletPage /></RequireAuth>} />
                  <Route path="/payment/verify"  element={<RequireAuth><WalletPage /></RequireAuth>} />
                  <Route path="/profile"         element={<RequireAuth><ProfilePage /></RequireAuth>} />
                  <Route path="/u/:username"     element={<RequireAuth><ProfilePage /></RequireAuth>} />
                  <Route path="/support"         element={<RequireAuth><SupportPage /></RequireAuth>} />
                  <Route path="/customer-service" element={<RequireAuth><RequireCustomerService><CustomerServiceDashboardPage /></RequireCustomerService></RequireAuth>} />
                  <Route path="/admin"           element={<RequireAuth><RequireAdmin><AdminPage /></RequireAdmin></RequireAuth>} />
                  <Route path="/super-admin"     element={<RequireAuth><RequireSuperAdmin><SuperAdminPage /></RequireSuperAdmin></RequireAuth>} />
                  <Route path="*"               element={<NotFoundPage />} />
                </Routes>
              </AnimatePresence>
            </PageTransition>
            {toast && <Toast message={toast.message} type={toast.type} />}
          </>
        )
      )}
    </>
  )
}