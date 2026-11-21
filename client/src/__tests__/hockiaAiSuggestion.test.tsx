import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * The dot on the Hockia AI button (founder ruling 2026-11-21): lit only for
 * something real and new for this member, out once they open Hockia AI, and
 * never lit twice by the same fact.
 */
const h = vi.hoisted(() => ({
  applications: { rows: [] as { applied_at: string }[], count: 0 },
  opportunities: [] as { published_at: string; club: { is_test_account: boolean } }[],
  since: null as string | null,
  fail: false,
  events: [] as { name: string; props?: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'order', 'limit']) q[m] = () => q
    q.gt = (_col: string, value: string) => { h.since = value; return q }
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (h.fail) return Promise.reject(new Error('offline')).then(resolve, reject)
      const result = table === 'opportunity_applications'
        ? { data: h.applications.rows, count: h.applications.count, error: null }
        : { data: h.opportunities.filter((o) => !h.since || o.published_at > h.since), error: null }
      return Promise.resolve(result).then(resolve)
    }
    return q
  }
  return { supabase: { from: (table: string) => chain(table) } }
})
vi.mock('@/lib/trackDbEvent', () => ({
  trackDbEvent: (name: string, _t?: string, _id?: string, props?: Record<string, unknown>) => { h.events.push({ name, props }) },
}))

import { firstUnseen, loadSuggestions, profileStepFor, readSeen, type AiSuggestion } from '@/lib/hockiaAiSuggestion'
import { useHockiaAiSuggestion } from '@/components/hockiaAi/hockiaAiSuggestionStore'
import { HockiaAiButton } from '@/components/hockiaAi/HockiaAiButton'

const NOW = new Date('2026-11-21T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const club = { id: 'club-1', role: 'club', avatar_url: 'x', bio: 'x' }
const player = { id: 'player-1', role: 'player', avatar_url: 'photo.jpg', bio: 'A real bio.' }

beforeEach(() => {
  h.applications = { rows: [], count: 0 }; h.opportunities = []; h.since = null; h.fail = false; h.events = []
  window.localStorage.clear()
  useHockiaAiSuggestion.setState({ userId: null, fresh: null, shown: null, loadedAt: 0 })
})

describe('what Hockia AI can suggest', () => {
  it('a recruiter with applicants waiting: the newest one is the signature', async () => {
    h.applications = { rows: [{ applied_at: day(1) }], count: 4 }
    expect(await loadSuggestions(club, {}, NOW)).toEqual([{ kind: 'applicants_waiting', count: 4, signature: day(1) }])
  })

  it('a recruiter with nobody waiting gets nothing', async () => {
    expect(await loadSuggestions(club, {}, NOW)).toEqual([])
  })

  it('a player without a photo, then without a bio; a complete profile gets neither', () => {
    expect(profileStepFor({ ...player, avatar_url: null })).toMatchObject({ kind: 'profile_step', step: 'photo' })
    expect(profileStepFor({ ...player, bio: '  ' })).toMatchObject({ kind: 'profile_step', step: 'bio' })
    expect(profileStepFor(player)).toBeNull()
    expect(profileStepFor({ ...club, avatar_url: null })).toBeNull()
  })

  it('opportunities published in the last week, test clubs left out', async () => {
    h.opportunities = [
      { published_at: day(1), club: { is_test_account: false } },
      { published_at: day(2), club: { is_test_account: true } },
      { published_at: day(3), club: { is_test_account: false } },
      { published_at: day(30), club: { is_test_account: false } },
    ]
    expect(await loadSuggestions(player, {}, NOW)).toEqual([{ kind: 'new_opportunities', count: 2, signature: day(1) }])
  })

  it('only opportunities newer than the ones already seen count as new', async () => {
    h.opportunities = [{ published_at: day(1), club: { is_test_account: false } }, { published_at: day(3), club: { is_test_account: false } }]
    expect(await loadSuggestions(player, { new_opportunities: day(2) }, NOW)).toEqual([{ kind: 'new_opportunities', count: 1, signature: day(1) }])
    expect(await loadSuggestions(player, { new_opportunities: day(1) }, NOW)).toEqual([])
  })

  it('a failed read means no suggestion, never a guess', async () => {
    h.fail = true
    expect(await loadSuggestions(club, {}, NOW)).toEqual([])
  })

  it('the same fact never counts twice; a different one does', () => {
    const photo: AiSuggestion = { kind: 'profile_step', step: 'photo', signature: 'photo' }
    const roles: AiSuggestion = { kind: 'new_opportunities', count: 2, signature: day(1) }
    expect(firstUnseen([photo, roles], {})).toBe(photo)
    expect(firstUnseen([photo, roles], { profile_step: 'photo' })).toBe(roles)
    expect(firstUnseen([photo, roles], { profile_step: 'photo', new_opportunities: day(1) })).toBeNull()
  })
})

describe('the dot', () => {
  it('lights for a new suggestion, goes out when Hockia AI opens, and stays out for the same fact', async () => {
    h.applications = { rows: [{ applied_at: '2026-11-20T10:00:00.000Z' }], count: 2 }
    render(<HockiaAiButton onClick={() => {}} />)
    expect(screen.queryByTestId('hockia-ai-dot')).not.toBeInTheDocument()

    await useHockiaAiSuggestion.getState().refresh(club, true)
    expect(await screen.findByTestId('hockia-ai-dot')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAccessibleName('Hockia AI, something new for you')
    expect(h.events).toEqual([{ name: 'hockia_ai_suggestion_shown', props: { kind: 'applicants_waiting' } }])

    useHockiaAiSuggestion.getState().markOpened()
    expect(useHockiaAiSuggestion.getState().shown).toMatchObject({ kind: 'applicants_waiting', count: 2 })
    expect(readSeen('club-1')).toEqual({ applicants_waiting: '2026-11-20T10:00:00.000Z' })
    await vi.waitFor(() => expect(screen.queryByTestId('hockia-ai-dot')).not.toBeInTheDocument())

    await useHockiaAiSuggestion.getState().refresh(club, true)
    expect(useHockiaAiSuggestion.getState().fresh).toBeNull()

    // A new applicant is news again.
    h.applications = { rows: [{ applied_at: '2026-11-21T09:00:00.000Z' }], count: 3 }
    await useHockiaAiSuggestion.getState().refresh(club, true)
    expect(useHockiaAiSuggestion.getState().fresh).toMatchObject({ count: 3 })
    expect(h.events.filter((e) => e.name === 'hockia_ai_suggestion_shown')).toHaveLength(2)
  })

  it('is per member: signing out clears it, and another member starts clean', async () => {
    h.applications = { rows: [{ applied_at: '2026-11-20T10:00:00.000Z' }], count: 1 }
    await useHockiaAiSuggestion.getState().refresh(club, true)
    expect(useHockiaAiSuggestion.getState().fresh).not.toBeNull()
    await useHockiaAiSuggestion.getState().refresh(null)
    expect(useHockiaAiSuggestion.getState()).toMatchObject({ fresh: null, shown: null, userId: null })
  })

  it('does not ask the server again within ten minutes unless forced', async () => {
    h.applications = { rows: [{ applied_at: '2026-11-20T10:00:00.000Z' }], count: 1 }
    await useHockiaAiSuggestion.getState().refresh(club, true)
    h.applications = { rows: [], count: 0 }
    await useHockiaAiSuggestion.getState().refresh(club)
    expect(useHockiaAiSuggestion.getState().fresh).not.toBeNull()
  })
})
