import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { Vacancy } from '@/lib/supabase'

/**
 * Staging audit round 2: close-as-filled toast, "Role filled", desktop
 * video count, team label on coach roles, and the closed role page.
 */

// The applicant's own row, as RLS returns it (applicant_id = auth.uid()).
let ownRow: { applied_at: string | null; ai_feedback: unknown } | null = null
vi.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: ownRow, error: null }),
  }
  return { supabase: { from: () => chain } }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { profile: { id: 'player-1', role: 'player' }, user: { id: 'player-1' } }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))

import { closeRoleToast } from '@/lib/roleLifecycle'
import { APPLICATION_STATUS_LABELS, applicationStatusFallbackMessage, applicationStatusLabel, playerApplicationStatusBadge } from '@/lib/applicationStatus'
import { appliedOnLine, applicationStatusPill, closedRoleView, clubNoteFromFeedback, roleTeamLabel } from '@/lib/opportunityCopy'
import { profileVideoTotal } from '@/hooks/useProfileVideoTotal'
import { OpportunityDetailMobile } from '@/components/opportunities/OpportunityDetailMobile'

describe('close-as-filled toast', () => {
  it('states the outcome and that applicants were told — no congratulations', () => {
    expect(closeRoleToast('filled')).toBe('Role closed as filled. Applicants have been told.')
    expect(closeRoleToast('filled')).not.toMatch(/congrat/i)
    expect(closeRoleToast('withdrawn')).toBe('Role closed.')
  })
})

describe('"Role filled" application label', () => {
  it('comes from the one helper and reads "Role filled"', () => {
    expect(applicationStatusLabel('filled')).toBe('Role filled')
    expect(APPLICATION_STATUS_LABELS.filled).toBe('Role filled')
  })
  it('is grey on My applications / Pulse / the role page (never "Role closed")', () => {
    const pill = applicationStatusPill('filled', '2026-09-01T00:00:00Z', false)
    expect(pill).toEqual({ label: 'Role filled', tone: 'grey' })
    expect(applicationStatusPill('filled', null, true).label).toBe('Role filled')
  })
  it('timeline / desktop badge is grey and matches the pill', () => {
    const badge = playerApplicationStatusBadge('filled')
    expect(badge?.label).toBe('Role filled')
    expect(badge?.className).toBe(playerApplicationStatusBadge('rejected')?.className)
  })
  it('has a deterministic, kind timeline message', () => {
    expect(applicationStatusFallbackMessage('filled', null)).toMatch(/filled/)
  })
  it('leaves pending-on-a-closed-role and the signing statuses as they were', () => {
    expect(applicationStatusPill('pending', null, false).label).toBe('Role closed')
    expect(applicationStatusLabel('offered')).toBeNull()
  })
})

describe('team label on roles (desktop cards + detail)', () => {
  it('maps every team to the Foundations words', () => {
    expect(roleTeamLabel('Men')).toBe("Men's")
    expect(roleTeamLabel('Women')).toBe("Women's")
    expect(roleTeamLabel('Mixed')).toBe('Mixed')
    expect(roleTeamLabel('Boys')).toBe('Boys')
    expect(roleTeamLabel('Girls')).toBe('Girls')
    expect(roleTeamLabel(null)).toBeNull()
  })
})

describe('desktop profile video count', () => {
  it('counts every tile the viewer sees: highlights + full matches + reels + links + locked', () => {
    // 3 player_videos rows (highlight, full match, reel) + 2 links + legacy link = 6
    expect(profileVideoTotal({ videoRows: 3, fullGameLinks: 2, hasLegacyHighlight: true, lockedFullMatches: 0, lockedHighlights: 0 })).toBe(6)
    // A non-recruiter: recruiters-only rows are hidden by RLS but drawn as locked tiles.
    expect(profileVideoTotal({ videoRows: 2, fullGameLinks: 0, hasLegacyHighlight: false, lockedFullMatches: 3, lockedHighlights: 1 })).toBe(6)
  })
})

describe('closed role view', () => {
  it('picks the right block per viewer', () => {
    expect(closedRoleView({ isClosed: false, hasApplied: true, isPublisher: false })).toBe('open')
    expect(closedRoleView({ isClosed: true, hasApplied: true, isPublisher: false })).toBe('applicant')
    expect(closedRoleView({ isClosed: true, hasApplied: false, isPublisher: false })).toBe('visitor')
    expect(closedRoleView({ isClosed: true, hasApplied: false, isPublisher: true })).toBe('publisher')
  })
  it('shows only a note the club wrote for the current decline', () => {
    const note = { source: 'club', status: 'rejected', message: 'Thanks for applying.' }
    expect(clubNoteFromFeedback(note, 'rejected')).toBe('Thanks for applying.')
    expect(clubNoteFromFeedback({ ...note, source: 'ai' }, 'rejected')).toBeNull()
    expect(clubNoteFromFeedback(note, 'filled')).toBeNull()
    expect(clubNoteFromFeedback(null, 'rejected')).toBeNull()
  })
  it('formats the applied date', () => {
    expect(appliedOnLine('2026-09-03T10:00:00Z')).toBe('Applied Sep 3, 2026')
    expect(appliedOnLine(null)).toBeNull()
  })
})

const vacancy = {
  id: 'opp-1',
  club_id: 'club-1',
  title: '[QA] Post a role test',
  opportunity_type: 'player',
  position: 'midfielder',
  gender: 'Women',
  status: 'closed',
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

const renderPhone = (props: { hasApplied: boolean; applicationStatus: string | null }) =>
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
        onMessage={() => {}}
        {...props}
      />
    </MemoryRouter>,
  )

describe('phone closed role page', () => {
  beforeEach(() => { ownRow = null })

  it('applicant: greyed role, Closed label, own application with status, date and the club note — no Apply', async () => {
    ownRow = { applied_at: '2026-09-03T10:00:00Z', ai_feedback: { source: 'club', status: 'rejected', message: 'We went another way.' } }
    renderPhone({ hasApplied: true, applicationStatus: 'rejected' })
    expect(screen.getByTestId('role-closed-label').textContent).toBe('Closed')
    expect(screen.getByTestId('role-body-closed').className).toContain('grayscale')
    expect(screen.getByTestId('own-application-status').textContent).toBe('Not selected')
    await waitFor(() => expect(screen.getByTestId('club-note').textContent).toContain('We went another way.'))
    expect(screen.getByText('Applied Sep 3, 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByTestId('role-closed-notice')).toBeNull()
  })

  it('filled applicant reads "Role filled" in grey', () => {
    renderPhone({ hasApplied: true, applicationStatus: 'filled' })
    const status = screen.getByTestId('own-application-status')
    expect(status.textContent).toBe('Role filled')
    expect(status.className).toContain('bg-surface-grouped')
  })

  it('non-applicant: "This role is closed" with a link to open roles, no application block', () => {
    renderPhone({ hasApplied: false, applicationStatus: null })
    expect(screen.getByTestId('role-closed-notice').textContent).toContain('This role is closed')
    expect(screen.getByRole('button', { name: 'See open roles' })).toBeTruthy()
    expect(screen.queryByTestId('own-application')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })
})
