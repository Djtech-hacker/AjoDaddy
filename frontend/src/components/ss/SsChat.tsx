// src/components/ss/SsChat.tsx
// Chat between the customer and the vendor of one plan. It asks for new messages every few seconds.

import { useCallback, useEffect, useRef, useState } from 'react'
import { chatApi } from '@/api/smallSmall'
import { errMsg, unwrap } from '@/components/ss/ssShared'

type Msg = { id: string; mine: boolean; senderName: string; content: string | null; isDeleted: boolean; createdAt: string }
type ChatData = {
  thread: { id: string; isOpen: boolean; otherName: string; productName: string; orderNumber: string }
  messages: Msg[]
}

const timeOf = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const hm = d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? hm : `${d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}, ${hm}`
}

export default function SsChat({ threadId, height = 420 }: { threadId: string; height?: number }) {
  const [data, setData] = useState<ChatData | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const shownCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await chatApi.messages(threadId)
      setData(unwrap(res) as ChatData)
      setError('')
    } catch (e) {
      setError(errMsg(e, 'Could not load the chat.'))
    }
  }, [threadId])

  useEffect(() => {
    setData(null)
    shownCount.current = 0
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5000)
    return () => clearInterval(timer)
  }, [load])

  // jump to the newest message when one arrives
  useEffect(() => {
    const n = data?.messages.length ?? 0
    if (n !== shownCount.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
      shownCount.current = n
    }
  }, [data])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true); setError('')
    try {
      const res = await chatApi.send(threadId, t)
      const msg = unwrap(res) as Msg
      setData(d => (d ? { ...d, messages: [...d.messages, msg] } : d))
      setText('')
    } catch (e) {
      setError(errMsg(e, 'Could not send your message.'))
    } finally {
      setSending(false)
    }
  }

  const remove = async (m: Msg) => {
    if (!window.confirm('Delete this message?')) return
    try {
      await chatApi.remove(threadId, m.id)
      setData(d => (d ? { ...d, messages: d.messages.map(x => (x.id === m.id ? { ...x, isDeleted: true, content: null } : x)) } : d))
    } catch (e) {
      setError(errMsg(e, 'Could not delete that message.'))
    }
  }

  if (!data && !error) return <div className="ss-skel" style={{ height }} />

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
      {data && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #E5E7EB', background: '#F9FAFB' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{data.thread.otherName}</div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>{data.thread.productName} · {data.thread.orderNumber}</div>
        </div>
      )}

      <div ref={listRef} style={{ height, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, background: '#F3F4F6' }}>
        {data && data.messages.length === 0 && (
          <p style={{ margin: 'auto', color: '#6B7280', fontSize: 13, textAlign: 'center' }}>No messages yet. Say hello 👋</p>
        )}
        {data?.messages.map(m => (
          <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
            <div style={{
              padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: m.mine ? '#1f7a4a' : '#fff', color: m.mine ? '#fff' : '#111827',
              border: m.mine ? 'none' : '1px solid #E5E7EB',
              borderBottomRightRadius: m.mine ? 4 : 14, borderBottomLeftRadius: m.mine ? 14 : 4,
            }}>
              {m.isDeleted ? <em style={{ opacity: 0.6 }}>This message was deleted</em> : m.content}
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, textAlign: m.mine ? 'right' : 'left' }}>
              {timeOf(m.createdAt)}
              {m.mine && !m.isDeleted && <> · <button type="button" onClick={() => remove(m)} style={{ background: 'none', border: 0, padding: 0, color: '#9CA3AF', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}>Delete</button></>}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="ss-note err" role="alert" style={{ margin: 10 }}>{error}</div>}

      {data && !data.thread.isOpen ? (
        <p style={{ padding: 12, fontSize: 13, color: '#6B7280', margin: 0 }}>This chat is closed.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #E5E7EB' }}>
          <textarea
            value={text} maxLength={2000} rows={1} placeholder="Type a message…"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            style={{ flex: 1, resize: 'none', border: '1px solid #E5E7EB', borderRadius: 12, padding: '10px 12px', font: 'inherit', fontSize: 14, outline: 'none' }}
          />
          <button type="button" className="ss-btn" disabled={!text.trim() || sending} onClick={send}>{sending ? '…' : 'Send'}</button>
        </div>
      )}
    </div>
  )
}