import { create } from 'zustand'
import type { ToastType } from '../components/Toast'

interface ToastMessage {
  id: string
  message: string
  type: ToastType
}

interface ToastStore {
  toasts: ToastMessage[]
  addToast: (message: string, type: ToastType) => void
  removeToast: (id: string) => void
  /** Drop every toast on screen (a sheet opening over them). */
  clearToasts: () => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }))
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }))
  },
  clearToasts: () => set({ toasts: [] }),
}))
