import { describe, expect, it } from 'vitest'
import { useReviewRun } from '@/lib/reviewRun'

describe('Club speed CS7 · review run counter', () => {
  it('moves on, steps back on Undo, never below 0, and resets per role', () => {
    const s = useReviewRun.getState()
    s.reset('r1')
    s.step('r1', 1)
    s.step('r1', 1)
    expect(useReviewRun.getState().runs.r1).toBe(2)
    s.step('r1', -1)
    expect(useReviewRun.getState().runs.r1).toBe(1)
    s.step('r1', -1); s.step('r1', -1)
    expect(useReviewRun.getState().runs.r1).toBe(0)
    s.step('r2', 1)
    s.reset('r1')
    expect(useReviewRun.getState().runs).toMatchObject({ r1: 0, r2: 1 })
  })
})

describe('push card stays off screens with their own action bar', () => {
  it('hides on the applicant review and Post an opportunity, not on the lists', async () => {
    const { onActionBarScreen } = await import('@/lib/overlaySequence')
    expect(onActionBarScreen('/dashboard/opportunities/r1/applicants/a1')).toBe(true)
    expect(onActionBarScreen('/dashboard/opportunities/new')).toBe(true)
    expect(onActionBarScreen('/dashboard/opportunities/r1/edit')).toBe(true)
    expect(onActionBarScreen('/dashboard/opportunities/r1/applicants')).toBe(false)
    expect(onActionBarScreen('/opportunities')).toBe(false)
    expect(onActionBarScreen('/home')).toBe(false)
  })
})
