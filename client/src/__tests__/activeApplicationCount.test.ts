import { describe, expect, it, vi } from 'vitest'
import { isActiveApplication } from '@/hooks/useMyApplicationsAll'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

// The Opportunities "Applied" tab opens My applications on Active, so its
// count uses the same rule (iOS audit 2026-11-06: "Applied · 31" vs "Active · 1").
describe('isActiveApplication', () => {
  it('counts an application still on the road for an open role', () => {
    expect(isActiveApplication('pending', true)).toBe(true)
    expect(isActiveApplication('shortlisted', true)).toBe(true)
    expect(isActiveApplication('signed_pending_confirmation', true)).toBe(true)
  })
  it('never counts an outcome or a closed role', () => {
    expect(isActiveApplication('rejected', true)).toBe(false)
    expect(isActiveApplication('signed', true)).toBe(false)
    expect(isActiveApplication('pending', false)).toBe(false)
    expect(isActiveApplication(null, true)).toBe(false)
  })
})
