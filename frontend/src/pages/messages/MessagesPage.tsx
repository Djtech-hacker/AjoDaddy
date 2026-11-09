// src/pages/messages/MessagesPage.tsx   (route: /messages)
// Every conversation in one place, for customers AND vendors. Open one to read and reply right here.
// A link like /messages?thread=<id> (from an email or notification) opens that conversation.
// Each conversation shows the product it is about (photo, name, price). Tap it to open the product.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { chatApi } from '@/api/smallSmall'
import { SsStyles, Empty, Pill, naira, fmtDate, errMsg, unwrap, statusTone } from '@/components/ss/ssShared'
import SsChat from '@/components/ss/SsChat'

type Thread = {
  threadId: string; role: 'CUSTOMER' | 'VENDOR'; otherName: string; productName: string
  productId: string | null; productThumb: string | null; productPrice: number | null
  orderId: string | null; hasPlan: boolean
  lastMessage: string | null; lastMessageAt: string | null; unread: number
}

// a small square product photo
function Photo({ src, size }: { src: string | null; size: number }) {
  return (
    <div style={{
      width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 10, overflow: 'hidden',
      background: '#f1f5f2', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, color: '#94a3b8', textAlign: 'center',
    }}>
      {src ? <img src={src} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'No photo'}
    </div>
  )
}

export default function MessagesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const openId = params.get('thread')
  const chatRef = useRef<HTMLDivElement>(null)

  const [items, setItems] = useState<Thread[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    chatApi.myThreads()
      .then(res => { setItems((unwrap(res) as any).items as Thread[]); setError('') })
      .catch(e => setError(errMsg(e, 'Could not load your messages.')))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10000)
    return () => clearInterval(timer)
  }, [load])

  // on a phone the chat is below the list, so bring it into view
  useEffect(() => {
    if (openId && window.innerWidth < 900) {
      setTimeout(() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    }
  }, [openId])

  const open = (id: string) => {
    setParams({ thread: id })
    // reading a conversation marks it read, so refresh the numbers a moment later
    setTimeout(load, 1500)
  }

  const current = items?.find(t => t.threadId === openId) || null

  return (
    <DashboardLayout title="Messages" subtitle="Your conversations">
      <div className="ss-root">
        <SsStyles />

        {error && <div className="ss-note err" role="alert">{error}</div>}

        {items === null && !error ? (
          <div className="ss-list">{[1, 2, 3].map(i => <div key={i} className="ss-skel" style={{ height: 70 }} />)}</div>
        ) : items && items.length === 0 && !openId ? (
          <Empty
            title="No messages yet"
            text="Open a product in the shop and tap Message the vendor, or wait for a customer to write to you."
            action={<button type="button" className="ss-btn" onClick={() => navigate('/shop')}>Browse the shop →</button>}
          />
        ) : (
          <div className="ss-split">
            {/* the list */}
            <div className="ss-list">
              {items?.map(t => (
                <div key={t.threadId}
                  className={`ss-item click ${t.threadId === openId ? 'on' : ''}`}
                  style={{ alignItems: 'center', gap: 12, ...(t.threadId === openId ? { borderColor: '#1f7a4a' } : {}) }}
                  role="button" tabIndex={0}
                  onClick={() => open(t.threadId)} onKeyDown={e => { if (e.key === 'Enter') open(t.threadId) }}>
                  <Photo src={t.productThumb} size={52} />
                  <div className="ss-item-main" style={{ minWidth: 0 }}>
                    <p className="ss-item-t">{t.otherName}</p>
                    <p className="ss-item-s">{t.productName} · {t.role === 'VENDOR' ? 'customer' : 'vendor'}</p>
                    <p className="ss-item-s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessage || 'No messages yet'}</p>
                  </div>
                  <div className="ss-item-r" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    {t.unread > 0 && <Pill tone={statusTone('ACTIVE')}>{t.unread} new</Pill>}
                    {t.lastMessageAt && <p className="ss-item-s">{fmtDate(t.lastMessageAt)}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* the open conversation */}
            <div className="ss-stack" ref={chatRef}>
              {openId ? (
                <>
                  {/* which product this chat is about: photo, name and price. Tap it to open the product. */}
                  {current && (
                    <div
                      className="ss-item click"
                      role="button"
                      tabIndex={current.productId ? 0 : -1}
                      aria-disabled={!current.productId}
                      style={{ alignItems: 'center', gap: 12, cursor: current.productId ? 'pointer' : 'default' }}
                      onClick={() => { if (current.productId) navigate(`/shop/${current.productId}`) }}
                      onKeyDown={e => { if (e.key === 'Enter' && current.productId) navigate(`/shop/${current.productId}`) }}
                    >
                      <Photo src={current.productThumb} size={64} />
                      <div className="ss-item-main" style={{ minWidth: 0 }}>
                        <p className="ss-item-t">{current.productName}</p>
                        <p className="ss-item-s">
                          {current.productPrice != null ? `${naira(current.productPrice)} · ` : ''}
                          {current.role === 'CUSTOMER' ? `Sold by ${current.otherName}` : `Customer: ${current.otherName}`}
                        </p>
                        {current.productId && <p className="ss-item-s" style={{ color: '#1f7a4a', fontWeight: 600 }}>View product →</p>}
                      </div>
                    </div>
                  )}

                  <SsChat key={openId} threadId={openId} height={420} />

                  {current && (
                    <div className="ss-row" style={{ marginTop: 0 }}>
                      {current.role === 'CUSTOMER' && current.hasPlan && current.orderId && (
                        <button type="button" className="ss-btn ghost sm" onClick={() => navigate(`/plans/${current.orderId}`)}>View my plan</button>
                      )}
                      {current.role === 'CUSTOMER' && !current.hasPlan && current.productId && (
                        <button type="button" className="ss-btn ghost sm" onClick={() => navigate(`/shop/${current.productId}`)}>View the product</button>
                      )}
                      {current.role === 'VENDOR' && (
                        <button type="button" className="ss-btn ghost sm" onClick={() => navigate('/vendor')}>Go to my shop</button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="ss-card"><p className="ss-p">Choose a conversation to read and reply.</p></div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}