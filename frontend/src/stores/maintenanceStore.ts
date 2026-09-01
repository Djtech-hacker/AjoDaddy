import { create } from 'zustand'

interface MaintenanceState {
  isMaintenanceMode: boolean
  message: string
  scheduledAt: string | null
  announcement: string | null
  setMaintenanceMode: (on: boolean, message?: string) => void
  setScheduledMaintenance: (scheduledAt: string | null, announcement?: string | null) => void
}

export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  isMaintenanceMode: false,
  message: '',
  scheduledAt: null,
  announcement: null,
  setMaintenanceMode: (on, message) =>
    set({ isMaintenanceMode: on, message: message || '' }),
  setScheduledMaintenance: (scheduledAt, announcement) =>
    set({ scheduledAt, announcement: announcement ?? null }),
}))