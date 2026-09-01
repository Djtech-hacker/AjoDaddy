// ============================================================
// SOCKET CLIENT — Authenticated Socket.io singleton
// ============================================================

import { io, Socket } from 'socket.io-client'

let socket:       Socket | null = null
let currentToken: string | null = null  // ← track which token the socket was created with

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:4000'

export function getSocket(accessToken?: string): Socket {
  // If socket exists AND is connected AND token hasn't changed → reuse it
  if (socket?.connected && currentToken === (accessToken ?? null)) {
    return socket
  }

  // Token changed (re-login) or socket is stale → kill it and start fresh
  if (socket) {
    console.log('[WS] Token changed or socket stale — reconnecting')
    socket.disconnect()
    socket = null
    currentToken = null
  }

  currentToken = accessToken ?? null

  socket = io(`${WS_URL}/ws`, {
    withCredentials: true,
    transports:      ['websocket', 'polling'],
    auth:            { token: accessToken },
    autoConnect:     true,
    reconnection:    true,
    reconnectionDelay:    1000,
    reconnectionAttempts: 10,
  })

  socket.on('connect',       () => console.log('[WS] Connected:', socket?.id))
  socket.on('disconnect',    (r) => console.log('[WS] Disconnected:', r))
  socket.on('connect_error', (e) => console.warn('[WS] Connection error:', e.message))

  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket       = null
  currentToken = null
}

export function joinGroupRoom(groupId: string) {
  socket?.emit('join_group', { groupId })
}

export function leaveGroupRoom(groupId: string) {
  socket?.emit('leave_group', { groupId })
}

export function sendSocketMessage(
  groupId:    string,
  content:    string,
  type =      'TEXT',
  replyToId?: string,
) {
  socket?.emit('send_message', { groupId, content, type, replyToId })
}

export function emitTypingStart(groupId: string, username: string) {
  socket?.emit('typing_start', { groupId, username })
}

export function emitTypingStop(groupId: string) {
  socket?.emit('typing_stop', { groupId })
}