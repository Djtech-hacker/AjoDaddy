// ============================================================
// GROUP CHAT — WhatsApp-style with edit, delete, reply, @mention
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Avatar, EmptyState } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'
import { chatApi } from '@/api/services'
import {
  getSocket, joinGroupRoom, leaveGroupRoom,
  sendSocketMessage, emitTypingStart, emitTypingStop,
} from '@/lib/socket'
import type { ChatMessage } from '@/types'
import dayjs from 'dayjs'

// ── Icons ─────────────────────────────────────────────────────
const ReplyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
  </svg>
)
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
)

// ── Member type for mentions ──────────────────────────────────
interface MentionMember {
  id: string
  username: string
  firstName: string
  lastName: string
  avatarUrl?: string
}

// ── Parse message content with @mentions highlighted ─────────
function MessageContent({
  content,
  currentUserId,
  members,
  onMentionClick,
}: {
  content: string
  currentUserId: string
  members: MentionMember[]
  onMentionClick: (userId: string) => void
}) {
  // Split on @username patterns
  const parts = content.split(/(@\w+)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const username = part.slice(1)
          const member = members.find(m => m.username === username)
          if (member) {
            const isMe = member.id === currentUserId
            return (
              <button
                key={i}
                onClick={() => onMentionClick(member.id)}
                className={`font-bold rounded px-0.5 transition-opacity hover:opacity-70 ${
                  isMe
                    ? 'bg-white/30 text-white'
                    : 'bg-brand/10 text-brand'
                }`}
              >
                {part}
              </button>
            )
          }
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ── Message context menu ──────────────────────────────────────
function MessageMenu({
  isMe,
  anchorRef,
  scrollRef,
  onReply,
  onEdit,
  onDelete,
  onClose,
}: {
  isMe: boolean
  anchorRef: React.RefObject<HTMLDivElement>
  scrollRef: React.RefObject<HTMLDivElement>
  onReply: () => void
  onEdit?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [openUp, setOpenUp] = useState(true)

  useEffect(() => {
    if (anchorRef.current && scrollRef.current) {
      const anchorRect = anchorRef.current.getBoundingClientRect()
      const scrollRect = scrollRef.current.getBoundingClientRect()
      const spaceAbove = anchorRect.top - scrollRect.top
      setOpenUp(spaceAbove > 120)
    }
  }, [anchorRef, scrollRef])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <motion.div
      ref={menuRef}
      className={`absolute z-50 bg-white rounded-xl shadow-lg border border-black/[0.08] py-1.5 min-w-[140px] ${
        isMe ? 'right-0' : 'left-0'
      } ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
      initial={{ opacity: 0, scale: 0.92, y: openUp ? 4 : -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: openUp ? 4 : -4 }}
      transition={{ duration: 0.12 }}
    >
      <button
        onClick={() => { onReply(); onClose() }}
        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] font-semibold text-ink hover:bg-sand transition-colors"
      >
        <ReplyIcon /> Reply
      </button>
      {isMe && onEdit && (
        <button
          onClick={() => { onEdit(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] font-semibold text-ink hover:bg-sand transition-colors"
        >
          <EditIcon /> Edit
        </button>
      )}
      {onDelete && (
        <button
          onClick={() => { onDelete(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] font-semibold text-red-500 hover:bg-red-50 transition-colors"
        >
          <TrashIcon /> {isMe ? 'Delete' : 'Delete (admin)'}
        </button>
      )}
    </motion.div>
  )
}

// ── Single message bubble ─────────────────────────────────────
function MessageBubble({
  msg,
  isMe,
  isAdmin,
  onReply,
  onEdit,
  onDelete,
  replyTo,
  scrollRef,
  members,
  currentUserId,
  onMentionClick,
  msgRef,
}: {
  msg: ChatMessage
  isMe: boolean
  isAdmin: boolean
  onReply: (msg: ChatMessage) => void
  onEdit: (msg: ChatMessage) => void
  onDelete: (msg: ChatMessage) => void
  replyTo?: ChatMessage | null
  scrollRef: React.RefObject<HTMLDivElement>
  members: MentionMember[]
  currentUserId: string
  onMentionClick: (userId: string) => void
  msgRef?: (el: HTMLDivElement | null) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // Check if current user is mentioned in this message
  const currentMember = members.find(m => m.id === currentUserId)
  const isMentioned = currentMember && msg.content?.includes(`@${currentMember.username}`)

  return (
    <motion.div
      ref={msgRef}
      className={`flex items-end gap-2 group ${isMe ? 'flex-row-reverse' : ''} ${
        isMentioned ? 'bg-brand/5 -mx-4 px-4 py-1 rounded-xl' : ''
      }`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {!isMe && (
        <Avatar
          src={(msg as any).sender?.avatarUrl}
          name={(msg as any).sender?.firstName || '?'}
          size="xs"
          className="flex-shrink-0 mb-0.5"
        />
      )}

      <div className={`max-w-[72%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
        {!isMe && (
          <p className="text-[10px] text-mist font-semibold px-1">
            {(msg as any).sender?.firstName}
          </p>
        )}

        <div className="relative" ref={bubbleRef}>
          <div
            onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true) }}
            onDoubleClick={() => onReply(msg)}
            className="cursor-pointer"
          >
            {/* Reply preview */}
            {replyTo && !msg.isDeleted && (
              <div className={`mb-1 px-3 py-1.5 rounded-xl border-l-2 border-brand bg-black/[0.04] max-w-full ${isMe ? 'border-r-2 border-l-0 bg-white/20' : ''}`}>
                <p className="text-[10px] font-bold text-brand mb-0.5">
                  {(replyTo as any).sender?.firstName || 'Unknown'}
                </p>
                <p className="text-[11px] text-dim line-clamp-2">
                  {replyTo.isDeleted ? '🚫 Deleted message' : replyTo.content}
                </p>
              </div>
            )}

            {/* Bubble */}
            <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed select-none ${
              isMe
                ? 'bg-brand text-white rounded-br-sm'
                : 'bg-white border border-black/[0.07] text-ink rounded-bl-sm shadow-sm'
            }`}>
              {msg.isDeleted ? (
                <em className="opacity-40 text-[12px]">🚫 This message was deleted</em>
              ) : (
                <MessageContent
                  content={msg.content || ''}
                  currentUserId={currentUserId}
                  members={members}
                  onMentionClick={onMentionClick}
                />
              )}
            </div>
          </div>

          {/* Context menu */}
          <AnimatePresence>
            {menuOpen && !msg.isDeleted && (
              <MessageMenu
                isMe={isMe}
                anchorRef={bubbleRef}
                scrollRef={scrollRef}
                onReply={() => onReply(msg)}
                onEdit={isMe ? () => onEdit(msg) : undefined}
                onDelete={(isMe || isAdmin) ? () => onDelete(msg) : undefined}
                onClose={() => setMenuOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Hover quick-reply */}
          {!msg.isDeleted && (
            <div className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity ${isMe ? '-left-8' : '-right-8'}`}>
              <button
                onClick={() => onReply(msg)}
                className="w-7 h-7 bg-white rounded-full shadow-md flex items-center justify-center text-mist hover:text-brand transition-colors border border-black/[0.06]"
              >
                <ReplyIcon />
              </button>
            </div>
          )}
        </div>

        <p className="text-[9px] text-mist px-1 font-mono flex items-center gap-1">
          {dayjs(msg.createdAt).format('h:mm A')}
          {!msg.isDeleted && (
            (msg as any).isEdited ||
            ((msg as any).updatedAt && (msg as any).updatedAt !== (msg as any).createdAt)
          ) && (
            <span className="italic opacity-60">· edited</span>
          )}
        </p>
      </div>
    </motion.div>
  )
}

// ── Mention dropdown ──────────────────────────────────────────
function MentionDropdown({
  members,
  query,
  onSelect,
}: {
  members: MentionMember[]
  query: string
  onSelect: (member: MentionMember) => void
}) {
  const filtered = members.filter(m =>
    m.username.toLowerCase().includes(query.toLowerCase()) ||
    m.firstName.toLowerCase().includes(query.toLowerCase()) ||
    m.lastName.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6)

  if (filtered.length === 0) return null

  return (
    <motion.div
      className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-black/[0.08] rounded-xl shadow-lg overflow-hidden z-50"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.12 }}
    >
      <div className="px-3 py-1.5 border-b border-black/[0.05]">
        <p className="text-[10px] font-bold text-mist uppercase tracking-wider">Mention someone</p>
      </div>
      {filtered.map(member => (
        <button
          key={member.id}
          onClick={() => onSelect(member)}
          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-sand transition-colors text-left"
        >
          <Avatar src={member.avatarUrl} name={member.firstName} size="xs" />
          <div>
            <p className="text-[12px] font-semibold text-ink">{member.firstName} {member.lastName}</p>
            <p className="text-[10px] text-mist">@{member.username}</p>
          </div>
        </button>
      ))}
    </motion.div>
  )
}

// ── Main GroupChat component ──────────────────────────────────
export default function GroupChat({
  groupId,
  currentUserId,
  isAdmin = false,
  members = [],
}: {
  groupId: string
  currentUserId: string
  isAdmin?: boolean
  members?: MentionMember[]
}) {
  const { accessToken, user } = useAuthStore()

  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [input, setInput]         = useState('')
  const [typing, setTyping]       = useState<string | null>(null)
  const [replyTo, setReplyTo]     = useState<ChatMessage | null>(null)
  const [editMsg, setEditMsg]     = useState<ChatMessage | null>(null)
  const [sending, setSending]     = useState(false)
  const [loading, setLoading]     = useState(true)

  // @mention state
  const [mentionQuery, setMentionQuery]   = useState<string | null>(null)
  const [mentionOpen, setMentionOpen]     = useState(false)

  const endRef    = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const msgMap    = useRef<Map<string, ChatMessage>>(new Map())
  // Map userId → DOM element for scrolling to mention
  const msgRefs   = useRef<Map<string, HTMLDivElement>>(new Map())

  // ── Load messages ────────────────────────────────────────────
  const loadMessages = useCallback(() => {
    if (!groupId) return
    setLoading(true)
    chatApi.getMessages(groupId)
      .then(res => {
        const raw = res as any
        const msgs: ChatMessage[] =
          Array.isArray(raw)                       ? raw :
          Array.isArray(raw?.data?.messages)       ? raw.data.messages :
          Array.isArray(raw?.data?.data?.messages) ? raw.data.data.messages :
          Array.isArray(raw?.data)                 ? raw.data :
          Array.isArray(raw?.messages)             ? raw.messages :
          Array.isArray(raw?.data?.data)           ? raw.data.data :
          []
        msgMap.current.clear()
        msgs.forEach(m => msgMap.current.set(m.id, m))
        setMessages(msgs)
      })
      .catch(err => console.error('[GroupChat] getMessages error:', err))
      .finally(() => setLoading(false))
  }, [groupId])

  useEffect(() => {
    setMessages([])
    msgMap.current.clear()
    loadMessages()
  }, [loadMessages])

  // ── Socket setup ─────────────────────────────────────────────
  useEffect(() => {
    if (!groupId || !accessToken) return
    const socket = getSocket(accessToken)

    const onNewMessage = (msg: ChatMessage) => {
      if (msgMap.current.has(msg.id)) return
      msgMap.current.set(msg.id, msg)
      setMessages(prev => [...prev, msg])
    }
    const onEdited = (updated: ChatMessage) => {
      const withFlag = { ...updated, isEdited: true }
      msgMap.current.set(withFlag.id, withFlag)
      setMessages(prev => prev.map(m => m.id === withFlag.id ? withFlag : m))
    }
    const onDeleted = ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isDeleted: true } : m))
    }
    const onTyping = ({ username }: { username: string }) => {
      if (username === (user?.username || user?.firstName)) return
      setTyping(username)
      setTimeout(() => setTyping(null), 3000)
    }
    const onStopTyping = () => setTyping(null)
    const onConnect = () => {
      joinGroupRoom(groupId)
      loadMessages()
    }

    if (socket.connected) joinGroupRoom(groupId)

    socket.on('connect',          onConnect)
    socket.on('new_message',      onNewMessage)
    socket.on('message_edited',   onEdited)
    socket.on('message_deleted',  onDeleted)
    socket.on('user_typing',      onTyping)
    socket.on('user_stop_typing', onStopTyping)

    return () => {
      leaveGroupRoom(groupId)
      socket.off('connect',          onConnect)
      socket.off('new_message',      onNewMessage)
      socket.off('message_edited',   onEdited)
      socket.off('message_deleted',  onDeleted)
      socket.off('user_typing',      onTyping)
      socket.off('user_stop_typing', onStopTyping)
    }
  }, [groupId, accessToken, user, loadMessages])

  // ── Auto scroll ──────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (replyTo || editMsg) inputRef.current?.focus()
  }, [replyTo, editMsg])

  // ── @mention: scroll to first message from that user ────────
  const handleMentionClick = useCallback((userId: string) => {
    // Find the last message sent by that user and scroll to it
    const targetMsg = [...messages].reverse().find(m => m.senderId === userId)
    if (targetMsg) {
      const el = msgRefs.current.get(targetMsg.id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Flash highlight
        el.classList.add('bg-brand/10')
        setTimeout(() => el.classList.remove('bg-brand/10'), 1500)
      }
    }
  }, [messages])

  // ── Input change with @mention detection ────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInput(val)

    // Detect @mention trigger
    const cursorPos = e.target.selectionStart || 0
    const textUpToCursor = val.slice(0, cursorPos)
    const mentionMatch = textUpToCursor.match(/@(\w*)$/)

    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
      setMentionOpen(true)
    } else {
      setMentionQuery(null)
      setMentionOpen(false)
    }

    if (val && user) {
      emitTypingStart(groupId, user.username || user.firstName || 'Someone')
    } else {
      emitTypingStop(groupId)
    }
  }

  // ── Select a mention from dropdown ──────────────────────────
  const handleMentionSelect = useCallback((member: MentionMember) => {
    const cursorPos = inputRef.current?.selectionStart || input.length
    const textUpToCursor = input.slice(0, cursorPos)
    const beforeMention = textUpToCursor.replace(/@(\w*)$/, '')
    const afterCursor = input.slice(cursorPos)
    const newInput = `${beforeMention}@${member.username} ${afterCursor}`
    setInput(newInput)
    setMentionOpen(false)
    setMentionQuery(null)
    // Refocus and move cursor to end of inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        const newPos = beforeMention.length + member.username.length + 2
        inputRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }, [input])

  // ── Send / Edit ──────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setMentionOpen(false)
    try {
      if (editMsg) {
        const updated = { ...editMsg, content: text, isEdited: true }
        msgMap.current.set(updated.id, updated)
        setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
        setEditMsg(null)
        setInput('')
        const socket = getSocket(accessToken || undefined)
        socket.emit('edit_message', { groupId, messageId: editMsg.id, content: text })
      } else {
        sendSocketMessage(groupId, text, 'TEXT', replyTo?.id)
        setReplyTo(null)
        setInput('')
      }
      emitTypingStop(groupId)
    } catch (err) {
      console.error('[GroupChat] Send/Edit failed:', err)
    } finally {
      setSending(false)
    }
  }, [input, sending, editMsg, replyTo, groupId, accessToken])

  const handleDelete = useCallback(async (msg: ChatMessage) => {
    try {
      await chatApi.deleteMessage(groupId, msg.id)
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isDeleted: true } : m))
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }, [groupId])

  const handleEdit = useCallback((msg: ChatMessage) => {
    setEditMsg(msg)
    setReplyTo(null)
    setInput(msg.content || '')
  }, [])

  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyTo(msg)
    setEditMsg(null)
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen) {
      if (e.key === 'Escape') { setMentionOpen(false); setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { setReplyTo(null); setEditMsg(null); setInput('') }
  }

  const cancelAction = () => {
    setReplyTo(null)
    setEditMsg(null)
    setInput('')
  }

  return (
    <div className="flex flex-col h-[560px]">

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-warm/30">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <EmptyState icon="💬" title="No messages yet" description="Start the conversation!" />
            <button
              onClick={loadMessages}
              className="text-[11px] text-brand underline underline-offset-2 hover:opacity-70 transition-opacity"
            >
              Tap to reload messages
            </button>
          </div>
        )}

        {messages.map(msg => {
          const isMe       = msg.senderId === currentUserId
          const replyToMsg = msg.replyToId ? (msgMap.current.get(msg.replyToId) ?? null) : null
          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMe={isMe}
              isAdmin={isAdmin}
              replyTo={replyToMsg}
              scrollRef={scrollRef}
              members={members}
              currentUserId={currentUserId}
              onMentionClick={handleMentionClick}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              msgRef={el => {
                if (el) msgRefs.current.set(msg.id, el)
                else msgRefs.current.delete(msg.id)
              }}
            />
          )
        })}

        {/* Typing indicator */}
        <AnimatePresence>
          {typing && (
            <motion.div
              className="flex items-center gap-2 pl-2"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
            >
              <div className="bg-white border border-black/[0.07] rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-1.5 shadow-sm">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-mist rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <p className="text-[11px] text-mist">{typing} is typing…</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={endRef} />
      </div>

      {/* Reply / Edit banner */}
      <AnimatePresence>
        {(replyTo || editMsg) && (
          <motion.div
            className={`border-t px-4 py-2.5 flex items-center gap-3 ${
              editMsg ? 'bg-amber-50 border-amber-100' : 'bg-brand-pale border-brand/20'
            }`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className={`w-0.5 h-8 rounded-full flex-shrink-0 ${editMsg ? 'bg-amber-400' : 'bg-brand'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-bold mb-0.5 ${editMsg ? 'text-amber-600' : 'text-brand'}`}>
                {editMsg ? '✏️ Editing message' : `↩ Replying to ${(replyTo as any)?.sender?.firstName}`}
              </p>
              <p className="text-[11px] text-dim truncate">
                {editMsg ? editMsg.content : replyTo?.content}
              </p>
            </div>
            <button
              onClick={cancelAction}
              className="w-6 h-6 rounded-full bg-black/[0.08] flex items-center justify-center text-dim hover:bg-black/[0.15] transition-colors flex-shrink-0"
            >
              <CloseIcon />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="border-t border-black/[0.06] p-3 flex gap-2 bg-white relative">
        {/* @mention dropdown */}
        <AnimatePresence>
          {mentionOpen && mentionQuery !== null && (
            <MentionDropdown
              members={members}
              query={mentionQuery}
              onSelect={handleMentionSelect}
            />
          )}
        </AnimatePresence>

        <input
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={editMsg ? 'Edit your message…' : 'Type a message… use @ to mention'}
          className="flex-1 h-10 border border-black/[0.09] rounded-xl px-4 text-[13px] text-ink bg-white outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand/90 active:scale-95 transition-all flex-shrink-0"
        >
          {sending
            ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            : <SendIcon />
          }
        </button>
      </div>
    </div>
  )
}