import { create } from 'zustand'

interface UIState {
  sidebarOpen:       boolean
  notifPanelOpen:    boolean
  unreadCount:       number
  toast:             { message: string; type: 'success' | 'error' | 'warning' | 'info' } | null

  setSidebarOpen:    (v: boolean) => void
  setNotifPanel:     (v: boolean) => void
  setUnreadCount:    (n: number) => void
  showToast:         (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void
  clearToast:        () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen:    false,
  notifPanelOpen: false,
  unreadCount:    0,
  toast:          null,

  setSidebarOpen:  (v) => set({ sidebarOpen: v }),
  setNotifPanel:   (v) => set({ notifPanelOpen: v }),
  setUnreadCount:  (n) => set({ unreadCount: n }),
  showToast:       (message, type = 'success') => {
    set({ toast: { message, type } })
    setTimeout(() => set({ toast: null }), 3500)
  },
  clearToast:      () => set({ toast: null }),
}))
