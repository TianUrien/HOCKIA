import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Profile, Vacancy } from '@/lib/supabase'

/**
 * Staging audit round 3: closed roles open for signed-in members, "Message
 * the club" on a closed role for applicants, the club's note on the desktop
 * timeline without the AI sparkle, and uploaded videos ticking the desktop
 * checklist.
 */

// Per-table results. Every builder method chains; `maybeSingle` and awaiting
// the chain itself resolve to the table's result.
const tables: Record<string, unknown> = {}
const invoke = vi.fn()
let playerVideos: { id: string; title: string; kind: 'highlight' | 'full_match' | 'reel'; visibility: string | null; durationSeconds: number | null }[] = []
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => Promise.resolve({ data: tables[table] ?? null, count: 0, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq']) chain[m] = () => chain
    chain.maybeSingle = result
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej)
    return chain
  }
  return { supabase: { from: (t: string) => builder(t), functions: { invoke: (...a: unknown[]) => invoke(...a) } } }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { profile: { id: 'player-1', role: 'player' }, user: { id: 'player-1' } }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => undefined }))
vi.mock('@/hooks/useProfileVideos', () => ({
  useProfileVideos: () => ({ videos: playerVideos, links: [], loading: false, reload: () => {} }),
}))
vi.mock('@/components/index', () => ({
  Avatar: () => <div data-testid="avatar" />,
  StorageImage: () => <div data-testid="storage-image" />,
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { OpportunityDetailMobile } from '@/components/opportunities/OpportunityDetailMobile'
import OpportunityDetailView from '@/components/OpportunityDetailView'
import ApplicationTimeline from '@/components/ApplicationTimeline'
import RecruitmentVisibilityWidget from '@/components/dashboard/bento/RecruitmentVisibilityWidget'
import { playerVideoChecklist } from '@/lib/playerVideoChecklist'

const vacancy = {
  id: 'opp-1',
  club_id: 'club-1',
  title: '[QA] Midfielder test',
  opportunity_type: 'player',
  position: 'midfielder',
  gender: 'Women',
  status: 'closed',
  priority: 'medium',
  location_city: 'Amsterdam',
  location_country: 'Netherlands',
  created_at: '2026-09-01T00:00:00Z',
  application_deadline: null,
  start_date: null,
  duration_text: null,
  benefits: [],
  custom_benefits: [],
  specialist_skills_wanted: [],
  requirements: [],
  description: null,
  compensation: null,
  eu_passport_required: false,
} as unknown as Vacancy

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  invoke.mockReset()
  playerVideos = []
})

describe('closed roles readable by signed-in members (migration)', () => {
  const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20260928260000_closed_roles_readable.sql'), 'utf-8')
  it('adds one SELECT policy for authenticated on closed rows only — never drafts', () => {
    expect(sql).toMatch(/CREATE POLICY "Members can view closed opportunities"[\s\S]*FOR SELECT[\s\S]*TO authenticated/)
    expect(sql).toMatch(/status = 'closed'::public\.opportunity_status/)
    expect(sql).not.toMatch(/'draft'/)
    expect(sql).not.toMatch(/TO anon|TO public/i)
  })
  it('grants the helper explicitly (authenticated yes, anon no)', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.member_can_view_closed_opportunity\(uuid\) TO authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.member_can_view_closed_opportunity\(uuid\) FROM anon/)
  })
})

const renderPhone = (props: { hasApplied: boolean; applicationStatus: string | null }, onMessage = vi.fn()) => {
  render(
    <MemoryRouter>
      <OpportunityDetailMobile
        vacancy={vacancy}
        clubName="QA Club"
        clubLogo={null}
        clubId="club-1"
        publisherRole="club"
        countryFlag={null}
        league={null}
        canApply={false}
        isPublisher={false}
        isClosed
        onApply={() => {}}
        onMessage={onMessage}
        {...props}
      />
    </MemoryRouter>,
  )
  return onMessage
}

describe('phone closed role: Message the club', () => {
  it('applicant gets a Message button (no Apply) that opens the message flow', () => {
    const onMessage = renderPhone({ hasApplied: true, applicationStatus: 'filled' })
    const btn = screen.getByRole('button', { name: /Message the club/ })
    expect(screen.getByTestId('closed-message-bar')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    fireEvent.click(btn)
    expect(onMessage).toHaveBeenCalledTimes(1)
  })
  it('non-applicant gets no Message button', () => {
    renderPhone({ hasApplied: false, applicationStatus: null })
    expect(screen.queryByTestId('closed-message-bar')).toBeNull()
    expect(screen.queryByRole('button', { name: /Message/ })).toBeNull()
    expect(screen.getByTestId('role-closed-notice')).toBeTruthy()
  })
})

const renderDesktop = (hasApplied: boolean, onMessage = vi.fn()) => {
  render(
    <MemoryRouter>
      <OpportunityDetailView
        vacancy={vacancy}
        clubName="QA Club"
        clubId="club-1"
        publisherRole="club"
        onClose={() => {}}
        hasApplied={hasApplied}
        applicationStatus={hasApplied ? 'filled' : null}
        isClosed
        onMessage={onMessage}
      />
    </MemoryRouter>,
  )
  return onMessage
}

describe('desktop closed role: Message the club', () => {
  it('applicant sees Message the club inside the closed box', () => {
    const onMessage = renderDesktop(true)
    const box = screen.getByTestId('own-application')
    expect(box.textContent).toContain('This role is closed')
    const btn = screen.getByTestId('closed-message-club')
    expect(box.contains(btn)).toBe(true)
    fireEvent.click(btn)
    expect(onMessage).toHaveBeenCalledTimes(1)
  })
  it('non-applicant has no Message button', () => {
    renderDesktop(false)
    expect(screen.getByTestId('role-closed-notice')).toBeTruthy()
    expect(screen.queryByTestId('closed-message-club')).toBeNull()
  })
})

describe('desktop timeline: whose words the note is', () => {
  const history = [{ id: 'h1', new_status: 'rejected', reason: null, created_at: '2026-09-10T00:00:00Z' }]

  it("a note the club wrote reads as the club's note — no AI sparkle, no AI call", async () => {
    tables.opportunity_applications = {
      id: 'app-1', status: 'rejected', applied_at: '2026-09-03T00:00:00Z',
      ai_feedback: { source: 'club', status: 'rejected', message: 'We went another way. Good luck!' },
    }
    tables.application_status_history = history
    tables.application_views = []
    render(<ApplicationTimeline opportunityId="opp-1" />)
    const note = await screen.findByTestId('timeline-club-note')
    expect(note.textContent).toContain('The club’s note')
    expect(note.textContent).toContain('We went another way. Good luck!')
    expect(screen.queryByTestId('timeline-ai-sparkle')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('an AI explanation keeps the sparkle', async () => {
    tables.opportunity_applications = { id: 'app-1', status: 'rejected', applied_at: '2026-09-03T00:00:00Z', ai_feedback: null }
    tables.application_status_history = history
    tables.application_views = []
    invoke.mockResolvedValue({ data: { message: 'A kind AI explanation.' }, error: null })
    render(<ApplicationTimeline opportunityId="opp-1" />)
    await waitFor(() => expect(screen.getByTestId('timeline-message').textContent).toContain('A kind AI explanation.'))
    expect(screen.getByTestId('timeline-ai-sparkle')).toBeTruthy()
    expect(screen.queryByTestId('timeline-club-note')).toBeNull()
  })

  it('fixed copy (role filled) has no sparkle', async () => {
    tables.opportunity_applications = { id: 'app-1', status: 'filled', applied_at: '2026-09-03T00:00:00Z', ai_feedback: null }
    tables.application_status_history = [{ ...history[0], new_status: 'filled' }]
    tables.application_views = []
    render(<ApplicationTimeline opportunityId="opp-1" />)
    await screen.findByTestId('timeline-message')
    expect(screen.queryByTestId('timeline-ai-sparkle')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('desktop checklist counts uploaded videos', () => {
  it('playerVideoChecklist: legacy link OR uploaded highlight; linked OR uploaded full match', () => {
    expect(playerVideoChecklist({ highlight_video_url: null, full_game_video_count: 0 }, [])).toEqual({ hasHighlight: false, hasFullMatch: false })
    expect(playerVideoChecklist({ highlight_video_url: ' https://youtu.be/x ' }, [])).toEqual({ hasHighlight: true, hasFullMatch: false })
    expect(playerVideoChecklist({ highlight_video_url: null }, [{ kind: 'highlight' }])).toEqual({ hasHighlight: true, hasFullMatch: false })
    expect(playerVideoChecklist({ full_game_video_count: 0 }, [{ kind: 'full_match' }])).toEqual({ hasHighlight: false, hasFullMatch: true })
    expect(playerVideoChecklist({ full_game_video_count: 2 }, [])).toEqual({ hasHighlight: false, hasFullMatch: true })
    // A reel is neither.
    expect(playerVideoChecklist({}, [{ kind: 'reel' }])).toEqual({ hasHighlight: false, hasFullMatch: false })
  })

  it('"How clubs see you" ticks Highlight video for an uploaded highlight with no legacy link', async () => {
    playerVideos = [{ id: 'v1', title: 'Highlights', kind: 'highlight', visibility: 'public', durationSeconds: 60 }]
    const profile = { id: 'player-1', role: 'player', highlight_video_url: null, full_game_video_count: 0, accepted_reference_count: 0 } as unknown as Profile
    render(<RecruitmentVisibilityWidget profile={profile} onAction={() => {}} />)
    await waitFor(() => expect(screen.getByText(/1 of 5 added/i)).toBeTruthy())
    const row = screen.getByText('Highlight video').closest('li') as HTMLElement
    expect(row.textContent).toContain('Added')
  })
})
