import { create } from 'zustand'

export type HockiaAiDetent = 'medium' | 'large'

/** Where the sheet was opened from: the line under the title and later the context chip. */
export type HockiaAiEntry = 'opportunities' | 'profile' | 'role'

/** 'builder' = "Fill my profile for me" (handoff P0–P3): its own conversation inside the same sheet.
 *  'history' = the saved chats (handoff C2). */
export type HockiaAiMode = 'chat' | 'builder' | 'apply' | 'history'

/** The role "Prepare my application" is for (handoff A4): what the draft card shows before the role loads. */
export interface ApplyTarget { id: string; title: string; organization: string | null; logoUrl: string | null }

/** The role the sheet was opened on (handoff B3/B4): questions go to nl-search's role_ask mode. */
export interface RoleContext extends ApplyTarget { city: string | null; label: string }

interface HockiaAiSheetState {
  open: boolean
  detent: HockiaAiDetent
  entry: HockiaAiEntry
  mode: HockiaAiMode
  applyTarget: ApplyTarget | null
  roleContext: RoleContext | null
  show: (entry?: HockiaAiEntry, mode?: HockiaAiMode) => void
  setMode: (mode: HockiaAiMode) => void
  /** "Prepare my application" for a role: the apply conversation, large. */
  prepareApplication: (target: ApplyTarget) => void
  /** "Ask Hockia AI about this role": the sheet opens medium with the role attached. */
  askAboutRole: (ctx: RoleContext) => void
  clearRole: () => void
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
  roleContext: null,
  // The builder needs room for the review card: it always opens large.
  show: (entry = 'opportunities', mode = 'chat') => set({ open: true, detent: mode === 'chat' ? 'medium' : 'large', entry, mode, roleContext: null }),
  setMode: (mode) => set((s) => ({ mode, detent: mode === 'chat' ? s.detent : 'large' })),
  prepareApplication: (target) => set({ open: true, mode: 'apply', applyTarget: target, detent: 'large' }),
  askAboutRole: (ctx) => set({ open: true, mode: 'chat', entry: 'role', roleContext: ctx, detent: 'medium' }),
  clearRole: () => set({ roleContext: null }),
  setDetent: (detent) => set({ detent }),
  close: () => set({ open: false }),
}))
