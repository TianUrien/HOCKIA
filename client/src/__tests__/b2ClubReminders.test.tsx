/**
 * B2 · Club reminders (migration 20261009100000, edge fn club-reminders).
 *
 *  - The Last call email's "Decline with a kind note" opens the applicant
 *    review with ?decline=1: the Decline sheet opens with a reason picked so
 *    Hockia AI drafts the note at once; the param is dropped (Back / refresh
 *    never re-open it); an application that can no longer be declined just
 *    shows the review.
 *  - The two new notification kinds: server copy with readable fallbacks, and
 *    the row opens the same screen as the push (applicant → role's Applicants
 *    → Opportunities).
 *
 * Supabase is mocked; the clock is pinned.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const fx = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, profile: null as Record<string, unknown> | null },
  tables: {} as Record<string, unknown[]>,
  invoke: vi.fn(),
}))

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const rows = () => fx.tables[table] ?? []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'or', 'order', 'limit', 'update']) chain[m] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), count: 0, error: null }).then(res, rej)
    return chain
  }
  return {
    SUPABASE_URL: 'https://example.test',
    SUPABASE_ANON_KEY: 'anon',
    supabase: {
      from: (t: string) => builder(t),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      functions: { invoke: (...a: unknown[]) => fx.invoke(...a) },
    },
  }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(fx.auth) : fx.auth), { getState: () => fx.auth }),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false }) }))
vi.mock('@/hooks/useRoleApplicants', () => ({ patchRoleApplicantStatus: vi.fn(), markRoleApplicantViewed: vi.fn() }))
vi.mock('@/hooks/useSigning', () => ({
  useApplicationRoad: () => ({ data: null, loading: false, refetch: vi.fn() }),
  useSigningActions: () => ({ busy: false, makeOffer: vi.fn(), withdrawOffer: vi.fn(), markSigned: vi.fn(), undoMarkSigned: vi.fn(), setTrial: vi.fn() }),
}))
vi.mock('@/hooks/useProfileScrollData', () => ({
  useProfileScrollData: () => ({ highlights: [], fullMatches: [], reels: [], fullGameLinks: [], career: [] }),
}))
vi.mock('@/hooks/useTrustedReferences', () => ({ useTrustedReferences: () => ({ acceptedReferences: [] }) }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))

import ApplicantReviewScreen from '@/components/club/ApplicantReviewScreen'
import { canOpenLinkedDecline, DECLINE_DEEP_LINK_REASON, DECLINE_REASON_CHIPS, wantsDeclineSheet } from '@/lib/clubRecruiting'
import { clubReminderRoute, getNotificationConfig, resolveNotificationRoute } from '@/components/notifications/config'
import type { NotificationKind, NotificationRecord } from '@/lib/api/notifications'
import { buildPushPayload } from '../../../supabase/functions/send-push/push-payload.ts'

const NOW = new Date('2026-10-09T12:00:00Z')
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })

const CLUB = { id: 'club1', role: 'club', full_name: 'E2E Test FC', avatar_url: null }
const application = (status: string) => ({
  status, applied_at: '2026-09-26T00:00:00Z', metadata: {}, opportunity_id: 'r1',
  applicant: { id: 'p1', full_name: 'Ana Pérez', avatar_url: null, role: 'player', position: 'midfielder', secondary_position: null, nationality_country_id: null, nationality2_country_id: null, base_location: null, playing_category: 'adult_women', gender: 'Women', last_active_at: null, current_club: null, current_world_club_id: null, specialist_skills: [] },
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

const openReview = (status: string, search: string) => {
  fx.tables = {
    opportunity_applications: [application(status)],
    opportunities: [{ gender: 'Women', club_id: 'club1' }],
    application_response_settings: [{ expiry_days: 14 }],
  }
  const ui: ReactNode = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/dashboard/opportunities/r1/applicants/a1${search}`]}>
        <Routes>
          <Route path="/dashboard/opportunities/:opportunityId/applicants/:applicationId" element={<><ApplicantReviewScreen roleId="r1" applicationId="a1" /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(ui)
}

beforeEach(() => {
  fx.auth = { user: { id: 'club1' }, profile: CLUB }
  fx.invoke.mockReset()
  fx.invoke.mockResolvedValue({ data: { message: 'Thanks for applying, Ana. We went another way this time.' }, error: null })
})

describe('Decline with a kind note (?decline=1)', () => {
  it('the deep-link helpers', () => {
    expect(wantsDeclineSheet('?decline=1')).toBe(true)
    expect(wantsDeclineSheet(new URLSearchParams('decline=true'))).toBe(true)
    expect(wantsDeclineSheet('?decline=0')).toBe(false)
    expect(wantsDeclineSheet('')).toBe(false)
    expect(canOpenLinkedDecline('pending', true)).toBe(true)
    expect(canOpenLinkedDecline('rejected', true)).toBe(false)
    expect(canOpenLinkedDecline('no_response', false)).toBe(false)
    // The reason it opens with is one of the nine the sheet offers.
    expect(DECLINE_REASON_CHIPS.map((r) => r.code)).toContain(DECLINE_DEEP_LINK_REASON)
  })

  it('opens the Decline sheet with the Hockia AI draft filled in, and drops the param', async () => {
    openReview('pending', '?decline=1')
    expect(await screen.findByTestId('decline-sheet')).toBeTruthy()
    await waitFor(() => expect(fx.invoke).toHaveBeenCalledWith('application-feedback', { body: { mode: 'draft', application_id: 'a1', reason: DECLINE_DEEP_LINK_REASON } }))
    await waitFor(() => expect((screen.getByLabelText('Note to Ana') as HTMLTextAreaElement).value).toBe('Thanks for applying, Ana. We went another way this time.'))
    expect(screen.getByTestId('decline-note-ai').textContent).toContain('Drafted by Hockia AI')
    expect(screen.getByRole('radio', { name: 'Other' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/dashboard/opportunities/r1/applicants/a1'))
  })

  it('without the param the sheet stays closed', async () => {
    openReview('pending', '')
    expect(await screen.findByTestId('applicant-review-screen')).toBeTruthy()
    await screen.findByText('Ana Pérez')
    expect(screen.queryByTestId('decline-sheet')).toBeNull()
    expect(fx.invoke).not.toHaveBeenCalled()
  })

  it('an application already declined opens the review only', async () => {
    openReview('rejected', '?decline=1')
    await screen.findByText('Ana Pérez')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/dashboard/opportunities/r1/applicants/a1'))
    expect(screen.queryByTestId('decline-sheet')).toBeNull()
  })
})

// ── notification kinds ─────────────────────────────────────────────────────
const KINDS: NotificationKind[] = ['applicant_last_call', 'applicants_closing_soon']

function notification(kind: NotificationKind, metadata: Record<string, unknown> = {}): NotificationRecord {
  return {
    id: 'n1', kind, sourceEntityId: null, metadata, targetUrl: null,
    createdAt: '2026-10-09T12:05:00.000Z', readAt: null, seenAt: null, clearedAt: null,
    actor: { id: null, fullName: null, role: null, username: null, avatarUrl: null, baseLocation: null },
  }
}

describe('B2 notification kinds', () => {
  it('show the server copy (first names only)', () => {
    const last = notification('applicant_last_call', { title: 'Last day to answer Ana', summary: 'The application to Midfielder closes tomorrow.' })
    expect(getNotificationConfig(last).getTitle(last)).toBe('Last day to answer Ana')
    expect(getNotificationConfig(last).getDescription?.(last)).toBe('The application to Midfielder closes tomorrow.')
    const soon = notification('applicants_closing_soon', { title: '3 players are waiting for E2E Test FC', summary: "Ana's application closes on Tuesday." })
    expect(getNotificationConfig(soon).getTitle(soon)).toBe('3 players are waiting for E2E Test FC')
    expect(getNotificationConfig(soon).badgeText).toBe('Closing soon')
  })

  it('stay readable with no metadata, never a pronoun', () => {
    for (const kind of KINDS) {
      const n = notification(kind)
      const text = `${getNotificationConfig(n).getTitle(n)} ${getNotificationConfig(n).getDescription?.(n) ?? ''}`
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text).not.toMatch(/\b(he|she|his|her|him)\b/i)
    }
  })

  it('route: the applicant (one) → the role’s Applicants (one role) → Opportunities; the push agrees', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ opportunity_id: 'r1', application_id: 'a1' }, '/dashboard/opportunities/r1/applicants/a1'],
      [{ opportunity_id: 'r1' }, '/dashboard/opportunities/r1/applicants'],
      [{}, '/opportunities'],
    ]
    for (const kind of KINDS) {
      for (const [metadata, expected] of cases) {
        expect(clubReminderRoute(notification(kind, metadata))).toBe(expected)
        expect(resolveNotificationRoute(notification(kind, metadata))).toBe(expected)
        expect(buildPushPayload(kind, metadata, 'x').url).toBe(expected)
      }
    }
  })
})
