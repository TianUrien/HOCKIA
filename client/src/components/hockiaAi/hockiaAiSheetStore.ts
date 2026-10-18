import { create } from 'zustand'

export type HockiaAiDetent = 'medium' | 'large'

/** Where the sheet was opened from: the line under the title and later the context chip. */
export type HockiaAiEntry = 'opportunities' | 'profile'

/** 'builder' = "Fill my profile for me" (handoff P0–P3): its own conversation inside the same sheet. */
export type HockiaAiMode = 'chat' | 'builder' | 'apply'

/** The role "Prepare my application" is for (handoff A4): what the draft card shows before the role loads. */
export interface ApplyTarget { id: string; title: string; organization: string | null; logoUrl: string | null }

interface HockiaAiSheetState {
  open: boolean
  detent: HockiaAiDetent
  entry: HockiaAiEntry
  mode: HockiaAiMode
  applyTarget: ApplyTarget | null
  show: (entry?: HockiaAiEntry, mode?: HockiaAiMode) => void
  setMode: (mode: HockiaAiMode) => void
  /** "Prepare my application" for a role: the apply conversation, large. */
  prepareApplication: (target: ApplyTarget) => void
  setDetent: (d: HockiaAiDetent) => void
  close: () => void
}

/** The Hockia AI sheet (handoff 2026-10-16): one sheet over the current screen, never a tab. */
export const useHockiaAiSheet = create<HockiaAiSheetState>((set) => ({
  open: false,
  detent: 'medium',
  entry: 'opportunities',
  mode: 'chat',
  applyTarget: null,
  // The builder needs room for the review card: it always opens large.
  show: (entry = 'opportunities', mode = 'chat') => set({ open: true, detent: mode === 'chat' ? 'medium' : 'large', entry, mode }),
  setMode: (mode) => set((s) => ({ mode, detent: mode === 'chat' ? s.detent : 'large' })),
  prepareApplication: (target) => set({ open: true, mode: 'apply', applyTarget: target, detent: 'large' }),
  setDetent: (detent) => set({ detent }),
  close: () => set({ open: false }),
}))
