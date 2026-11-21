import { create } from 'zustand'
import { firstUnseen, loadSuggestions, readSeen, writeSeen, type AiSuggestion, type SuggestionViewer } from '@/lib/hockiaAiSuggestion'
import { trackDbEvent } from '@/lib/trackDbEvent'

/** How long a read stays good: the dot is checked on app start and when the member comes back. */
const STALE_MS = 10 * 60_000

interface State {
  userId: string | null
  /** The suggestion the dot is lit for: real, and not seen yet. */
  fresh: AiSuggestion | null
  /** What the open sheet shows: the suggestion that was fresh when it opened. */
  shown: AiSuggestion | null
  loadedAt: number
  refresh: (viewer: SuggestionViewer | null, force?: boolean) => Promise<void>
  /** Hockia AI opened: show the suggestion there and put the dot out. */
  markOpened: () => void
  clearShown: () => void
}

const reported = new Set<string>()

/** One store for every Hockia AI button, so they all light and go out together. */
export const useHockiaAiSuggestion = create<State>((set, get) => ({
  userId: null,
  fresh: null,
  shown: null,
  loadedAt: 0,
  refresh: async (viewer, force = false) => {
    if (!viewer) { set({ userId: null, fresh: null, shown: null, loadedAt: 0 }); return }
    const same = get().userId === viewer.id
    if (same && !force && Date.now() - get().loadedAt < STALE_MS) return
    set({ userId: viewer.id, loadedAt: Date.now(), ...(same ? {} : { fresh: null, shown: null }) })
    const seen = readSeen(viewer.id)
    const fresh = firstUnseen(await loadSuggestions(viewer, seen), seen)
    // The member may have signed out or switched account while this was loading.
    if (get().userId !== viewer.id) return
    set({ fresh })
    if (fresh && !reported.has(`${viewer.id}:${fresh.kind}:${fresh.signature}`)) {
      reported.add(`${viewer.id}:${fresh.kind}:${fresh.signature}`)
      trackDbEvent('hockia_ai_suggestion_shown', undefined, undefined, { kind: fresh.kind })
    }
  },
  markOpened: () => {
    const { fresh, userId } = get()
    if (!fresh || !userId) return
    writeSeen(userId, { ...readSeen(userId), [fresh.kind]: fresh.signature })
    set({ fresh: null, shown: fresh })
  },
  clearShown: () => set({ shown: null }),
}))
