// src/components/MessagesBubble.tsx
// A round "Messages" button on every page (above the support bubble) with the number of unread messages.

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chatApi } from '@/api/smallSmall'
import { unwrap } from '@/components/ss/ssShared'

export default function MessagesBubble() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      chatApi.unreadCount()
        .then(res => { if (!cancelled) setCount(Number((unwrap(res) as any)?.count) || 0) })
        .catch(() => {})
    }
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [pathname])

  // already on the Messages page, or a public page
  if (pathname.startsWith('/messages')) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/messages')}
      aria-label={count > 0 ? `Messages, ${count} unread` : 'Messages'}
      title="Messages"
      style={{
        position: 'fixed', right: 24, bottom: 112, zIndex: 40, width: 56, height: 56, borderRadius: '50%',
        border: '2px solid #1f7a4a', background: '#fff', color: '#1f7a4a', cursor: 'pointer',
        boxShadow: '0 6px 18px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
      </svg>
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
          background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{count > 99 ? '99+' : count}</span>
      )}
    </button>
  )
}