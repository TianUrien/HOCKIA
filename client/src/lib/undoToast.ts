import { create } from 'zustand'

/**
 * "<Name> shortlisted · Undo" for 5 s after a decision (Figma 04 Club ·
 * Applicant review DEV NOTE). Shared state so the toast set on the review
 * screen shows on Applicants after the navigation back.
 */
interface UndoToastState {
  /** applicationIds: a bulk decision (Club speed CS4/CS5) — Undo drops every held one. */
  toast: { applicationId: string; applicationIds?: string[]; text: string; onUndo: (undoneIds: string[]) => void; at: number } | null
  show: (t: { applicationId: string; applicationIds?: string[]; text: string; onUndo: (undoneIds: string[]) => void }) => void
  hide: () => void
}

export const useUndoToast = create<UndoToastState>((set) => ({
  toast: null,
  show: (t) => set({ toast: { ...t, at: Date.now() } }),
  hide: () => set({ toast: null }),
}))

