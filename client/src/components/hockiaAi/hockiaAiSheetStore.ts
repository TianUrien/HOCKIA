import { create } from 'zustand'

export type HockiaAiDetent = 'medium' | 'large'

/** Where the sheet was opened from: the line under the title and later the context chip. */
export type HockiaAiEntry = 'opportunities' | 'profile' | 'role' | 'header' | 'home' | 'search' | 'link'

/** Text the sheet opens with (one-sheet handoff 2026-10-22): sent at once when
 *  the member already asked it (Search, the Home bar), otherwise left in the
 *  composer (an old /discover?q= link). */
export interface HockiaAiSeed { text: string; send: boolean }

/** 'builder' = "Fill my profile for me" (handoff P0–P3): its own conversation inside the same sheet.
 *  'history' = the saved chats (handoff C2). 'steps' = a next step done with
 *  the member: photo, bio, links (2026-10-18). */
export type HockiaAiMode = 'chat' | 'builder' | 'apply' | 'history' | 'steps'
export type HockiaAiStep = 'photo' | 'bio' | 'video' | 'career' | 'links' | 'position' | 'passport'

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
  step: HockiaAiStep | null
  seed: HockiaAiSeed | null
  /** What Opportunities shows ("N open opportunities") for the context chip; null while unknown. */
  openOpportunities: number | null
  setOpenOpportunities: (n: number | null) => void
  /** The sheet takes the seed once it has used it. */
  takeSeed: () => HockiaAiSeed | null
  /** Do a next step: photo, bio and links here; clubs, position and passports in Fill my profile. */
  startStep: (step: HockiaAiStep) => void
  show: (entry?: HockiaAiEntry, mode?: HockiaAiMode, seed?: HockiaAiSeed | null) => void
  setMode: (mode: HockiaAiMode) => void
  /** "Prepare my application" for a role: the apply conversation, large. */
  prepareApplication: (target: ApplyTarget) => void
  /** "Ask Hockia AI about this role": the sheet opens medium with the role attached. */
  askAboutRole: (ctx: RoleContext) => void
  clearRole: () => void
  setDetent: (d: HockiaAiDetent) => void
  close: () => void
}

/** The Hockia AI sheet (handoff 2026-10-16): one sheet over the current screen, never a tab.
 *  Since 2026-10-22 it is the only Hockia AI surface, mounted once for the app. */
export const useHockiaAiSheet = create<HockiaAiSheetState>((set, get) => ({
  open: false,
  detent: 'medium',
  entry: 'opportunities',
  mode: 'chat',
  applyTarget: null,
  roleContext: null,
  step: null,
  seed: null,
  openOpportunities: null,
  setOpenOpportunities: (openOpportunities) => set({ openOpportunities }),
  takeSeed: () => { const seed = get().seed; if (seed) set({ seed: null }); return seed },
  startStep: (step) => set({ open: true, detent: 'large', step, mode: ['photo', 'bio', 'links', 'video'].includes(step) ? 'steps' : 'builder' }),
  // The builder needs room for the review card: it always opens large.
  show: (entry = 'opportunities', mode = 'chat', seed = null) => set({ open: true, detent: mode === 'chat' && !seed?.send ? 'medium' : 'large', entry, mode, roleContext: null, seed: seed?.text.trim() ? seed : null }),
  setMode: (mode) => set((s) => ({ mode, detent: mode === 'chat' ? s.detent : 'large' })),
  prepareApplication: (target) => set({ open: true, mode: 'apply', applyTarget: target, detent: 'large' }),
  askAboutRole: (ctx) => set({ open: true, mode: 'chat', entry: 'role', roleContext: ctx, detent: 'medium' }),
  clearRole: () => set({ roleContext: null }),
  setDetent: (detent) => set({ detent }),
  close: () => set({ open: false }),
}))
