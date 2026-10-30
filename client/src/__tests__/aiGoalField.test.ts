import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { goalField } from '@/hooks/useDiscover'

describe('goalField (release audit 2026-10-30)', () => {
  it('lets the server read the goal only while the goal chip shows', () => {
    expect(goalField(true)).toEqual({})
  })

  it('tells the server to skip the goal for every other chat', () => {
    expect(goalField(false)).toEqual({ use_goal: false })
  })
})
