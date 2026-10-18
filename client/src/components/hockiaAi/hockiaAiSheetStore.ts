import { create } from 'zustand'

export type HockiaAiDetent = 'medium' | 'large'

/** Where the sheet was opened from: the line under the title and later the context chip. */
export type HockiaAiEntry = 'opportunities' | 'profile'

/** 'builder' = "Fill my profile for me" (handoff P0–P3): its own conversation inside the same sheet. */
export type HockiaAiMode = 'chat' | 'builder'

interface HockiaAiSheetState {
  open: boolean
  detent: HockiaAiDetent
  entry: HockiaAiEntry
  mode: HockiaAiMode
  show: (entry?: HockiaAiEntry, mode?: HockiaAiMode) => void
  setMode: (mode: HockiaAiMode) => void
  setDetent: (d: HockiaAiDetent) => void
  close: () => void
}

/** The Hockia AI sheet (handoff 2026-10-16): one sheet over the current screen, never a tab. */
export const useHockiaAiSheet = create<HockiaAiSheetState>((set) => ({
  open: false,
  detent: 'medium',
  entry: 'opportunities',
  mode: 'chat',
  // The builder needs room for the review card: it always opens large.
  show: (entry = 'opportunities', mode = 'chat') => set({ open: true, detent: mode === 'builder' ? 'large' : 'medium', entry, mode }),
  setMode: (mode) => set((s) => ({ mode, detent: mode === 'builder' ? 'large' : s.detent })),
  setDetent: (detent) => set({ detent }),
  close: () => set({ open: false }),
}))
