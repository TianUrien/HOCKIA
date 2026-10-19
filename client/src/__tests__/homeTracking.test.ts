import { describe, it, expect, vi } from 'vitest'

// homeInstrumentation imports @/lib/supabase, which throws at import time
// without the Vite env vars (CI has none). Only pure helpers run here.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { normalizeDestination, scrollMilestonesCrossed, nextStepKind } from '@/lib/homeInstrumentation'
import { withSource, readNavSource, navState } from '@/lib/navSource'

/**
 * Home tracking gaps 1–8 (research 2026-10-19): the pure parts. Destinations
 * never carry ids, scroll milestones fire once each and in order, and the
 * source of a role view survives both carriers (router state, ?src=).
 */
describe('normalizeDestination', () => {
  it('replaces uuids with :id and drops query strings', () => {
    expect(normalizeDestination('/opportunities/9e2d5248-5ccf-42c6-a504-e9160fff8c3a')).toBe('/opportunities/:id')
    expect(normalizeDestination('/dashboard/opportunities/9E2D5248-5CCF-42C6-A504-E9160FFF8C3A/applicants')).toBe('/dashboard/opportunities/:id/applicants')
    expect(normalizeDestination('/pulse?viewers=1')).toBe('/pulse')
    expect(normalizeDestination('member_deck')).toBe('member_deck')
  })
})

describe('nextStepKind', () => {
  it('keeps the step family, never the id', () => {
    expect(nextStepKind('quiet:9e2d5248-5ccf-42c6-a504-e9160fff8c3a')).toBe('quiet')
    expect(nextStepKind('photo')).toBe('photo')
  })
})

describe('scrollMilestonesCrossed', () => {
  it('fires each milestone once, in order, against the loaded count', () => {
    const fired = new Set<number>()
    expect(scrollMilestonesCrossed(0, 20, fired)).toEqual([])          // 5 %
    expect(scrollMilestonesCrossed(4, 20, fired)).toEqual([25])        // 25 %
    fired.add(25)
    expect(scrollMilestonesCrossed(4, 20, fired)).toEqual([])          // already fired
    expect(scrollMilestonesCrossed(15, 20, fired)).toEqual([50, 75])   // jumped: both
    fired.add(50); fired.add(75)
    expect(scrollMilestonesCrossed(19, 20, fired)).toEqual([100])
  })
  it('handles empty and out-of-range input', () => {
    expect(scrollMilestonesCrossed(3, 0, new Set())).toEqual([])
    expect(scrollMilestonesCrossed(-1, 10, new Set())).toEqual([])
    expect(scrollMilestonesCrossed(50, 10, new Set())).toEqual([25, 50, 75, 100])
  })
})

describe('navSource', () => {
  it('reads router state first, then ?src=, else direct', () => {
    expect(readNavSource({ state: { source: 'home_role_card' }, search: '?src=push' })).toBe('home_role_card')
    expect(readNavSource({ state: null, search: '?src=push' })).toBe('push')
    expect(readNavSource({ state: { from: '/x' }, search: '' })).toBe('direct')
    expect(readNavSource({ state: { source: 'Bad Value!' }, search: '?src=<script>' })).toBe('direct')
  })
  it('appends ?src= keeping query and hash', () => {
    expect(withSource('/opportunities/abc', 'push')).toBe('/opportunities/abc?src=push')
    expect(withSource('/opportunities/abc?x=1#top', 'push')).toBe('/opportunities/abc?x=1&src=push#top')
    expect(withSource('/messages/c1', 'not valid')).toBe('/messages/c1')
    expect(navState('inbox')).toEqual({ state: { source: 'inbox' } })
  })
})
