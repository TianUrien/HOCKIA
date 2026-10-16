import { create } from 'zustand'

export type HockiaAiDetent = 'medium' | 'large'

/** Where the sheet was opened from: the line under the title and later the context chip. */
export type HockiaAiEntry = 'opportunities'

interface HockiaAiSheetState {
  open: boolean
  detent: HockiaAiDetent
  entry: HockiaAiEntry
  show: (entry?: HockiaAiEntry) => void
  setDetent: (d: HockiaAiDetent) => void
  close: () => void
}

/** The Hockia AI sheet (handoff 2026-10-16): one sheet over the current screen, never a tab. */
export const useHockiaAiSheet = create<HockiaAiSheetState>((set) => ({
  open: false,
  detent: 'medium',
  entry: 'opportunities',
  show: (entry = 'opportunities') => set({ open: true, detent: 'medium', entry }),
  setDetent: (detent) => set({ detent }),
  close: () => set({ open: false }),
}))
