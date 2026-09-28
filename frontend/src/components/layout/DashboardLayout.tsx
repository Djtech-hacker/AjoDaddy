import { useState, useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore }  from '@/stores/authStore'
import { useLogout, useNotifications, useMarkNotificationRead } from '@/hooks/useApi'
import { getSocket } from '@/lib/socket'
import { Avatar } from '@/components/ui'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

const LOGO_URL = 'https://res.cloudinary.com/dmjakrnby/image/upload/v1785357030/real_logo_s3jtjp.png'

// Below this width everyone gets the drawer + hamburger (phones and tablets).
const MOBILE_BREAKPOINT = 1024

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

const I = (d: React.ReactNode) => <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{d}</svg>
const S = { stroke: 'currentColor', strokeWidth: 1.3 } as const

const NAV = [
  { to: '/dashboard', label: 'Overview', icon: I(<><rect x="1" y="1" width="6" height="6" rx="1.5" {...S}/><rect x="9" y="1" width="6" height="6" rx="1.5" {...S}/><rect x="1" y="9" width="6" height="6" rx="1.5" {...S}/><rect x="9" y="9" width="6" height="6" rx="1.5" {...S}/></>) },
  { to: '/groups', label: 'My Groups', icon: I(<><circle cx="5.5" cy="5" r="2.2" {...S}/><circle cx="10.5" cy="5" r="2.2" {...S}/><path d="M1 13c0-2.21 2.015-4 4.5-4s4.5 1.79 4.5 4" {...S} strokeLinecap="round"/><path d="M10.5 9c2.485 0 4.5 1.79 4.5 4" {...S} strokeLinecap="round"/></>) },
  { to: '/wallet', label: 'Wallet', icon: I(<><rect x="1" y="4" width="14" height="9" rx="2" {...S}/><path d="M1 7h14" {...S}/><path d="M4 2.5h8" {...S} strokeLinecap="round"/><circle cx="11.5" cy="10" r="1" fill="currentColor"/></>) },
  { to: '/profile', label: 'Profile', icon: I(<><circle cx="8" cy="5.5" r="2.8" {...S}/><path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" {...S} strokeLinecap="round"/></>) },
  { to: '/support', label: 'Contact Support', icon: I(<><circle cx="8" cy="8" r="6.5" {...S}/><circle cx="8" cy="8" r="2.5" {...S}/><path d="M3.6 3.6l2.3 2.3M12.4 3.6l-2.3 2.3M3.6 12.4l2.3-2.3M12.4 12.4l-2.3-2.3" {...S}/></>) },
]

const ROLE_NAV = [
  { to: '/customer-service', label: 'Customer Service', roles: ['CUSTOMER_SERVICE'],
    icon: I(<><path d="M2 8a6 6 0 0112 0v3.5" {...S} strokeLinecap="round"/><rect x="1.3" y="8" width="2.8" height="4" rx="1.2" {...S}/><rect x="11.9" y="8" width="2.8" height="4" rx="1.2" {...S}/><path d="M12.5 12v1a2 2 0 01-2 2H9" {...S} strokeLinecap="round"/></>) },
  { to: '/admin', label: 'Admin', roles: ['ADMIN', 'SUPER_ADMIN'],
    icon: I(<><circle cx="8" cy="8" r="2" {...S}/><path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" {...S} strokeLinecap="round"/></>) },
  { to: '/super-admin', label: 'Super Admin', roles: ['SUPER_ADMIN'],
    icon: I(<path d="M8 1l2 4 4.5.5-3.25 3.25.75 4.5L8 11l-4 2.25.75-4.5L1.5 5.5 6 5z" {...S} strokeLinejoin="round"/>) },
]

const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
    isActive ? 'bg-emerald-50 text-brand font-semibold' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`

function Sidebar({ onClose, mobile }: { onClose?: () => void; mobile?: boolean }) {
  const { user } = useAuthStore()
  const logout   = useLogout()
  const links = [...NAV, ...ROLE_NAV.filter(r => user?.role && r.roles.includes(user.role))]

  return (
    <aside className="flex-shrink-0 bg-white border-r border-black/[0.06] flex flex-col h-screen" style={{ width: 220 }}>
      <div className="px-4 py-4 flex items-center justify-between">
        {/* Dark chip keeps the logo legible on the light sidebar */}
        <Link to="/" className="bg-void rounded-xl px-3 py-2 inline-flex">
          <img src={LOGO_URL} alt="PayPaddy" className="h-9 w-auto object-contain" />
        </Link>
        {mobile && (
          <button onClick={onClose} aria-label="Close menu"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {links.map(item => (
          <NavLink key={item.to} to={item.to} onClick={onClose} className={navCls}>
            <span className="w-5 flex items-center justify-center flex-shrink-0">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-warm">
          <Avatar src={user?.avatarUrl} name={`${user?.firstName} ${user?.lastName}`} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-gray-900 truncate">{user?.firstName} {user?.lastName}</p>
            <p className="text-[10px] text-gray-400 font-mono truncate">@{user?.username}</p>
          </div>
          <button onClick={() => logout.mutate()} title="Log out"
            className="w-7 h-7 rounded-lg hover:bg-black/[0.06] flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 7H11M11 7L8.5 4.5M11 7L8.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 2H3C2.45 2 2 2.45 2 3V11C2 11.55 2.45 12 3 12H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { data, refetch } = useNotifications({ limit: 10 })
  const markRead = useMarkNotificationRead()
  const navigate = useNavigate()
  const notifications = (data as any)?.notifications || []

  const handleClick = async (n: any) => {
    if (!n.isRead) { await markRead.mutateAsync(n.id); refetch() }
    onClose()
    const type = n.type as string
    const d = n.data || {}
    if (d.groupSlug) { navigate(`/groups/${d.groupSlug}`) }
    else if (type === 'CONTRIBUTION_DUE') { navigate(d.groupSlug ? `/groups/${d.groupSlug}` : d.groupId ? `/groups/${d.groupId}` : '/groups') }
    else if (['MEMBER_JOINED','GROUP_INVITE','GROUP_JOIN_APPROVED','CONTRIBUTION_PAID','PAYOUT_SCHEDULED'].includes(type)) { navigate('/groups') }
    else if (['WALLET_FUNDED','WITHDRAWAL_PROCESSED','PAYOUT_RECEIVED'].includes(type)) { navigate('/wallet') }
  }

  return (
    <motion.div
      className="absolute right-0 top-12 w-[calc(100vw-32px)] max-w-80 bg-white border border-black/[0.07] rounded-2xl shadow-card-md z-40 overflow-hidden"
      initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
      <div className="px-4 py-3 border-b border-black/[0.05] flex items-center justify-between">
        <p className="text-[13px] font-bold text-ink">Notifications</p>
        <button onClick={onClose} className="text-mist hover:text-ink text-[18px] leading-none">×</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="py-10 text-center text-mist text-[13px]">No notifications yet</div>
        ) : notifications.map((n: any) => (
          <div key={n.id} onClick={() => handleClick(n)}
            className={`px-4 py-3.5 border-b border-black/[0.04] last:border-0 hover:bg-warm transition-colors cursor-pointer ${!n.isRead ? 'bg-brand-pale/30' : ''}`}>
            <div className="flex items-start gap-3">
              <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${!n.isRead ? 'bg-brand' : ''}`} />
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink">{n.title}</p>
                <p className="text-[11px] text-dim mt-0.5 leading-relaxed">{n.body}</p>
                <p className="text-[10px] text-mist mt-1 font-mono">{dayjs(n.createdAt).fromNow()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export function DashboardTopbar({ title, subtitle, onMenuClick, isMobile }: {
  title: string; subtitle?: string; onMenuClick?: () => void; isMobile?: boolean
}) {
  const { user, accessToken } = useAuthStore()
  const { data: notifData } = useNotifications({ unreadOnly: true, limit: 50 })
  const unreadCount = (notifData as any)?.notifications?.filter((n: any) => !n.isRead).length || 0
  const [notifOpen, setNotifOpen] = useState(false)
  const queryClient = useQueryClient()

  // Live notifications: backend emits 'notification' to room user:<id>.
  useEffect(() => {
    if (!accessToken) return
    const socket = getSocket(accessToken)
    const onNotification = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      const chime = new Audio('/chime.mp3')
      chime.volume = 0.5
      chime.play().catch(() => {}) // blocked until the user has interacted with the page
    }
    socket.on('notification', onNotification)
    return () => { socket.off('notification', onNotification) }
  }, [accessToken, queryClient])

  return (
    <header className="h-16 bg-white border-b border-black/[0.06] flex items-center justify-between px-4 md:px-6 flex-shrink-0 sticky top-0 z-20">
      <div className="flex items-center gap-3 min-w-0">
        {isMobile && (
          <button onClick={onMenuClick} aria-label="Open menu"
            className="w-9 h-9 rounded-lg border border-black/[0.06] bg-warm flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H14M2 12H10" stroke="#6B6760" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-[16px] font-bold text-ink tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-[11px] text-mist mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="relative">
          <button onClick={() => setNotifOpen(v => !v)}
            className="w-9 h-9 rounded-lg border border-black/[0.06] bg-warm flex items-center justify-center hover:bg-sand transition-colors relative">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1.5C5.01 1.5 3 3.51 3 6V9L1.5 11H13.5L12 9V6C12 3.51 9.99 1.5 7.5 1.5Z" stroke="#6B6760" strokeWidth="1.3"/>
              <path d="M6 12C6 12.83 6.67 13.5 7.5 13.5C8.33 13.5 9 12.83 9 12" stroke="#6B6760" strokeWidth="1.3"/>
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] font-bold text-white flex items-center justify-center border-2 border-warm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <AnimatePresence>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                <NotificationsPanel onClose={() => setNotifOpen(false)} />
              </>
            )}
          </AnimatePresence>
        </div>
        <Avatar src={user?.avatarUrl} name={`${user?.firstName || ''} ${user?.lastName || ''}`} size="sm" className="cursor-pointer flex-shrink-0" />
      </div>
    </header>
  )
}

export default function DashboardLayout({ children, title, subtitle }: {
  children: React.ReactNode; title: string; subtitle?: string
}) {
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { if (!isMobile) setMobileOpen(false) }, [isMobile])

  return (
    <div className="flex h-screen w-screen bg-warm overflow-hidden">
      {!isMobile && <Sidebar />}

      <AnimatePresence>
        {isMobile && mobileOpen && (
          <motion.div className="fixed inset-0 z-40 flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.div className="relative z-50 h-full" initial={{ x: -220 }} animate={{ x: 0 }} exit={{ x: -220 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
              <Sidebar mobile onClose={() => setMobileOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <DashboardTopbar title={title} subtitle={subtitle} isMobile={isMobile} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  )
}