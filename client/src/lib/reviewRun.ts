import { create } from 'zustand'

/**
 * Club speed CS7 · how many applicants this phone review run has moved past,
 * per role, for "N of M to review". Undo steps it back, so an undone decision
 * isn't counted as reviewed (found in the device lab 2026-10-18: Undo read
 * "2 of 3" instead of "1 of 2").
 */
interface ReviewRunState {
  runs: Record<string, number>
  reset: (roleId: string) => void
  step: (roleId: string, by: 1 | -1) => void
}

export const useReviewRun = create<ReviewRunState>((set) => ({
  runs: {},
  reset: (roleId) => set((s) => ({ runs: { ...s.runs, [roleId]: 0 } })),
  step: (roleId, by) => set((s) => ({ runs: { ...s.runs, [roleId]: Math.max(0, (s.runs[roleId] ?? 0) + by) } })),
}))
