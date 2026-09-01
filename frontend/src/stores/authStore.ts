// ============================================================
// AUTH STORE — Zustand with localStorage persistence
// ============================================================

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user:        User | null
  accessToken: string | null
  isLoading:   boolean

  setUser:        (user: User | null) => void
  setAccessToken: (token: string | null) => void
  setLoading:     (v: boolean) => void
  logout:         () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:        null,
      accessToken: null,
      isLoading:   false,

      setUser:        (user)  => set({ user }),
      setAccessToken: (token) => set({ accessToken: token }),
      setLoading:     (v)     => set({ isLoading: v }),
      logout: () => set({ user: null, accessToken: null }),
    }),
    {
      name:    'pp_auth',
      storage: createJSONStorage(() => localStorage), // FIX: was sessionStorage, token lost on refresh
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken }),
    },
  ),
)