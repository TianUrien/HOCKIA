import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Screens that bring their own bottom bar (Profile v2 public action bar —
 * "fixed, never hides", Figma PR1) hide the tab bar while they're mounted.
 * A counter, so overlapping screens can't leave it hidden by mistake.
 */
interface NavChromeState {
  hideTabBar: number
  push: () => void
  pop: () => void
}

export const useNavChrome = create<NavChromeState>((set) => ({
  hideTabBar: 0,
  push: () => set((s) => ({ hideTabBar: s.hideTabBar + 1 })),
  pop: () => set((s) => ({ hideTabBar: Math.max(0, s.hideTabBar - 1) })),
}))

/** Hide the tab bar while `active` (and the calling screen) is mounted. */
export function useHideTabBar(active: boolean) {
  useEffect(() => {
    if (!active) return
    useNavChrome.getState().push()
    return () => useNavChrome.getState().pop()
  }, [active])
}
